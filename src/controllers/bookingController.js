const { admin, db } = require('../utils/firebase');

// Helper function for consistent logging
const log = (message) => {
    console.log(`[BookingController] ${message}`);
};

// Helper function to safely convert Firestore Timestamp or ISO string to Date object
const convertToDate = (value) => {
    if (value instanceof admin.firestore.Timestamp) {
        return value.toDate();
    }
    if (typeof value === 'string') {
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date;
    }
    return null;
};

/**
 * Get all bookings.
 */
const getAllBookings = async (req, res) => {
    try {
        log('Fetching all bookings...');
        const bookingsRef = db.collection('bookings');
        const snapshot = await bookingsRef.get();

        if (snapshot.empty) {
            log('No bookings found.');
            return res.status(200).json([]);
        }

        const bookings = [];
        for (const doc of snapshot.docs) {
            const bookingData = doc.data();
            const vehicleDoc = await db.collection('vehicles').doc(bookingData.vehicleId).get();
            const vehicleData = vehicleDoc.exists ? vehicleDoc.data() : null;

            const startDate = convertToDate(bookingData.startDate);
            const endDate = convertToDate(bookingData.endDate);
            const createdAt = convertToDate(bookingData.createdAt);

            bookings.push({
                id: doc.id,
                ...bookingData,
                startDate: startDate ? startDate.toISOString() : null,
                endDate: endDate ? endDate.toISOString() : null,
                createdAt: createdAt ? createdAt.toISOString() : null,
                vehicleDetails: vehicleData ? {
                    id: vehicleDoc.id,
                    make: vehicleData.make,
                    model: vehicleData.model,
                    year: vehicleData.year,
                    rentalPricePerDay: vehicleData.rentalPricePerDay,
                    imageUrl: vehicleData.imageUrl,
                    location: vehicleData.location,
                    ownerId: vehicleData.ownerId,
                } : null,
            });
        }

        log(`Successfully fetched ${bookings.length} bookings.`);
        res.status(200).json(bookings);
    } catch (error) {
        console.error('[BookingController] Error fetching all bookings:', error);
        res.status(500).json({ message: 'Server error fetching bookings.', error: error.message });
    }
};


/**
 * Creates a new booking.
 */
const createBooking = async (req, res) => {
    try {
        const { vehicleId, startDate, endDate, totalCost, downpaymentAmount, fullPaymentAmount, paymentStatus, paymentDetails } = req.body;
        const renterId = req.customUser.uid;

        if (!vehicleId || !startDate || !endDate || !totalCost || !paymentStatus) {
            return res.status(400).json({ message: 'Missing required booking fields.' });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
            return res.status(400).json({ message: 'Invalid start or end date.' });
        }

        const vehicleRef = db.collection('vehicles').doc(vehicleId);
        const vehicleDoc = await vehicleRef.get();
        if (!vehicleDoc.exists) {
            return res.status(404).json({ message: 'Vehicle not found.' });
        }

        const newBooking = {
            vehicleId,
            renterId,
            startDate: admin.firestore.Timestamp.fromDate(start),
            endDate: admin.firestore.Timestamp.fromDate(end),
            totalCost: parseFloat(totalCost),
            downpaymentAmount: parseFloat(downpaymentAmount || 0),
            fullPaymentAmount: parseFloat(fullPaymentAmount || 0),
            paymentStatus,
            paymentDetails: paymentDetails || {},
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection('bookings').add(newBooking);
        log(`Booking created with ID: ${docRef.id} for vehicle ${vehicleId} by renter ${renterId}. Status: ${paymentStatus}`);
        res.status(201).json({ id: docRef.id, ...newBooking });

    } catch (error) {
        console.error('[BookingController] Error creating booking:', error);
        res.status(500).json({ message: 'Error creating booking.', error: error.message });
    }
};

/**
 * API endpoint to check vehicle availability for a given date range.
 */
const apiCheckAvailability = async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { startDate, endDate } = req.query;

        log(`Checking availability for vehicle ${vehicleId} from ${startDate} to ${endDate}`);

        if (!vehicleId || !startDate || !endDate) {
            return res.status(400).json({ message: 'Vehicle ID, start date, and end date are required.' });
        }

        const requestedStart = new Date(startDate);
        const requestedEnd = new Date(endDate);

        if (isNaN(requestedStart.getTime()) || isNaN(requestedEnd.getTime()) || requestedStart > requestedEnd) {
            return res.status(400).json({ message: 'Invalid date range provided.' });
        }

        const vehicleDoc = await db.collection('vehicles').doc(vehicleId).get();
        if (!vehicleDoc.exists) {
            return res.status(404).json({ message: 'Vehicle not found.' });
        }
        const vehicleData = vehicleDoc.data();
        const vehicleUnavailablePeriods = vehicleData.availability || [];

        for (const period of vehicleUnavailablePeriods) {
            const periodStart = convertToDate(period.start);
            const periodEnd = convertToDate(period.end);

            if (!periodStart || !periodEnd) {
                console.warn(`[BookingController] Skipping invalid pre-defined availability period for vehicle ${vehicleId}:`, period);
                continue;
            }

            if (
                (requestedStart <= periodEnd && requestedEnd >= periodStart)
            ) {
                log(`Vehicle ${vehicleId} is unavailable due to pre-defined period: ${period.start} to ${period.end}`);
                return res.status(200).json({ isAvailable: false, message: 'Vehicle is unavailable for the requested dates due to pre-defined blocks.', overlappingPeriods: [period] });
            }
        }

        const bookingsRef = db.collection('bookings')
            .where('vehicleId', '==', vehicleId)
            .where('paymentStatus', 'in', ['downpayment_received', 'full_payment_received', 'pending_cash_downpayment', 'awaiting_qr_downpayment', 'qr_downpayment_confirmed_by_user']);

        const snapshot = await bookingsRef.get();
        const overlappingBookings = [];

        snapshot.forEach(doc => {
            const booking = doc.data();
            const bookingStart = convertToDate(booking.startDate);
            const bookingEnd = convertToDate(booking.endDate);

            if (!bookingStart || !bookingEnd) {
                console.warn(`[BookingController] Skipping invalid booking date for booking ID ${doc.id}:`, booking);
                return;
            }

            if (
                (requestedStart <= bookingEnd && requestedEnd >= bookingStart)
            ) {
                overlappingBookings.push({ id: doc.id, startDate: bookingStart.toISOString().split('T')[0], endDate: bookingEnd.toISOString().split('T')[0] });
            }
        });

        if (overlappingBookings.length > 0) {
            log(`Vehicle ${vehicleId} is unavailable due to existing bookings.`);
            return res.status(200).json({ isAvailable: false, message: 'Vehicle is already booked for some of the requested dates.', overlappingBookings });
        }

        // --- Calculate Costs when available ---
        const rentalPricePerDay = parseFloat(vehicleData.rentalPricePerDay);
        if (isNaN(rentalPricePerDay)) {
            return res.status(500).json({ message: 'Vehicle rental price is invalid.' });
        }

        // Calculate number of days (inclusive of start and end day)
        const diffTime = Math.abs(requestedEnd.getTime() - requestedStart.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

        const totalCost = parseFloat((rentalPricePerDay * diffDays).toFixed(2));
        const downpaymentPercentage = 0.20;
        const downpaymentAmount = parseFloat((totalCost * downpaymentPercentage).toFixed(2));
        const fullPaymentAmount = parseFloat((totalCost - downpaymentAmount).toFixed(2));

        log(`Vehicle ${vehicleId} is available. Calculated costs: Total=${totalCost}, Downpayment=${downpaymentAmount}, Full=${fullPaymentAmount}`);
        res.status(200).json({
            isAvailable: true,
            message: 'Vehicle is available for the selected dates.',
            totalCost,
            downpaymentAmount,
            fullPaymentAmount,
        });

    } catch (error) {
        console.error('[BookingController] Error checking vehicle availability:', error);
        res.status(500).json({ message: 'Server error checking availability.', error: error.message });
    }
};

/**
 * Get all bookings for a specific user.
 */
const getBookingsByUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const requesterId = req.customUser.uid;
        const requesterRole = req.customUser.role;

        if (requesterId !== userId && requesterRole !== 'admin') {
            log(`Unauthorized attempt to access user ${userId}'s bookings by user ${requesterId} (${requesterRole}).`);
            return res.status(403).json({ message: 'Unauthorized: You can only view your own bookings.' });
        }

        log(`Fetching bookings for user ID: ${userId} by requester ${requesterId} (${requesterRole})`);

        const bookingsRef = db.collection('bookings').where('renterId', '==', userId);
        const snapshot = await bookingsRef.get();

        if (snapshot.empty) {
            log(`No bookings found for user ${userId}.`);
            return res.status(200).json([]);
        }

        const bookings = [];
        for (const doc of snapshot.docs) {
            const bookingData = doc.data();
            const vehicleDoc = await db.collection('vehicles').doc(bookingData.vehicleId).get();
            const vehicleData = vehicleDoc.exists ? vehicleDoc.data() : null;

            const renterDoc = await db.collection('users').doc(bookingData.renterId).get();
            const renterData = renterDoc.exists ? renterDoc.data() : null;

            log(`Processing booking ${doc.id}: VehicleId=${bookingData.vehicleId}, RenterId=${bookingData.renterId}`);
            // FIXED: Using correct variable name `vehicleData`
            log(`   Vehicle Data Found: ${!!vehicleData}`);
            log(`   Renter Data Found: ${!!renterData}`);

            const startDate = convertToDate(bookingData.startDate);
            const endDate = convertToDate(bookingData.endDate);
            const createdAt = convertToDate(bookingData.createdAt);

            bookings.push({
                id: doc.id,
                ...bookingData,
                startDate: startDate ? startDate.toISOString() : null,
                endDate: endDate ? endDate.toISOString() : null,
                createdAt: createdAt ? createdAt.toISOString() : null,
                renterDetails: renterData ? {
                    id: renterDoc.id,
                    username: renterData.username,
                    email: renterData.email,
                } : null,
                vehicleDetails: vehicleData ? {
                    id: vehicleDoc.id,
                    make: vehicleData.make,
                    model: vehicleData.model,
                    year: vehicleData.year,
                    rentalPricePerDay: vehicleData.rentalPricePerDay,
                    imageUrl: vehicleData.imageUrl,
                    location: vehicleData.location,
                    ownerId: vehicleData.ownerId,
                } : null,
            });
        }

        log(`Successfully fetched ${bookings.length} bookings for user ${userId}.`);
        res.status(200).json(bookings);
    } catch (error) {
        console.error(`Error fetching bookings for user ${req.params.userId}:`, error);
        res.status(500).json({ message: 'Error fetching user bookings.', error: error.message });
    }
};

/**
 * Get all bookings for a specific vehicle.
 */
const getBookingsByVehicle = async (req, res) => {
    try {
        const { vehicleId } = req.params;
        log(`Fetching bookings for vehicle ID: ${vehicleId}`);
        const bookingsRef = db.collection('bookings').where('vehicleId', '==', vehicleId);
        const snapshot = await bookingsRef.get();

        if (snapshot.empty) {
            log(`No bookings found for vehicle ${vehicleId}.`);
            return res.status(200).json([]);
        }

        const bookings = [];
        snapshot.forEach(doc => {
            const bookingData = doc.data();
            const startDate = convertToDate(bookingData.startDate);
            const endDate = convertToDate(bookingData.endDate);
            const createdAt = convertToDate(bookingData.createdAt);

            bookings.push({
                id: doc.id,
                ...bookingData,
                startDate: startDate ? startDate.toISOString() : null,
                endDate: endDate ? endDate.toISOString() : null,
                createdAt: createdAt ? createdAt.toISOString() : null,
            });
        });

        log(`Successfully fetched ${bookings.length} bookings for vehicle ${vehicleId}.`);
        res.status(200).json(bookings);
    } catch (error) {
        console.error(`Error fetching bookings for vehicle ${req.params.vehicleId}:`, error);
        res.status(500).json({ message: 'Error fetching vehicle bookings.', error: error.message });
    }
};

/**
 * Update a booking's payment method.
 */
const updateBookingPaymentMethod = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { paymentMethod, newStatus } = req.body;
        const renterId = req.customUser.uid;

        if (!paymentMethod || !newStatus) {
            return res.status(400).json({ message: 'Missing paymentMethod or newStatus field.' });
        }

        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        if (bookingDoc.data().renterId !== renterId) {
            return res.status(403).json({ message: 'Unauthorized: You are not the renter for this booking.' });
        }

        await bookingRef.update({
            paymentMethod: paymentMethod,
            paymentStatus: newStatus,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.status(200).json({ message: 'Payment method and status updated successfully.' });
    } catch (error) {
        console.error('Error updating booking payment method:', error);
        res.status(500).json({ message: 'Error updating booking payment method.', error: error.message });
    }
};

/**
 * Get a single booking by ID.
 */
const getBookingById = async (req, res) => {
    try {
        const { bookingId } = req.params;
        log(`Fetching booking with ID: ${bookingId}`);
        const bookingDoc = await db.collection('bookings').doc(bookingId).get();

        if (!bookingDoc.exists) {
            log(`Booking with ID ${bookingId} not found.`);
            return res.status(404).json({ message: 'Booking not found.' });
        }

        const bookingData = bookingDoc.data();
        const requesterId = req.customUser.uid;
        const requesterRole = req.customUser.role;

        const vehicleDoc = await db.collection('vehicles').doc(bookingData.vehicleId).get();
        const vehicleData = vehicleDoc.exists ? vehicleDoc.data() : null;
        const ownerId = vehicleData ? vehicleData.ownerId : null;

        if (bookingData.renterId !== requesterId && ownerId !== requesterId && requesterRole !== 'admin') {
            log(`Unauthorized attempt to access booking ${bookingId} by user ${requesterId}. Booking belongs to renter ${bookingData.renterId} and vehicle owner ${ownerId}.`);
            return res.status(403).json({ message: 'Unauthorized access to booking details.' });
        }

        const startDate = convertToDate(bookingData.startDate);
        const endDate = convertToDate(bookingData.endDate);
        const createdAt = convertToDate(bookingData.createdAt);
        const downpaymentDueDate = convertToDate(bookingData.downpaymentDueDate);
        const cancellationGracePeriodEnd = convertToDate(bookingData.cancellationGracePeriodEnd);

        log(`Successfully fetched booking: ${bookingId}`);
        res.status(200).json({
            id: bookingDoc.id,
            ...bookingData,
            startDate: startDate ? startDate.toISOString() : null,
            endDate: endDate ? endDate.toISOString() : null,
            createdAt: createdAt ? createdAt.toISOString() : null,
            downpaymentDueDate: downpaymentDueDate ? downpaymentDueDate.toISOString() : null,
            cancellationGracePeriodEnd: cancellationGracePeriodEnd ? cancellationGracePeriodEnd.toISOString() : null,
            vehicleDetails: vehicleData ? {
                id: vehicleDoc.id,
                make: vehicleData.make,
                model: vehicleData.model,
                year: vehicleData.year,
                rentalPricePerDay: vehicleData.rentalPricePerDay,
                imageUrl: vehicleData.imageUrl,
                location: vehicleData.location,
                ownerId: vehicleData.ownerId,
            } : null,
        });
    } catch (error) {
        console.error(`Error fetching booking by ID ${req.params.bookingId}:`, error);
        res.status(500).json({ message: 'Error fetching booking.', error: error.message });
    }
};

/**
 * Update the status of a booking.
 */
const updateBookingStatus = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { newStatus } = req.body;
        log(`Updating booking ${bookingId} status to ${newStatus}`);

        if (!newStatus) {
            return res.status(400).json({ message: 'New status is required.' });
        }

        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        const updateData = {
            paymentStatus: newStatus,
            lastStatusUpdate: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (newStatus === 'downpayment_received') {
            const GRACE_PERIOD_HOURS = 2 * 24;
            updateData.downpaymentReceivedAt = admin.firestore.FieldValue.serverTimestamp();
            updateData.cancellationGracePeriodEnd = admin.firestore.Timestamp.fromMillis(
                Date.now() + GRACE_PERIOD_HOURS * 60 * 60 * 1000
            );
            log(`Downpayment received for booking ${bookingId}. Cancellation grace period ends at ${new Date(updateData.cancellationGracePeriodEnd.toDate()).toLocaleString()}.`);
        } else if (newStatus === 'full_payment_received') {
            updateData.fullPaymentReceivedAt = admin.firestore.FieldValue.serverTimestamp();
        }

        await bookingRef.update(updateData);

        res.status(200).json({
            message: `Booking ${bookingId} payment status successfully updated to ${newStatus}.`,
            status: newStatus,
        });

    } catch (error) {
        console.error(`Error updating booking status for ${req.params.bookingId}:`, error);
        res.status(500).json({ message: 'Error updating booking status.', error: error.message });
    }
};

/**
 * Delete a booking.
 */
const deleteBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        log(`Deleting booking with ID: ${bookingId}`);
        await db.collection('bookings').doc(bookingId).delete();
        log(`Booking ${bookingId} deleted successfully.`);
        res.status(200).json({ message: 'Booking deleted successfully.' });
    } catch (error) {
        console.error(`Error deleting booking ${req.params.bookingId}:`, error);
        res.status(500).json({ message: 'Error deleting booking.', error: error.message });
    }
};

/**
 * Get all bookings for vehicles owned by the authenticated user.
 */
const getOwnerBookings = async (req, res) => {
    try {
        const ownerId = req.customUser.uid;
        log(`Fetching bookings for vehicles owned by user ID: ${ownerId}`);

        // Step 1: Find all vehicles belonging to the owner
        const vehiclesRef = db.collection('vehicles').where('ownerId', '==', ownerId);
        const vehiclesSnapshot = await vehiclesRef.get();

        log(`Found ${vehiclesSnapshot.size} vehicles for owner ${ownerId}.`);
        if (vehiclesSnapshot.empty) {
            log('Owner has no registered vehicles.');
            return res.status(200).json([]);
        }

        const vehicleIds = vehiclesSnapshot.docs.map(doc => doc.id);
        log('Vehicle IDs found: ' + JSON.stringify(vehicleIds));

        // Step 2: Find all bookings for those vehicles
        // Note: Firestore has a limit of 10 for 'in' queries.
        // If an owner has more than 10 vehicles, this needs a more complex query.
        // For now, assuming vehicleIds.length <= 10.
        const bookingsRef = db.collection('bookings').where('vehicleId', 'in', vehicleIds);
        const bookingsSnapshot = await bookingsRef.get();

        log(`Found ${bookingsSnapshot.size} bookings for these vehicles.`);
        if (bookingsSnapshot.empty) {
            log('No bookings found for owner\'s vehicles.');
            return res.status(200).json([]);
        }

        const bookings = [];
        for (const doc of bookingsSnapshot.docs) {
            const bookingData = doc.data();
            // Find the vehicle data from the already fetched vehiclesSnapshot
            const vehicleDocData = vehiclesSnapshot.docs.find(vDoc => vDoc.id === bookingData.vehicleId)?.data();

            // Fetch renter data
            const renterDoc = await db.collection('users').doc(bookingData.renterId).get();
            const renterData = renterDoc.exists ? renterDoc.data() : null;

            log(`Processing booking ${doc.id}: VehicleId=${bookingData.vehicleId}, RenterId=${bookingData.renterId}`);
            // FIXED: Using correct variable name `vehicleDocData`
            log(`   Vehicle Data Found: ${!!vehicleDocData}`);
            log(`   Renter Data Found: ${!!renterData}`);

            const startDate = convertToDate(bookingData.startDate);
            const endDate = convertToDate(bookingData.endDate);
            const createdAt = convertToDate(bookingData.createdAt);

            bookings.push({
                id: doc.id,
                ...bookingData,
                startDate: startDate ? startDate.toISOString() : null,
                endDate: endDate ? endDate.toISOString() : null,
                createdAt: createdAt ? createdAt.toISOString() : null,
                renterDetails: renterData ? {
                    id: renterDoc.id,
                    username: renterData.username,
                    email: renterData.email,
                } : null,
                vehicleDetails: vehicleDocData ? {
                    id: bookingData.vehicleId,
                    make: vehicleDocData.make,
                    model: vehicleDocData.model,
                    year: vehicleDocData.year,
                    imageUrl: vehicleDocData.imageUrl,
                    rentalPricePerDay: vehicleDocData.rentalPricePerDay,
                    ownerId: vehicleDocData.ownerId,
                } : null,
            });
        }

        log(`Successfully fetched and formatted ${bookings.length} bookings for owner's vehicles.`);
        log('Sample formatted booking: ' + JSON.stringify(bookings[0] || {}));
        res.status(200).json(bookings);
    } catch (error) {
        console.error('[BookingController] Error fetching owner bookings:', error);
        res.status(500).json({ message: 'Error fetching owner bookings.', error: error.message });
    }
};

module.exports = {
    getAllBookings,
    createBooking,
    apiCheckAvailability,
    getBookingsByUser,
    getBookingsByVehicle,
    getBookingById,
    updateBookingPaymentMethod,
    updateBookingStatus,
    deleteBooking,
    getOwnerBookings,
};

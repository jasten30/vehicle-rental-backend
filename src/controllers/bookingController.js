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
 * Get all bookings, with flexible date filtering based on createdAt timestamp.
 */
const getAllBookings = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    log('Fetching all bookings...');

    let bookingsQuery = db.collection('bookings');

    // Add filters step-by-step if they are provided
    if (startDate) {
      log(`Filtering for bookings created on or after: ${startDate}`);
      bookingsQuery = bookingsQuery.where('createdAt', '>=', new Date(startDate));
    }
    if (endDate) {
      log(`Filtering for bookings created on or before: ${endDate}`);
      bookingsQuery = bookingsQuery.where('createdAt', '<=', new Date(endDate + 'T23:59:59'));
    }

    const bookingsSnapshot = await bookingsQuery.get();

    if (bookingsSnapshot.empty) {
      log('No bookings found for the given criteria.');
      return res.status(200).json([]);
    }

    const bookingsData = bookingsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const vehicleIds = [
      ...new Set(bookingsData.map((b) => b.vehicleId).filter(Boolean)),
    ];
    const renterIds = [
      ...new Set(bookingsData.map((b) => b.renterId).filter(Boolean)),
    ];

    const vehiclePromises = vehicleIds.map((id) =>
      db.collection('vehicles').doc(id).get()
    );
    const renterPromises = renterIds.map((id) =>
      db.collection('users').doc(id).get()
    );

    const vehicleDocs = await Promise.all(vehiclePromises);
    const renterDocs = await Promise.all(renterPromises);

    const vehiclesMap = new Map();
    vehicleDocs.forEach((doc) => {
      if (doc.exists) {
        vehiclesMap.set(doc.id, doc.data());
      }
    });

    const rentersMap = new Map();
    renterDocs.forEach((doc) => {
      if (doc.exists) {
        rentersMap.set(doc.id, doc.data());
      }
    });

    const enrichedBookings = bookingsData.map((booking) => {
      const vehicle = vehiclesMap.get(booking.vehicleId);
      const renter = rentersMap.get(booking.renterId);
      const bookingStartDate = convertToDate(booking.startDate);
      const bookingEndDate = convertToDate(booking.endDate);
      const bookingCreatedAt = convertToDate(booking.createdAt);

      return {
        ...booking,
        id: booking.id,
        startDate: bookingStartDate ? bookingStartDate.toISOString() : null,
        endDate: bookingEndDate ? bookingEndDate.toISOString() : null,
        createdAt: bookingCreatedAt ? bookingCreatedAt.toISOString() : null,
        vehicleName: vehicle
          ? `${vehicle.make} ${vehicle.model}`
          : 'Unknown Vehicle',
        renterEmail: renter ? renter.email : 'Unknown Renter',
      };
    });

    log(`Successfully fetched and enriched ${enrichedBookings.length} bookings.`);
    res.status(200).json(enrichedBookings);
  } catch (error) {
    console.error('[BookingController] Error fetching all bookings:', error);
    res
      .status(500)
      .json({ message: 'Server error fetching bookings.', error: error.message });
  }
};


/**
 * Creates a new booking.
 */
const createBooking = async (req, res) => {
  try {
    const { vehicleId, startDate, endDate, totalCost } = req.body;
    const renterId = req.customUser.uid;

    if (!vehicleId || !startDate || !endDate || !totalCost) {
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
    
    const ownerId = vehicleDoc.data().ownerId;

    const newBooking = {
      vehicleId,
      renterId,
      ownerId, 
      startDate: admin.firestore.Timestamp.fromDate(start),
      endDate: admin.firestore.Timestamp.fromDate(end),
      totalCost: parseFloat(totalCost),
      paymentStatus: 'pending_owner_approval', 
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('bookings').add(newBooking);
    log(`Booking request created with ID: ${docRef.id}`);
    res.status(201).json({ id: docRef.id, ...newBooking });

  } catch (error) {
    console.error('[BookingController] Error creating booking:', error);
    res.status(500).json({ message: 'Error creating booking request.' });
  }
};

/**
 * API endpoint to check vehicle availability for a given date range.
 */
const apiCheckAvailability = async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const { startDate, endDate } = req.query;

    const requestedStart = new Date(startDate);
    const requestedEnd = new Date(endDate);
    
    const vehicleDoc = await db.collection('vehicles').doc(vehicleId).get();
    if (!vehicleDoc.exists) {
      return res.status(404).json({ message: 'Vehicle not found.' });
    }
      
    const vehicleData = vehicleDoc.data();
    const unavailablePeriods = vehicleData.availability || [];

    for (const period of unavailablePeriods) {
      const periodStart = convertToDate(period.start);
      const periodEnd = convertToDate(period.end);

      if (requestedStart <= periodEnd && requestedEnd >= periodStart) {
        return res.status(200).json({
          isAvailable: false,
          message: 'Vehicle is unavailable for the requested dates.',
        });
      }
    }

    const bookingsRef = db
      .collection('bookings')
      .where('vehicleId', '==', vehicleId)
      .where('paymentStatus', '==', 'Confirmed');

    const snapshot = await bookingsRef.get();
    let isOverlapping = false;
    snapshot.forEach((doc) => {
      const booking = doc.data();
      const bookingStart = convertToDate(booking.startDate);
      const bookingEnd = convertToDate(booking.endDate);
      if (requestedStart <= bookingEnd && requestedEnd >= bookingStart) {
        isOverlapping = true;
      }
    });

    if (isOverlapping) {
      return res.status(200).json({
        isAvailable: false,
        message: 'Vehicle is already booked for some of the requested dates.',
      });
    }

    const rentalPricePerDay = parseFloat(vehicleData.rentalPricePerDay);
    if (isNaN(rentalPricePerDay)) {
      return res.status(500).json({ message: 'Vehicle rental price is invalid.' });
    }

    const diffTime = Math.abs(requestedEnd.getTime() - requestedStart.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const totalCost = parseFloat((rentalPricePerDay * diffDays).toFixed(2));

    res.status(200).json({
      isAvailable: true,
      message: 'Vehicle is available for the selected dates.',
      totalCost,
    });
  } catch (error) {
    console.error(
      '[BookingController] Error checking vehicle availability:',
      error
    );
    res
      .status(500)
      .json({ message: 'Server error checking availability.', error: error.message });
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
      log(
        `Unauthorized attempt to access user ${userId}'s bookings by user ${requesterId} (${requesterRole}).`
      );
      return res
        .status(403)
        .json({ message: 'Unauthorized: You can only view your own bookings.' });
    }

    log(
      `Fetching bookings for user ID: ${userId} by requester ${requesterId} (${requesterRole})`
    );

    const bookingsRef = db.collection('bookings').where('renterId', '==', userId);
    const snapshot = await bookingsRef.get();

    if (snapshot.empty) {
      log(`No bookings found for user ${userId}.`);
      return res.status(200).json([]);
    }

    const bookings = [];
    for (const doc of snapshot.docs) {
      const bookingData = doc.data();
      const vehicleDoc = await db
        .collection('vehicles')
        .doc(bookingData.vehicleId)
        .get();
      const vehicleData = vehicleDoc.exists ? vehicleDoc.data() : null;

      const renterDoc = await db.collection('users').doc(bookingData.renterId).get();
      const renterData = renterDoc.exists ? renterDoc.data() : null;

      log(
        `Processing booking ${doc.id}: VehicleId=${bookingData.vehicleId}, RenterId=${bookingData.renterId}`
      );
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
        renterDetails: renterData
          ? {
              id: renterDoc.id,
              username: renterData.username,
              email: renterData.email,
            }
          : null,
        vehicleDetails: vehicleData
          ? {
              id: vehicleDoc.id,
              make: vehicleData.make,
              model: vehicleData.model,
              year: vehicleData.year,
              rentalPricePerDay: vehicleData.rentalPricePerDay,
              imageUrl: vehicleData.imageUrl,
              location: vehicleData.location,
              ownerId: vehicleData.ownerId,
            }
          : null,
      });
    }

    log(`Successfully fetched ${bookings.length} bookings for user ${userId}.`);
    res.status(200).json(bookings);
  } catch (error) {
    console.error(`Error fetching bookings for user ${req.params.userId}:`, error);
    res
      .status(500)
      .json({ message: 'Error fetching user bookings.', error: error.message });
  }
};

/**
 * Get all bookings for a specific vehicle.
 */
const getBookingsByVehicle = async (req, res) => {
  try {
    const { vehicleId } = req.params;
    log(`Fetching bookings for vehicle ID: ${vehicleId}`);
    const bookingsRef = db
      .collection('bookings')
      .where('vehicleId', '==', vehicleId);
    const snapshot = await bookingsRef.get();

    if (snapshot.empty) {
      log(`No bookings found for vehicle ${vehicleId}.`);
      return res.status(200).json([]);
    }

    const bookings = [];
    snapshot.forEach((doc) => {
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

    log(
      `Successfully fetched ${bookings.length} bookings for vehicle ${vehicleId}.`
    );
    res.status(200).json(bookings);
  } catch (error) {
    console.error(
      `Error fetching bookings for vehicle ${req.params.vehicleId}:`,
      error
    );
    res
      .status(500)
      .json({ message: 'Error fetching vehicle bookings.', error: error.message });
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
      return res
        .status(400)
        .json({ message: 'Missing paymentMethod or newStatus field.' });
    }

    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    if (bookingDoc.data().renterId !== renterId) {
      return res
        .status(403)
        .json({ message: 'Unauthorized: You are not the renter for this booking.' });
    }

    await bookingRef.update({
      paymentMethod: paymentMethod,
      paymentStatus: newStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res
      .status(200)
      .json({ message: 'Payment method and status updated successfully.' });
  } catch (error) {
    console.error('Error updating booking payment method:', error);
    res.status(500).json({
      message: 'Error updating booking payment method.',
      error: error.message,
    });
  }
};

/**
 * Get a single booking by ID.
 */
const getBookingById = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();

    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const bookingData = bookingDoc.data();

    const vehicleDoc = await db.collection('vehicles').doc(bookingData.vehicleId).get();
    const vehicleData = vehicleDoc.exists ? vehicleDoc.data() : null;

    const renterDoc = await db.collection('users').doc(bookingData.renterId).get();
    const renterData = renterDoc.exists ? renterDoc.data() : null;

    let ownerData = null;
    if (vehicleData && vehicleData.ownerId) {
      const ownerDoc = await db.collection('users').doc(vehicleData.ownerId).get();
      ownerData = ownerDoc.exists ? ownerDoc.data() : null;
    }
    
    const requesterId = req.customUser.uid;
    const requesterRole = req.customUser.role;
    if (requesterRole !== 'admin' && requesterId !== bookingData.renterId && requesterId !== vehicleData.ownerId) {
        return res.status(403).json({ message: 'Unauthorized access to booking details.' });
    }

    const startDate = convertToDate(bookingData.startDate);
    const endDate = convertToDate(bookingData.endDate);
    const createdAt = convertToDate(bookingData.createdAt);

    res.status(200).json({
      id: bookingDoc.id,
      ...bookingData,
      startDate: startDate ? startDate.toISOString() : null,
      endDate: endDate ? endDate.toISOString() : null,
      createdAt: createdAt ? createdAt.toISOString() : null,
      vehicleDetails: vehicleData,
      renterDetails: renterData ? { name: `${renterData.firstName} ${renterData.lastName}`, email: renterData.email } : null,
      ownerDetails: ownerData ? { name: `${ownerData.firstName} ${ownerData.lastName}`, email: ownerData.email } : null,
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

    await bookingRef.update(updateData);

    res.status(200).json({
      message: `Booking ${bookingId} payment status successfully updated to ${newStatus}.`,
      status: newStatus,
    });
  } catch (error) {
    console.error(`Error updating booking status for ${req.params.bookingId}:`, error);
    res
      .status(500)
      .json({ message: 'Error updating booking status.', error: error.message });
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
    res
      .status(500)
      .json({ message: 'Error deleting booking.', error: error.message });
  }
};

/**
 * Confirms a booking's payment. Called by an owner or admin.
 */
const confirmBookingPayment = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const approverId = req.customUser.uid;
    const approverRole = req.customUser.role;

    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const bookingData = bookingDoc.data();
    const vehicleDoc = await db
      .collection('vehicles')
      .doc(bookingData.vehicleId)
      .get();

    if (!vehicleDoc.exists) {
      return res.status(404).json({ message: 'Associated vehicle not found.' });
    }

    const vehicleOwnerId = vehicleDoc.data().ownerId;

    if (approverRole !== 'admin' && approverId !== vehicleOwnerId) {
      log(
        `SECURITY ALERT: User ${approverId} (role: ${approverRole}) attempted to confirm payment for a vehicle they do not own (owner: ${vehicleOwnerId}).`
      );
      return res.status(403).json({
        message: 'You are not authorized to confirm payments for this vehicle.',
      });
    }

    await bookingRef.update({
      paymentStatus: 'confirmed',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    log(`Booking ${bookingId} payment confirmed by ${approverId}`);
    res.status(200).json({ message: 'Booking payment confirmed successfully.' });
  } catch (error) {
    console.error(
      `Error confirming booking payment for ${req.params.bookingId}:`,
      error
    );
    res.status(500).json({ message: 'Error confirming booking payment.' });
  }
};

/**
 * Approves a booking request. Called by an owner or admin.
 */
const approveBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const approverId = req.customUser.uid;
    const approverRole = req.customUser.role;

    const bookingRef = db.collection('bookings').doc(bookingId);
    
    await db.runTransaction(async (transaction) => {
      // --- (1) READ PHASE ---
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) throw new Error('Booking not found.');

      const bookingData = bookingDoc.data();
      const ownerRef = db.collection('users').doc(bookingData.ownerId);
      const vehicleRef = db.collection('vehicles').doc(bookingData.vehicleId);

      const [ownerDoc, vehicleDoc] = await Promise.all([
        transaction.get(ownerRef),
        transaction.get(vehicleRef)
      ]);

      if (!ownerDoc.exists) throw new Error('Owner profile not found.');
      if (!vehicleDoc.exists) throw new Error('Associated vehicle not found.');
      
      // --- (2) LOGIC & PREPARATION PHASE ---
      if (approverRole !== 'admin' && approverId !== bookingData.ownerId) {
        throw new Error('You are not authorized to approve this booking.');
      }

      const ownerData = ownerDoc.data();
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
      const monthlyCounts = ownerData.monthlyBookingCounts || {};
      monthlyCounts[monthKey] = (monthlyCounts[monthKey] || 0) + 1;

      const vehicleData = vehicleDoc.data();
      
      const currentAvailability = Array.isArray(vehicleData.availability) ? vehicleData.availability : [];
      
      const newUnavailableRange = {
        start: bookingData.startDate,
        end: bookingData.endDate,
        bookingId: bookingId,
      };

      // --- (3) WRITE PHASE ---
      transaction.update(ownerRef, { monthlyBookingCounts: monthlyCounts });
      transaction.update(vehicleRef, { availability: [...currentAvailability, newUnavailableRange] });
      transaction.update(bookingRef, {
        paymentStatus: 'confirmed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      const chatRef = db.collection('chats').doc(bookingId);
      transaction.set(chatRef, {
        bookingId: bookingId,
        ownerId: bookingData.ownerId,
        renterId: bookingData.renterId,
        participants: [bookingData.ownerId, bookingData.renterId],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMessage: {
          text: 'Booking confirmed! You can now chat to arrange the meetup.',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          senderId: 'system',
          readBy: [approverId],
        },
      });
    });

    const updatedOwnerDoc = await db.collection('users').doc(approverId).get();
    res.status(200).json({ 
      message: 'Booking request approved, chat created, and calendar updated.',
      updatedOwner: updatedOwnerDoc.data()
    });
  } catch (error) {
    console.error('Error approving booking request:', error);
    res.status(500).json({ message: error.message || 'Error approving booking request.' });
  }
};

/**
 * Declines a booking request. Called by an owner or admin.
 */
const declineBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const declinerId = req.customUser.uid;

    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const bookingData = bookingDoc.data();
    if (req.customUser.role !== 'admin' && declinerId !== bookingData.ownerId) {
        return res.status(403).json({ message: 'You are not authorized to decline this booking.' });
    }
    
    await bookingRef.update({
      paymentStatus: 'declined_by_owner',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({ message: 'Booking request declined.' });
  } catch (error) {
    res.status(500).json({ message: 'Error declining booking request.' });
  }
};

/**
 * Get all bookings for vehicles owned by the authenticated user.
 */
const getOwnerBookings = async (req, res) => {
    try {
        const ownerId = req.customUser.uid;
        log(`Fetching bookings for vehicles owned by user ID: ${ownerId}`);

        const vehiclesRef = db.collection('vehicles').where('ownerId', '==', ownerId);
        const vehiclesSnapshot = await vehiclesRef.get();

        if (vehiclesSnapshot.empty) {
            return res.status(200).json([]);
        }

        const vehicleIds = vehiclesSnapshot.docs.map(doc => doc.id);
        const vehiclesMap = new Map(vehiclesSnapshot.docs.map(doc => [doc.id, doc.data()]));

        const bookingsRef = db.collection('bookings').where('vehicleId', 'in', vehicleIds);
        const bookingsSnapshot = await bookingsRef.get();

        if (bookingsSnapshot.empty) {
            return res.status(200).json([]);
        }

        const bookingsData = bookingsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const renterIds = [...new Set(bookingsData.map(b => b.renterId).filter(Boolean))];
        const renterPromises = renterIds.map(id => db.collection('users').doc(id).get());
        const renterDocs = await Promise.all(renterPromises);
        
        const rentersMap = new Map();
        renterDocs.forEach(doc => {
            if (doc.exists) {
                rentersMap.set(doc.id, doc.data());
            }
        });

        const enrichedBookings = bookingsData.map(booking => {
            const vehicleData = vehiclesMap.get(booking.vehicleId);
            const renterData = rentersMap.get(booking.renterId);

            const startDate = convertToDate(booking.startDate);
            const endDate = convertToDate(booking.endDate);

            return {
                id: booking.id,
                ...booking,
                startDate: startDate ? startDate.toISOString() : null,
                endDate: endDate ? endDate.toISOString() : null,
                renterDetails: renterData ? {
                    username: `${renterData.firstName || ''} ${renterData.lastName || ''}`.trim(),
                } : { username: 'N/A' },
                vehicleDetails: vehicleData ? {
                    make: vehicleData.make,
                    model: vehicleData.model,
                } : { make: 'Unknown', model: 'Vehicle' },
            };
        });

        res.status(200).json(enrichedBookings);
    } catch (error) {
        console.error('[BookingController] Error fetching owner bookings:', error);
        res.status(500).json({ message: 'Error fetching owner bookings.' });
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
  confirmBookingPayment,
  approveBooking,
  declineBooking,
  getOwnerBookings,
};


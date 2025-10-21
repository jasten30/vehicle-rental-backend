const { admin, db } = require('../utils/firebase');
const { createNotification } = require('../utils/notificationHelper'); 
const { DateTime } = require('luxon');

// Helper function for consistent logging
const log = (message) => {
  console.log(`[BookingController] ${message}`);
};

// Helper function to safely convert Firestore Timestamp or ISO string to Date object
const convertToDate = (value) => {
  if (value instanceof admin.firestore.Timestamp) {
    return value.toDate(); // Keep handling Firestore Timestamps
  }
  if (typeof value === 'string') {
    // Use Luxon to parse the ISO string robustly
    const dt = DateTime.fromISO(value, { zone: 'utc' }); // Parse as UTC initially or specify expected zone if known
    return dt.isValid ? dt.toJSDate() : null; // Return JS Date if valid, else null
  }
  return null;
};

const getAllBookings = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    log('Fetching all bookings...');

    let bookingsQuery = db.collection('bookings');

    if (startDate) {
      bookingsQuery = bookingsQuery.where('createdAt', '>=', new Date(startDate));
    }
    if (endDate) {
      bookingsQuery = bookingsQuery.where('createdAt', '<=', new Date(endDate + 'T23:59:59'));
    }

    const bookingsSnapshot = await bookingsQuery.get();

    if (bookingsSnapshot.empty) {
      return res.status(200).json([]);
    }

    const bookingsData = bookingsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const vehicleIds = [...new Set(bookingsData.map((b) => b.vehicleId).filter(Boolean))];
    const renterIds = [...new Set(bookingsData.map((b) => b.renterId).filter(Boolean))];

    const vehiclePromises = vehicleIds.map((id) => db.collection('vehicles').doc(id).get());
    const renterPromises = renterIds.map((id) => db.collection('users').doc(id).get());

    const [vehicleDocs, renterDocs] = await Promise.all([Promise.all(vehiclePromises), Promise.all(renterPromises)]);

    const vehiclesMap = new Map(vehicleDocs.map(doc => doc.exists ? [doc.id, doc.data()] : null).filter(Boolean));
    const rentersMap = new Map(renterDocs.map(doc => doc.exists ? [doc.id, doc.data()] : null).filter(Boolean));

    const enrichedBookings = bookingsData.map((booking) => {
      const vehicle = vehiclesMap.get(booking.vehicleId);
      const renter = rentersMap.get(booking.renterId);
      return {
        ...booking,
        startDate: convertToDate(booking.startDate)?.toISOString() || null,
        endDate: convertToDate(booking.endDate)?.toISOString() || null,
        createdAt: convertToDate(booking.createdAt)?.toISOString() || null,
        vehicleName: vehicle ? `${vehicle.make} ${vehicle.model}` : 'Unknown Vehicle',
        renterEmail: renter ? renter.email : 'Unknown Renter',
      };
    });

    res.status(200).json(enrichedBookings);
  } catch (error) {
    console.error('[BookingController] Error fetching all bookings:', error);
    res.status(500).json({ message: 'Server error fetching bookings.', error: error.message });
  }
};

const createBooking = async (req, res) => {
  try {
    const { vehicleId, startDate, endDate } = req.body; // Removed totalCost from body destructuring
    const renterId = req.customUser.uid;

    if (!vehicleId || !startDate || !endDate) {
      return res.status(400).json({ message: 'Missing required booking fields (vehicleId, startDate, endDate).' });
    }

    // 1. Validate and Parse Dates
    const start = convertToDate(startDate);
    const end = convertToDate(endDate);

    if (!start || !end || start >= end) {
      return res.status(400).json({ message: 'Invalid start or end date/time.' });
    }

    // 2. Fetch Vehicle and Verify Rate
    const vehicleRef = db.collection('vehicles').doc(vehicleId);
    const vehicleDoc = await vehicleRef.get();
    if (!vehicleDoc.exists) {
      return res.status(404).json({ message: 'Vehicle not found.' });
    }
    const vehicleData = vehicleDoc.data();
    const ownerId = vehicleData.ownerId;
    const rentalPricePerDay = parseFloat(vehicleData.rentalPricePerDay);

    if (isNaN(rentalPricePerDay) || rentalPricePerDay <= 0) {
      return res.status(500).json({ message: 'Vehicle rental price is invalid or not set. Cannot create booking.' });
    }

    // 3. Recalculate Cost on Backend (Security Measure)
    const diffMilliseconds = end.getTime() - start.getTime();
    const diffHours = diffMilliseconds / (1000 * 60 * 60);
    const calculatedDays = Math.ceil(diffHours / 24);
    const billableDays = calculatedDays > 0 ? calculatedDays : 1;
    const backendTotalCost = parseFloat((rentalPricePerDay * billableDays).toFixed(2));

    // 4. Calculate Downpayment and Balance
    const downPayment = parseFloat((backendTotalCost * 0.20).toFixed(2));
    const remainingBalance = parseFloat((backendTotalCost - downPayment).toFixed(2));

    // 5. Prepare Booking Data
    const newBooking = {
      vehicleId,
      renterId,
      ownerId,
      // Store as Firestore Timestamps
      startDate: admin.firestore.Timestamp.fromDate(start),
      endDate: admin.firestore.Timestamp.fromDate(end),
      totalCost: backendTotalCost, // Use backend calculated cost
      downPayment: downPayment,
      remainingBalance: remainingBalance,
      amountPaid: 0,
      paymentStatus: 'pending_owner_approval',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // 6. Save Booking
    const docRef = await db.collection('bookings').add(newBooking);

    // 7. Send Notification
    await createNotification(
      ownerId,
      `You have a new booking request for your ${vehicleData.make || 'vehicle'}.`,
      `/booking/${docRef.id}` // Use actual booking ID
    );

    log(`Booking request created with ID: ${docRef.id}`);
    // Return the full booking data including the calculated cost and ID
    res.status(201).json({ id: docRef.id, ...newBooking });

  } catch (error) {
    console.error('[BookingController] Error creating booking:', error);
    // Provide more specific error message if possible
    res.status(500).json({ message: 'Error creating booking request.', error: error.message });
  }
};

const apiCheckAvailability = async (req, res) => {
  // --- ADD THIS LOGGING ---
  console.log('[BookingController] Checking availability with query:', req.query);
  // --- END LOGGING ---
  try {
    const { vehicleId } = req.params;
    const { startDate, endDate } = req.query; // Expecting full ISO strings now

    // 1. Validate and Parse Dates
    if (!startDate || !endDate) {
      // --- ADD LOGGING ---
        console.error('[BookingController] Availability check failed: Missing startDate or endDate.');
        // --- END LOGGING ---
        return res.status(400).json({ isAvailable: false, message: 'Start date and end date are required.' });
    }
    const requestedStart = convertToDate(startDate);
    const requestedEnd = convertToDate(endDate);

    // --- ADD LOGGING ---
    console.log('[BookingController] Parsed Dates - Start:', requestedStart, 'End:', requestedEnd);
    // --- END LOGGING ---

    if (!requestedStart || !requestedEnd || requestedStart >= requestedEnd) {
      // --- ADD LOGGING ---
      console.error('[BookingController] Availability check failed: Invalid date/time range.');
      // --- END LOGGING ---
      return res.status(400).json({ isAvailable: false, message: 'Invalid date/time range provided.' });
    }

    // 2. Check Vehicle Existence
    const vehicleDoc = await db.collection('vehicles').doc(vehicleId).get();
    if (!vehicleDoc.exists) {
      return res.status(404).json({ isAvailable: false, message: 'Vehicle not found.' });
    }
    const vehicleData = vehicleDoc.data();

    // 3. Check Manual Unavailability Periods (Owner Blocks)
    const unavailablePeriods = vehicleData.availability || [];
    for (const period of unavailablePeriods) {
      const periodStart = convertToDate(period.start); // Assumes period.start/end are Timestamps or ISO strings
      const periodEnd = convertToDate(period.end);
      if (periodStart && periodEnd && requestedStart < periodEnd && requestedEnd > periodStart) {
        return res.status(200).json({ isAvailable: false, message: 'Vehicle is unavailable (owner block) during the requested times.' });
      }
    }

    // 4. Check Confirmed Bookings Overlap
    const bookingsRef = db.collection('bookings')
                         .where('vehicleId', '==', vehicleId)
                         .where('paymentStatus', '==', 'confirmed'); // Only check against confirmed bookings

    const snapshot = await bookingsRef.get();
    let isOverlapping = false;
    snapshot.forEach((doc) => {
      const booking = doc.data();
      // Compare Date objects derived from Timestamps/ISO strings
      const bookingStart = convertToDate(booking.startDate);
      const bookingEnd = convertToDate(booking.endDate);
      if (bookingStart && bookingEnd && requestedStart < bookingEnd && requestedEnd > bookingStart) {
        isOverlapping = true;
      }
    });

    if (isOverlapping) {
      return res.status(200).json({ isAvailable: false, message: 'Vehicle is already booked during some of the requested times.' });
    }

    // 5. Calculate Cost based on 24-hour periods
    const rentalPricePerDay = parseFloat(vehicleData.rentalPricePerDay);
    if (isNaN(rentalPricePerDay) || rentalPricePerDay <= 0) {
      return res.status(500).json({ isAvailable: false, message: 'Vehicle rental price is invalid or not set.' });
    }

    const diffMilliseconds = requestedEnd.getTime() - requestedStart.getTime();
    const diffHours = diffMilliseconds / (1000 * 60 * 60);

    // Calculate days based on 24-hour blocks, rounding UP
    const calculatedDays = Math.ceil(diffHours / 24);

    // Ensure at least 1 day is charged if there's any duration
    const billableDays = calculatedDays > 0 ? calculatedDays : 1;

    const totalCost = parseFloat((rentalPricePerDay * billableDays).toFixed(2));

    res.status(200).json({
        isAvailable: true,
        message: 'Vehicle is available for the selected dates.',
        totalCost // Send the calculated cost
    });

  } catch (error) {
    console.error('[BookingController] Error checking vehicle availability:', error);
    res.status(500).json({ isAvailable: false, message: 'Server error checking availability.', error: error.message });
  }
};

const getBookingsByUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const requesterId = req.customUser.uid;
    const requesterRole = req.customUser.role;

    if (requesterId !== userId && requesterRole !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized: You can only view your own bookings.' });
    }

    const bookingsRef = db.collection('bookings').where('renterId', '==', userId);
    const snapshot = await bookingsRef.get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    const bookings = await Promise.all(snapshot.docs.map(async (doc) => {
      const bookingData = doc.data();
      const vehicleDoc = await db.collection('vehicles').doc(bookingData.vehicleId).get();
      const renterDoc = await db.collection('users').doc(bookingData.renterId).get();
      
      return {
        id: doc.id,
        ...bookingData,
        startDate: convertToDate(bookingData.startDate)?.toISOString() || null,
        endDate: convertToDate(bookingData.endDate)?.toISOString() || null,
        createdAt: convertToDate(bookingData.createdAt)?.toISOString() || null,
        renterDetails: renterDoc.exists ? { id: renterDoc.id, ...renterDoc.data() } : null,
        vehicleDetails: vehicleDoc.exists ? { id: vehicleDoc.id, ...vehicleDoc.data() } : null,
      };
    }));

    res.status(200).json(bookings);
  } catch (error) {
    console.error(`Error fetching bookings for user ${req.params.userId}:`, error);
    res.status(500).json({ message: 'Error fetching user bookings.', error: error.message });
  }
};

const getBookingsByVehicle = async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const bookingsRef = db.collection('bookings').where('vehicleId', '==', vehicleId);
    const snapshot = await bookingsRef.get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    const bookings = snapshot.docs.map(doc => {
        const bookingData = doc.data();
        return {
            id: doc.id,
            ...bookingData,
            startDate: convertToDate(bookingData.startDate)?.toISOString() || null,
            endDate: convertToDate(bookingData.endDate)?.toISOString() || null,
            createdAt: convertToDate(bookingData.createdAt)?.toISOString() || null,
        }
    });

    res.status(200).json(bookings);
  } catch (error) {
    console.error(`Error fetching bookings for vehicle ${req.params.vehicleId}:`, error);
    res.status(500).json({ message: 'Error fetching vehicle bookings.', error: error.message });
  }
};

const getBookingById = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();

    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const bookingData = bookingDoc.data();
    const [vehicleDoc, renterDoc] = await Promise.all([
        db.collection('vehicles').doc(bookingData.vehicleId).get(),
        db.collection('users').doc(bookingData.renterId).get()
    ]);
    
    const vehicleData = vehicleDoc.exists ? vehicleDoc.data() : null;
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

    res.status(200).json({
      id: bookingDoc.id,
      ...bookingData,
      startDate: convertToDate(bookingData.startDate)?.toISOString() || null,
      endDate: convertToDate(bookingData.endDate)?.toISOString() || null,
      createdAt: convertToDate(bookingData.createdAt)?.toISOString() || null,
      vehicleDetails: vehicleData,
      renterDetails: renterDoc.exists ? { name: `${renterDoc.data().firstName} ${renterDoc.data().lastName}`, email: renterDoc.data().email } : null,
      ownerDetails: ownerData ? { name: `${ownerData.firstName} ${ownerData.lastName}`, email: ownerData.email } : null,
    });
  } catch (error) {
    console.error(`Error fetching booking by ID ${req.params.bookingId}:`, error);
    res.status(500).json({ message: 'Error fetching booking.', error: error.message });
  }
};

const approveBooking = async (req, res) => {
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
    if (approverRole !== 'admin' && approverId !== bookingData.ownerId) {
        return res.status(403).json({ message: 'You are not authorized to approve this booking.' });
    }
    
    if (bookingData.paymentStatus !== 'pending_owner_approval') {
        return res.status(400).json({ message: `This booking is not pending approval. Current status: ${bookingData.paymentStatus}` });
    }
    
    await bookingRef.update({
      paymentStatus: 'pending_payment',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await createNotification(
      bookingData.renterId,
      `Your booking request has been approved! Please proceed with payment.`,
      `/booking/${bookingId}`
    );

    res.status(200).json({ message: 'Booking request approved. Awaiting payment from renter.' });
  } catch (error) {
    console.error('Error approving booking request:', error);
    res.status(500).json({ message: error.message || 'Error approving booking request.' });
  }
};

const declineBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const declinerId = req.customUser.uid;
    const approverRole = req.customUser.role;

    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const bookingData = bookingDoc.data();
    if (approverRole !== 'admin' && declinerId !== bookingData.ownerId) {
        return res.status(403).json({ message: 'You are not authorized to decline this booking.' });
    }
    
    await bookingRef.update({
      paymentStatus: 'declined_by_owner',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await createNotification(
      bookingData.renterId,
      `Unfortunately, your booking request has been declined.`,
      `/booking/${bookingId}`
    );

    log(`Booking ${bookingId} declined by ${declinerId}.`);
    res.status(200).json({ message: 'Booking request declined.' });
  } catch (error) {
    console.error('Error declining booking:', error);
    res.status(500).json({ message: 'Error declining booking request.' });
  }
};

const confirmDownpaymentByUser = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { referenceNumber } = req.body; // 👈 Get referenceNumber from body
        const renterId = req.customUser.uid;

        // 👇 Add validation for referenceNumber
        if (!referenceNumber) {
             return res.status(400).json({ message: 'Reference number is required.' });
        }

        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        const bookingData = bookingDoc.data();
        if (bookingData.renterId !== renterId) {
            return res.status(403).json({ message: 'You are not authorized to update this booking.' });
        }

        if (bookingData.paymentStatus !== 'pending_payment') {
            return res.status(400).json({ message: `Booking is not awaiting payment. Current status: ${bookingData.paymentStatus}` });
        }

        // 👇 Add referenceNumber to the update
        await bookingRef.update({
            paymentStatus: 'downpayment_pending_verification',
            paymentReferenceNumber: referenceNumber, // Save the reference number
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Notify owner (existing logic)
        await createNotification(
          bookingData.ownerId,
          `Renter submitted payment (Ref: ${referenceNumber}) for booking #${bookingId.substring(0, 5)}. Please verify.`, // Include ref in notification
          `/booking/${bookingId}`
        );

        log(`Downpayment for booking ${bookingId} confirmed by user. Ref: ${referenceNumber}. Awaiting owner verification.`);
        res.status(200).json({ message: 'Payment submitted for verification.' });

    } catch (error) {
        console.error('Error confirming downpayment by user:', error);
        res.status(500).json({ message: 'Server error during payment confirmation.' });
    }
};

const confirmBookingPayment = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const approverId = req.customUser.uid;
    const approverRole = req.customUser.role;
    let renterIdToNotify;

    const bookingRef = db.collection('bookings').doc(bookingId);
    
    await db.runTransaction(async (transaction) => {
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) throw new Error('Booking not found.');

      const bookingData = bookingDoc.data();
      renterIdToNotify = bookingData.renterId;
      const vehicleRef = db.collection('vehicles').doc(bookingData.vehicleId);
      const vehicleDoc = await transaction.get(vehicleRef);
      if (!vehicleDoc.exists) throw new Error('Associated vehicle not found.');
      
      if (approverRole !== 'admin' && approverId !== bookingData.ownerId) {
        throw new Error('You are not authorized to confirm payments for this booking.');
      }

      if (bookingData.paymentStatus !== 'downpayment_pending_verification') {
        throw new Error(`Booking is not awaiting payment verification. Current status: ${bookingData.paymentStatus}`);
      }

      const vehicleData = vehicleDoc.data();
      const currentAvailability = Array.isArray(vehicleData.availability) ? vehicleData.availability : [];
      const newUnavailableRange = {
        start: bookingData.startDate,
        end: bookingData.endDate,
        bookingId: bookingId,
      };

      transaction.update(vehicleRef, { availability: [...currentAvailability, newUnavailableRange] });

      transaction.update(bookingRef, {
        paymentStatus: 'confirmed',
        amountPaid: bookingData.downPayment,
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

    if (renterIdToNotify) {
      await createNotification(
        renterIdToNotify,
        `Your booking is confirmed! The owner has verified your payment.`,
        `/booking/${bookingId}`
      );
    }

    log(`Booking ${bookingId} downpayment confirmed and finalized by owner ${approverId}.`);
    res.status(200).json({ 
      message: 'Downpayment confirmed. Booking is now finalized, chat created, and calendar updated.'
    });

  } catch (error) {
    console.error(`Error confirming booking payment for ${req.params.bookingId}:`, error);
    res.status(500).json({ message: error.message || 'Error confirming booking payment.' });
  }
};

const confirmOwnerPayment = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const verifierId = req.customUser.uid;
        const verifierRole = req.customUser.role;

        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        const bookingData = bookingDoc.data();
        if (verifierRole !== 'admin' && verifierId !== bookingData.ownerId) {
            return res.status(403).json({ message: 'You are not authorized to verify this payment.' });
        }
        
        if (bookingData.paymentStatus !== 'downpayment_pending_verification') {
            return res.status(400).json({ message: `Booking is not awaiting verification. Current status: ${bookingData.paymentStatus}` });
        }

        await bookingRef.update({
            paymentStatus: 'downpayment_verified',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        
        log(`Downpayment for booking ${bookingId} was verified by owner ${verifierId}.`);
        res.status(200).json({ message: 'Payment successfully verified.' });
    } catch (error) {
        console.error('Error in confirmOwnerPayment controller:', error);
        res.status(500).json({ message: 'Server error while verifying payment.', error: error.message });
    }
};

const getOwnerBookings = async (req, res) => {
    try {
        const ownerId = req.customUser.uid;
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
            return {
                ...booking,
                startDate: convertToDate(booking.startDate)?.toISOString() || null,
                endDate: convertToDate(booking.endDate)?.toISOString() || null,
                renterDetails: rentersMap.get(booking.renterId) || { username: 'N/A' },
                vehicleDetails: vehiclesMap.get(booking.vehicleId) || { make: 'Unknown', model: 'Vehicle' },
            };
        });

        res.status(200).json(enrichedBookings);
    } catch (error) {
        console.error('[BookingController] Error fetching owner bookings:', error);
        res.status(500).json({ message: 'Error fetching owner bookings.' });
    }
};

const updateBookingPaymentMethod = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { paymentMethod, newStatus } = req.body;
    const renterId = req.customUser.uid;

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
    res.status(500).json({ message: 'Error updating booking payment method.', error: error.message });
  }
};

const updateBookingStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { newStatus } = req.body;
    const userId = req.customUser.uid; // Get current user ID
    const userRole = req.customUser.role; // Get current user role

    // --- 1. Validate Input ---
    if (!newStatus) {
        console.error(`[BookingController] updateBookingStatus failed for booking ${bookingId}: Missing newStatus.`);
        return res.status(400).json({ message: 'New status is required.' });
    }

    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get(); // Fetch the document once

    if (!bookingDoc.exists) {
      console.error(`[BookingController] updateBookingStatus failed: Booking ${bookingId} not found.`);
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const bookingData = bookingDoc.data();

    // --- 2. Authorization Check ---
    // Only owner or admin should update status via this generic endpoint
    if (userRole !== 'admin' && userId !== bookingData.ownerId) {
        console.warn(`[BookingController] updateBookingStatus unauthorized attempt by user ${userId} (role: ${userRole}) on booking ${bookingId} owned by ${bookingData.ownerId}.`);
        return res.status(403).json({ message: 'Forbidden: You are not authorized to update this booking status.' });
    }

    // --- 3. Update Firestore Document ---
    await bookingRef.update({
      paymentStatus: newStatus,
      // Use 'updatedAt' for consistency with other updates
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // --- 4. Send Notification (Conditional) ---
    // Notify renter when owner marks as returned
    if (newStatus === 'returned' && bookingData.renterId) {
        try {
            await createNotification(
                bookingData.renterId, // Notify the renter
                `The owner has marked your trip for booking #${bookingId.substring(0,5)} as returned.`,
                `/booking/${bookingId}` // Link to the booking details
            );
        } catch (notificationError) {
            // Log notification error but don't fail the main request
            console.error(`[BookingController] Failed to send 'returned' notification for booking ${bookingId}:`, notificationError);
        }
    }

    // --- 5. Log Success and Respond ---
    log(`Booking ${bookingId} status updated to ${newStatus} by user ${userId}.`);
    res.status(200).json({ message: `Booking status updated successfully to ${newStatus}.` });

  } catch (error) {
    console.error(`[BookingController] Error updating booking status for ${req.params.bookingId} to ${req.body.newStatus}:`, error);
    res.status(500).json({ message: 'Error updating booking status.', error: error.message });
  }
};

const deleteBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    await db.collection('bookings').doc(bookingId).delete();
    res.status(200).json({ message: 'Booking deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting booking.', error: error.message });
  }
};

const cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const renterId = req.customUser.uid;

    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const bookingData = bookingDoc.data();

    // 1. Verify Ownership
    if (bookingData.renterId !== renterId) {
      return res.status(403).json({ message: 'Forbidden: You can only cancel your own bookings.' });
    }

    // 2. Check Cancellable Status (UPDATED)
    const cancellableStatuses = [
      'pending_owner_approval', // Can cancel before owner approves
      'pending_payment'        // Can cancel after owner approves but BEFORE renter pays
      // REMOVED: 'downpayment_pending_verification', 'downpayment_verified', 'confirmed'
    ];
    if (!cancellableStatuses.includes(bookingData.paymentStatus)) {
      return res.status(400).json({ message: `Booking cannot be cancelled in its current state (${bookingData.paymentStatus}). Payment may have already been submitted or confirmed.` });
    }

    // 3. Update Booking Status
    await bookingRef.update({
      paymentStatus: 'cancelled_by_renter',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 4. Remove calendar block (if applicable - though unlikely needed now if only cancelling before confirmed)
    if (bookingData.paymentStatus === 'confirmed') { // This check might be redundant now but safe to keep
        const vehicleRef = db.collection('vehicles').doc(bookingData.vehicleId);
        try {
            await db.runTransaction(async (transaction) => {
                const vehicleDoc = await transaction.get(vehicleRef);
                if (vehicleDoc.exists) {
                    const vehicleData = vehicleDoc.data();
                    const currentAvailability = Array.isArray(vehicleData.availability) ? vehicleData.availability : [];
                    const updatedAvailability = currentAvailability.filter(block => block.bookingId !== bookingId);
                    transaction.update(vehicleRef, { availability: updatedAvailability });
                }
            });
            log(`Removed availability block for cancelled booking ${bookingId}`);
        } catch (transactionError) {
             console.error(`Failed to remove availability block for cancelled booking ${bookingId}:`, transactionError);
        }
    }

    // 5. Notify Owner
    await createNotification(
      bookingData.ownerId,
      `Booking #${bookingId.substring(0, 5)} has been cancelled by the renter.`,
      `/booking/${bookingId}`
    );

    log(`Booking ${bookingId} cancelled by renter ${renterId}.`);
    res.status(200).json({ message: 'Booking cancelled successfully.' });

  } catch (error) {
    console.error(`Error cancelling booking ${req.params.bookingId}:`, error);
    res.status(500).json({ message: 'Server error while cancelling booking.', error: error.message });
  }
};

const submitBookingReport = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { reason, details, reporterRole } = req.body;
        const reporterId = req.customUser.uid; 

        if (!reason || !details) {
            return res.status(400).json({ message: 'Reason and details are required for the report.' });
        }

        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Booking not found.' });
        }
        const bookingData = bookingDoc.data();

        // Optional: Check if reporter is owner or renter for authorization
        if (reporterId !== bookingData.renterId && reporterId !== bookingData.ownerId) {
             return res.status(403).json({ message: 'You are not authorized to report on this booking.' });
        }

        // Save the report (e.g., in a 'reports' subcollection or separate collection)
        const reportData = {
            bookingId,
            reporterId,
            reporterRole: reporterRole || 'unknown',
            reportedAt: admin.firestore.FieldValue.serverTimestamp(),
            reason,
            details,
            status: 'submitted', 
            vehicleId: bookingData.vehicleId, 
            ownerId: bookingData.ownerId,
            renterId: bookingData.renterId,
        };
        
        const reportRef = await db.collection('reports').add(reportData);

        log(`Report submitted for booking ${bookingId} by user ${reporterId}. Report ID: ${reportRef.id}`);
        res.status(201).json({ message: 'Report submitted successfully.', reportId: reportRef.id });

    } catch (error) {
        console.error(`Error submitting report for booking ${req.params.bookingId}:`, error);
        res.status(500).json({ message: 'Server error submitting report.', error: error.message });
    }
};

const requestBookingExtension = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { extensionHours } = req.body;
        const renterId = req.customUser.uid;

        // --- 1. Validation ---
        const hours = parseInt(extensionHours, 10);
        if (isNaN(hours) || hours <= 0) {
            return res.status(400).json({ message: 'Invalid number of extension hours provided.' });
        }

        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Booking not found.' });
        }
        const bookingData = bookingDoc.data();

        // Check if requester is the renter
        if (bookingData.renterId !== renterId) {
            return res.status(403).json({ message: 'Forbidden: You cannot extend this booking.' });
        }
        // Check if booking status allows extension (must be 'confirmed')
        if (bookingData.paymentStatus !== 'confirmed') {
             return res.status(400).json({ message: `Booking cannot be extended in its current state (${bookingData.paymentStatus}).` });
        }

        // --- 2. Calculate New End Date & Fetch Vehicle ---
        const currentEndDate = convertToDate(bookingData.endDate); // Uses your existing helper
        if (!currentEndDate) {
             throw new Error("Could not parse current booking end date.");
        }
        const newEndDate = DateTime.fromJSDate(currentEndDate).plus({ hours: hours }).toJSDate();

        const vehicleRef = db.collection('vehicles').doc(bookingData.vehicleId);
        const vehicleDoc = await vehicleRef.get();
        if (!vehicleDoc.exists) {
             return res.status(404).json({ message: 'Associated vehicle not found.' });
        }
        const vehicleData = vehicleDoc.data();
        const rentalPricePerDay = parseFloat(vehicleData.rentalPricePerDay);
        if (isNaN(rentalPricePerDay) || rentalPricePerDay <= 0) {
            return res.status(500).json({ message: 'Vehicle rental price is invalid.' });
        }

        // --- 3. Check Availability for Extended Period ---
        const extendedStartCheck = DateTime.fromJSDate(currentEndDate).plus({ minutes: 1 }).toJSDate(); // Check from *after* original end
        const extendedEndCheck = newEndDate;

        // Check Owner Blocks
        const unavailablePeriods = vehicleData.availability || [];
        for (const period of unavailablePeriods) {
            const periodStart = convertToDate(period.start);
            const periodEnd = convertToDate(period.end);
            if (periodStart && periodEnd && extendedStartCheck < periodEnd && extendedEndCheck > periodStart) {
                return res.status(409).json({ message: 'Vehicle is unavailable (owner block) during the requested extension period.' });
            }
        }
        // Check Other Confirmed Bookings
        const otherBookingsSnapshot = await db.collection('bookings')
            .where('vehicleId', '==', bookingData.vehicleId)
            .where('paymentStatus', '==', 'confirmed')
            .get();

        let overlapFound = false;
        otherBookingsSnapshot.forEach((doc) => {
            if (doc.id === bookingId) return; // Skip self
            const otherBooking = doc.data();
            const otherStart = convertToDate(otherBooking.startDate);
            const otherEnd = convertToDate(otherBooking.endDate);
            if (otherStart && otherEnd && extendedStartCheck < otherEnd && extendedEndCheck > otherStart) {
                overlapFound = true;
            }
        });
        if (overlapFound) {
             return res.status(409).json({ message: 'Vehicle is booked by someone else during the requested extension period.' });
        }

        // --- 4. Calculate Extension Cost ---
        const hourlyRate = rentalPricePerDay / 24;
        const extensionCost = parseFloat((hourlyRate * hours).toFixed(2));

        // --- 5. Update Booking Document ---
         await bookingRef.update({
             extensionRequest: {
                 requestedAt: admin.firestore.FieldValue.serverTimestamp(),
                 hours: hours,
                 cost: extensionCost,
                 newEndDate: admin.firestore.Timestamp.fromDate(newEndDate),
                 status: 'pending_payment',
             },
             paymentStatus: 'pending_extension_payment',
             updatedAt: admin.firestore.FieldValue.serverTimestamp()
         });


        // --- 6. Notify Owner ---
        await createNotification(
            bookingData.ownerId,
            `Renter requested a ${hours}-hour extension for booking #${bookingId.substring(0,5)}. Cost: ₱${extensionCost.toFixed(2)}.`,
            `/booking/${bookingId}`
        );

        log(`Extension of ${hours} hours requested for booking ${bookingId} by renter ${renterId}. Cost: ${extensionCost}`);
        res.status(200).json({
             message: 'Extension requested successfully. Awaiting payment.',
             extensionCost: extensionCost,
             newEndDate: newEndDate.toISOString()
         });

    } catch (error) {
        console.error(`Error requesting extension for booking ${req.params.bookingId}:`, error);
        res.status(500).json({ message: 'Server error requesting booking extension.', error: error.message });
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
  confirmDownpaymentByUser,
  confirmOwnerPayment,
  cancelBooking,
  submitBookingReport,
  requestBookingExtension,
};
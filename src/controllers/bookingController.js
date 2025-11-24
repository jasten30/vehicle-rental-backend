const { admin, db, storageBucket } = require('../utils/firebase');
const { createNotification } = require('../utils/notificationHelper'); 
const { DateTime } = require('luxon');
const PDFDocument = require('pdfkit'); // <-- This is required for PDF generation
const path = require('path');

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

// ================================================
//  HELPER FUNCTION
// ================================================
/**
 * Extracts key user details from a user document snapshot.
 * @param {admin.firestore.DocumentSnapshot} userDoc - The Firestore user document.
 * @returns {object | null} A clean object with user details or null.
 */
const extractUserDetails = (userDoc) => {
  if (!userDoc || !userDoc.exists) {
    return { name: 'Unknown User', email: 'N/A', profilePhotoUrl: null, payoutQRCodeUrl: null, phoneNumber: 'N/A' };
  }
  const userData = userDoc.data();
  return {
    uid: userDoc.id,
    name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'User',
    email: userData.email || 'N/A',
    profilePhotoUrl: userData.profilePhotoUrl || null,
    payoutQRCodeUrl: userData.payoutQRCodeUrl || null,
    payoutDetails: userData.payoutDetails || null,
    phoneNumber: userData.phoneNumber || 'N/A'
  };
};
// ================================================

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
    const rentersMap = new Map(renterDocs.map(doc => doc.exists ? [doc.id, extractUserDetails(doc)] : null).filter(Boolean)); // Use helper

    const enrichedBookings = bookingsData.map((booking) => {
      const vehicle = vehiclesMap.get(booking.vehicleId);
      const renter = rentersMap.get(booking.renterId);
      return {
        ...booking,
        startDate: convertToDate(booking.startDate)?.toISOString() || null,
        endDate: convertToDate(booking.endDate)?.toISOString() || null,
        createdAt: convertToDate(booking.createdAt)?.toISOString() || null,
        vehicleName: vehicle ? `${vehicle.make} ${vehicle.model}` : 'Unknown Vehicle',
        renterDetails: renter,
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
    const { vehicleId, startDate, endDate } = req.body;
    const renterId = req.customUser.uid; // This is the user trying to book

    if (!vehicleId || !startDate || !endDate) {
      return res.status(400).json({ message: 'Missing required booking fields (vehicleId, startDate, endDate).' });
    }

    const start = convertToDate(startDate);
    const end = convertToDate(endDate);

    if (!start || !end || start >= end) {
      return res.status(400).json({ message: 'Invalid start or end date/time.' });
    }

    const vehicleRef = db.collection('vehicles').doc(vehicleId);
    const vehicleDoc = await vehicleRef.get();
    if (!vehicleDoc.exists) {
      return res.status(404).json({ message: 'Vehicle not found.' });
    }
    const vehicleData = vehicleDoc.data();
    const ownerId = vehicleData.ownerId;
    
    if (ownerId === renterId) {
      log(`User ${renterId} blocked from booking their own vehicle ${vehicleId}`);
      return res.status(403).json({ message: 'You cannot book your own vehicle.' });
    }

    const rentalPricePerDay = parseFloat(vehicleData.rentalPricePerDay);
    if (isNaN(rentalPricePerDay) || rentalPricePerDay <= 0) {
      return res.status(500).json({ message: 'Vehicle rental price is invalid or not set. Cannot create booking.' });
    }
    
    const diffMilliseconds = end.getTime() - start.getTime();
    const diffHours = diffMilliseconds / (1000 * 60 * 60);
    const calculatedDays = Math.ceil(diffHours / 24);
    const billableDays = calculatedDays > 0 ? calculatedDays : 1;
    const backendTotalCost = parseFloat((rentalPricePerDay * billableDays).toFixed(2));

    const downPayment = parseFloat((backendTotalCost * 0.20).toFixed(2));
    const remainingBalance = parseFloat((backendTotalCost - downPayment).toFixed(2));

    const newBooking = {
      vehicleId,
      renterId,
      ownerId,
      startDate: admin.firestore.Timestamp.fromDate(start),
      endDate: admin.firestore.Timestamp.fromDate(end),
      totalCost: backendTotalCost,
      downPayment: downPayment,
      remainingBalance: remainingBalance,
      amountPaid: 0,
      paymentStatus: 'pending_owner_approval',
      isReminderSent: false,
      extensions: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('bookings').add(newBooking);

    await createNotification(
      ownerId,
      `You have a new booking request for your ${vehicleData.make || 'vehicle'}.`,
      `/dashboard/my-bookings/${docRef.id}`
    );

    log(`Booking request created with ID: ${docRef.id}`);
    res.status(201).json({ id: docRef.id, ...newBooking });

  } catch (error) {
    console.error('[BookingController] Error creating booking:', error);
    res.status(500).json({ message: 'Error creating booking request.', error: error.message });
  }
};

const apiCheckAvailability = async (req, res) => {
  log(`Checking availability with query: ${JSON.stringify(req.query)}`);
  try {
    const { vehicleId } = req.params;
    const { startDate, endDate } = req.query; 
    const requesterId = req.customUser.uid; // Get the user ID

    if (!startDate || !endDate) {
        log('Availability check failed: Missing startDate or endDate.');
        return res.status(400).json({ isAvailable: false, message: 'Start date and end date are required.' });
    }
    const requestedStart = convertToDate(startDate);
    const requestedEnd = convertToDate(endDate);

    log(`Parsed Dates - Start: ${requestedStart}, End: ${requestedEnd}`);

    if (!requestedStart || !requestedEnd || requestedStart >= requestedEnd) {
        log('Availability check failed: Invalid date/time range.');
        return res.status(400).json({ isAvailable: false, message: 'Invalid date/time range provided.' });
    }

    const vehicleDoc = await db.collection('vehicles').doc(vehicleId).get();
    if (!vehicleDoc.exists) {
      return res.status(404).json({ isAvailable: false, message: 'Vehicle not found.' });
    }
    const vehicleData = vehicleDoc.data();

    if (vehicleData.ownerId === requesterId) {
      log(`Owner ${requesterId} blocked from checking availability on their own vehicle ${vehicleId}`);
      return res.status(403).json({ isAvailable: false, message: 'You cannot book your own vehicle.' });
    }

    const unavailablePeriods = vehicleData.availability || [];
    for (const period of unavailablePeriods) {
      const periodStart = convertToDate(period.start);
      const periodEnd = convertToDate(period.end);
      if (periodStart && periodEnd && requestedStart < periodEnd && requestedEnd > periodStart) {
        log(`Availability check failed: Overlaps with owner block ${period.start}-${period.end}`);
        return res.status(200).json({ isAvailable: false, message: 'Vehicle is unavailable (owner block) during the requested times.' });
      }
    }

    const activeBookingStatuses = ['confirmed', 'pending_extension_payment', 'awaiting_return'];
    const bookingsRef = db.collection('bookings')
                         .where('vehicleId', '==', vehicleId)
                         .where('paymentStatus', 'in', activeBookingStatuses);

    const snapshot = await bookingsRef.get();
    let isOverlapping = false;
    snapshot.forEach((doc) => {
      const booking = doc.data();
      const bookingStart = convertToDate(booking.startDate);
      const bookingEnd = convertToDate(booking.endDate);
      if (bookingStart && bookingEnd && requestedStart < bookingEnd && requestedEnd > bookingStart) {
        isOverlapping = true;
        log(`Availability check failed: Overlaps with existing booking ${doc.id}`);
      }
    });

    if (isOverlapping) {
      return res.status(200).json({ isAvailable: false, message: 'Vehicle is already booked during some of the requested dates.' });
    }

    const rentalPricePerDay = parseFloat(vehicleData.rentalPricePerDay);
    if (isNaN(rentalPricePerDay) || rentalPricePerDay <= 0) {
      return res.status(500).json({ isAvailable: false, message: 'Vehicle rental price is invalid or not set.' });
    }

    const diffMilliseconds = requestedEnd.getTime() - requestedStart.getTime();
    const diffHours = diffMilliseconds / (1000 * 60 * 60);
    const calculatedDays = Math.ceil(diffHours / 24);
    const billableDays = calculatedDays > 0 ? calculatedDays : 1;
    const totalCost = parseFloat((rentalPricePerDay * billableDays).toFixed(2));

    log(`Availability check success. Cost: ${totalCost}`);
    res.status(200).json({
        isAvailable: true,
        message: 'Vehicle is available for the selected dates.',
        totalCost
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
        renterDetails: extractUserDetails(renterDoc),
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
    
    let ownerDoc = null;
    if (vehicleData && vehicleData.ownerId) {
        ownerDoc = await db.collection('users').doc(vehicleData.ownerId).get();
    }
    
    const requesterId = req.customUser.uid;
    const requesterRole = req.customUser.role;
    if (requesterRole !== 'admin' && requesterId !== bookingData.renterId && requesterId !== (vehicleData ? vehicleData.ownerId : null)) {
      return res.status(403).json({ message: 'Unauthorized access to booking details.' });
    }

    res.status(200).json({
      id: bookingDoc.id,
      ...bookingData,
      startDate: convertToDate(bookingData.startDate)?.toISOString() || null,
      endDate: convertToDate(bookingData.endDate)?.toISOString() || null,
      createdAt: convertToDate(bookingData.createdAt)?.toISOString() || null,
      vehicleDetails: vehicleData,
      renterDetails: extractUserDetails(renterDoc),
      ownerDetails: extractUserDetails(ownerDoc), 
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
      `/dashboard/my-bookings/${bookingId}`
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
      `/dashboard/my-bookings/${bookingId}`
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
        const { referenceNumber } = req.body;
        const renterId = req.customUser.uid;

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

        await bookingRef.update({
            paymentStatus: 'downpayment_pending_verification',
            paymentReferenceNumber: referenceNumber,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await createNotification(
          bookingData.ownerId,
          `Renter submitted payment (Ref: ${referenceNumber}) for booking #${bookingId.substring(0, 5)}. Please verify.`,
          `/dashboard/my-bookings/${bookingId}`
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
        `/dashboard/my-bookings/${bookingId}`
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
                rentersMap.set(doc.id, extractUserDetails(doc));
            }
        });

        const enrichedBookings = bookingsData.map(booking => {
            return {
                ...booking,
                startDate: convertToDate(booking.startDate)?.toISOString() || null,
                endDate: convertToDate(booking.endDate)?.toISOString() || null,
                renterDetails: rentersMap.get(booking.renterId) || { name: 'N/A' },
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
    const userId = req.customUser.uid;
    const userRole = req.customUser.role;

    if (!newStatus) {
        console.error(`[BookingController] updateBookingStatus failed for booking ${bookingId}: Missing newStatus.`);
        return res.status(400).json({ message: 'New status is required.' });
    }

    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      console.error(`[BookingController] updateBookingStatus failed: Booking ${bookingId} not found.`);
      return res.status(404).json({ message: 'Booking not found.' });
    }

    const bookingData = bookingDoc.data();

    if (userRole !== 'admin' && userId !== bookingData.ownerId) {
        console.warn(`[BookingController] updateBookingStatus unauthorized attempt by user ${userId} (role: ${userRole}) on booking ${bookingId} owned by ${bookingData.ownerId}.`);
        return res.status(403).json({ message: 'Forbidden: You are not authorized to update this booking status.' });
    }

    await bookingRef.update({
      paymentStatus: newStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (newStatus === 'returned' && bookingData.renterId) {
        try {
            await createNotification(
                bookingData.renterId,
                `The owner has marked your trip for booking #${bookingId.substring(0,5)} as returned.`,
                `/dashboard/my-bookings/${bookingId}`
            );
        } catch (notificationError) {
            console.error(`[BookingController] Failed to send 'returned' notification for booking ${bookingId}:`, notificationError);
        }
    }

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

    if (bookingData.renterId !== renterId) {
      return res.status(403).json({ message: 'Forbidden: You can only cancel your own bookings.' });
    }

    const cancellableStatuses = [
      'pending_owner_approval',
      'pending_payment'
    ];
    if (!cancellableStatuses.includes(bookingData.paymentStatus)) {
      return res.status(400).json({ message: `Booking cannot be cancelled in its current state (${bookingData.paymentStatus}). Payment may have already been submitted or confirmed.` });
    }

    await bookingRef.update({
      paymentStatus: 'cancelled_by_renter',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (bookingData.paymentStatus === 'confirmed') {
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

    await createNotification(
      bookingData.ownerId,
      `Booking #${bookingId.substring(0, 5)} has been cancelled by the renter.`,
      `/dashboard/my-bookings/${bookingId}`
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

        if (reporterId !== bookingData.renterId && reporterId !== bookingData.ownerId) {
             return res.status(403).json({ message: 'You are not authorized to report on this booking.' });
        }

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

        // Notify admin (Need an admin user ID or topic to send this)
        // await createNotification(ADMIN_USER_ID, `New report submitted for booking ${bookingId}`, `/admin/reports/${reportRef.id}`);

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

        if (bookingData.renterId !== renterId) {
            return res.status(403).json({ message: 'Forbidden: You cannot extend this booking.' });
        }
        if (bookingData.paymentStatus !== 'confirmed') {
             return res.status(400).json({ message: `Booking cannot be extended in its current state (${bookingData.paymentStatus}). Only 'Confirmed' bookings can be extended.` });
        }

        const currentEndDate = convertToDate(bookingData.endDate); 
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

        const extendedStartCheck = DateTime.fromJSDate(currentEndDate).plus({ minutes: 1 }).toJSDate();
        const extendedEndCheck = newEndDate;

        const unavailablePeriods = vehicleData.availability || [];
        for (const period of unavailablePeriods) {
            const periodStart = convertToDate(period.start);
            const periodEnd = convertToDate(period.end);
            if (periodStart && periodEnd && extendedStartCheck < periodEnd && extendedEndCheck > periodStart) {
                return res.status(409).json({ message: 'Vehicle is unavailable (owner block) during the requested extension period.' });
            }
        }
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

        const hourlyRate = rentalPricePerDay / 24;
        const extensionCost = parseFloat((hourlyRate * hours).toFixed(2));

        const newExtension = {
            requestedAt: new Date(),
            hours: hours,
            cost: extensionCost,
            newEndDate: admin.firestore.Timestamp.fromDate(newEndDate),
            status: 'pending_payment',
        };

         await bookingRef.update({
             extensions: admin.firestore.FieldValue.arrayUnion(newExtension),
             paymentStatus: 'pending_extension_payment',
             updatedAt: admin.firestore.FieldValue.serverTimestamp()
         });

        await createNotification(
            bookingData.ownerId,
            `Renter requested a ${hours}-hour extension for booking #${bookingId.substring(0,5)}. Cost: ₱${extensionCost.toFixed(2)}.`,
            `/dashboard/my-bookings/${bookingId}`
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

const confirmExtensionPayment = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { referenceNumber, amount } = req.body;
        const renterId = req.customUser.uid;

        if (!referenceNumber || !amount) {
            return res.status(400).json({ message: 'Reference number and amount are required.' });
        }

        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();
        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Booking not found.' });
        }
        const bookingData = bookingDoc.data();
        const currentExtensions = bookingData.extensions || [];

        if (bookingData.renterId !== renterId) {
            return res.status(403).json({ message: 'You are not authorized to confirm this payment.' });
        }
        if (bookingData.paymentStatus !== 'pending_extension_payment') {
            return res.status(400).json({ message: `Booking is not awaiting extension payment. Current status: ${bookingData.paymentStatus}` });
        }
        
        const pendingExtensionIndex = currentExtensions.map(e => e.status).lastIndexOf('pending_payment');
        if (pendingExtensionIndex === -1) {
            return res.status(400).json({ message: 'No valid, pending extension request found.' });
        }
        
        const pendingExtension = currentExtensions[pendingExtensionIndex];
        const expectedCost = parseFloat(pendingExtension.cost);
        const paidAmount = parseFloat(amount);
        
        if (paidAmount < expectedCost) {
             return res.status(400).json({ message: `Payment amount (₱${paidAmount.toFixed(2)}) is less than the required extension cost (₱${expectedCost.toFixed(2)}).` });
        }
        
        const costToApply = expectedCost; 

        currentExtensions[pendingExtensionIndex] = {
            ...pendingExtension,
            status: 'paid',
            paymentReferenceNumber: referenceNumber,
            paidAt: new Date()
        };

        await bookingRef.update({
          paymentStatus: 'confirmed',
          endDate: pendingExtension.newEndDate,
          totalCost: admin.firestore.FieldValue.increment(costToApply),
          amountPaid: admin.firestore.FieldValue.increment(costToApply),
          extensions: currentExtensions,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await createNotification(
            bookingData.ownerId,
            `Renter paid the ₱${costToApply.toFixed(2)} extension fee for booking #${bookingId.substring(0,5)}. The trip is now extended.`,
            `/dashboard/my-bookings/${bookingId}`
        );

        log(`Extension payment confirmed for booking ${bookingId} by renter ${renterId}.`);
        res.status(200).json({ message: 'Extension payment successful. Booking updated.' });

    } catch (error) {
        console.error(`Error confirming extension payment for ${req.params.bookingId}:`, error);
        res.status(500).json({ message: 'Server error confirming extension payment.', error: error.message });
    }
};

const deferExtensionPayment = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { amount, paymentMethod } = req.body;
        const renterId = req.customUser.uid;

        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();
        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Booking not found.' });
        }
        const bookingData = bookingDoc.data();
        const currentExtensions = bookingData.extensions || [];

        if (bookingData.renterId !== renterId) {
            return res.status(403).json({ message: 'You are not authorized to update this booking.' });
        }
        if (bookingData.paymentStatus !== 'pending_extension_payment') {
            return res.status(400).json({ message: `Booking is not awaiting extension payment. Current status: ${bookingData.paymentStatus}` });
        }
        
        const pendingExtensionIndex = currentExtensions.map(e => e.status).lastIndexOf('pending_payment');
        if (pendingExtensionIndex === -1) {
            return res.status(400).json({ message: 'No valid, pending extension request found.' });
        }
        
        const pendingExtension = currentExtensions[pendingExtensionIndex];
        const expectedCost = parseFloat(pendingExtension.cost);
        const paidAmount = parseFloat(amount);

        if (paidAmount < expectedCost) {
             return res.status(400).json({ message: `Amount mismatch. Expected ₱${expectedCost.toFixed(2)}.` });
        }
        
        const costToApply = expectedCost;

        currentExtensions[pendingExtensionIndex] = {
            ...pendingExtension,
            status: 'pay_on_return',
            paymentMethod: paymentMethod
        };

        await bookingRef.update({
          paymentStatus: 'confirmed',
          endDate: pendingExtension.newEndDate,
          totalCost: admin.firestore.FieldValue.increment(costToApply),
          remainingBalance: admin.firestore.FieldValue.increment(costToApply),
          extensions: currentExtensions,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await createNotification(
            bookingData.ownerId,
            `Renter extended booking #${bookingId.substring(0,5)}. They will pay the ₱${costToApply.toFixed(2)} fee in cash upon return.`,
            `/dashboard/my-bookings/${bookingId}`
        );

        log(`Extension payment deferred for booking ${bookingId} by renter ${renterId}.`);
        res.status(200).json({ message: 'Extension confirmed. Payment will be collected upon return.' });

    } catch (error) {
        console.error(`Error deferring extension payment for ${req.params.bookingId}:`, error);
        res.status(500).json({ message: 'Server error deferring extension payment.', error: error.message });
    }
};

// ================================================
//  FIXED PDF GENERATION FUNCTION
// ================================================
const generateBookingContract = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.customUser.uid;
    
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) {
        return res.status(404).json({ message: "Booking not found" });
    }
    const booking = bookingDoc.data();
    
    if (req.customUser.role !== 'admin' && userId !== booking.ownerId && userId !== booking.renterId) { 
        return res.status(403).json({ message: "Forbidden: You are not authorized to download this contract." });
    }
    
    const [ownerDoc, renterDoc, vehicleDoc] = await Promise.all([
        db.collection('users').doc(booking.ownerId).get(),
        db.collection('users').doc(booking.renterId).get(),
        db.collection('vehicles').doc(booking.vehicleId).get()
    ]);
    
    const owner = extractUserDetails(ownerDoc);
    const renter = extractUserDetails(renterDoc);
    const vehicle = vehicleDoc.exists ? vehicleDoc.data() : { make: 'N/A', model: 'N/A', year: 'N/A', plateNumber: 'N/A', vin: 'N/A' };
    
    // --- Date and Text Formatting (No Changes) ---
    const startDate = convertToDate(booking.startDate);
    const endDate = convertToDate(booking.endDate);
    const formattedStartDate = startDate ? DateTime.fromJSDate(startDate).toLocaleString(DateTime.DATE_FULL) : 'N/A';
    const formattedStartTime = startDate ? DateTime.fromJSDate(startDate).toLocaleString(DateTime.TIME_SIMPLE) : 'N/A';
    const formattedEndDate = endDate ? DateTime.fromJSDate(endDate).toLocaleString(DateTime.DATE_FULL) : 'N/A';
    const formattedEndTime = endDate ? DateTime.fromJSDate(endDate).toLocaleString(DateTime.TIME_SIMPLE) : 'N/A';
    const formattedSignatureDate = DateTime.now().toLocaleString(DateTime.DATE_FULL);
    
    const totalCost = booking.totalCost || 0;
    const amountPaid = booking.amountPaid || 0;
    const remainingBalance = booking.remainingBalance || 0;
    const downPayment = booking.downPayment || 0;

    let extensionsText = '--- EXTENSIONS ---\n\n';
    if (booking.extensions && booking.extensions.length > 0) {
        booking.extensions.forEach((ext, index) => {
            extensionsText += `Extension ${index + 1}:\n`;
            extensionsText += `   Hours: ${ext.hours}\n`;
            extensionsText += `   Cost: ₱${ext.cost.toFixed(2)}\n`;
            const extEndDate = ext.newEndDate?.toDate ? ext.newEndDate.toDate() : (ext.newEndDate?._seconds ? new Date(ext.newEndDate._seconds * 1000) : null);
            extensionsText += `   New Return Date: ${extEndDate?.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' }) || 'N/A'}\n`;
            extensionsText += `   Payment Status: ${ext.status}\n`;
            if(ext.paymentReferenceNumber) extensionsText += `   Reference: ${ext.paymentReferenceNumber}\n`;
            if(ext.paymentMethod) extensionsText += `   Payment Method: ${ext.paymentMethod}\n`;
            extensionsText += '\n';
        });
    } else {
        extensionsText = 'No extensions applied to this booking.\n';
    }
    // --- End Formatting ---

    // --- PDF Generation Logic ---
    // *** CHANGED: Reduced margin from 50 to 40 ***
    const doc = new PDFDocument({ margin: 40 });
    const filename = `BookingContract-${bookingId}.pdf`;

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Pipe the PDF content to the response
    doc.pipe(res);

    try {
      const imagePath = path.join(__dirname, '../assets/rentcycle_logo.png');
      
      console.log('[Contract Logo] Trying to load logo from:', imagePath);

      const logoWidth = 150; 
      const logoX = (doc.page.width - logoWidth) / 2;
      
      doc.image(imagePath, logoX, 35, { // 35px from the top
          width: logoWidth,
      });

      doc.moveDown(2); 

    } catch (imageError) {
      // *** ADDED: Better error logging ***
      console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      console.error("[Contract Logo] FAILED TO LOAD LOGO IMAGE:", imageError.message);
      console.error("Check if the file exists at the path above.");
      console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      // If logo fails, just add extra space and continue
      doc.moveDown(3);
    }
    // --- === END OF LOGO CODE === ---

    // --- Add Content to the PDF ---
    doc.fontSize(18).font('Helvetica-Bold').text('CAR RENTAL AGREEMENT', { align: 'center' });
    // *** CHANGED: Reduced space from 2 to 1.5 ***
    doc.moveDown(1.5);

    doc.fontSize(10).font('Helvetica-Bold').text('Lessor (Owner): ', { continued: true }).font('Helvetica').text(owner.name);
    doc.font('Helvetica-Bold').text('Lessee (Renter): ', { continued: true }).font('Helvetica').text(renter.name);
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Vehicle Details:', { underline: true });
    doc.font('Helvetica').text(`Make/Model: ${vehicle.make} ${vehicle.model}`);
    doc.text(`Plate Number: ${vehicle.cor?.plateNumber || vehicle.plateNumber || 'N/A'}`);
    // *** CHANGED: Reduced space from 2 to 1.5 ***
    doc.moveDown(1.5);

    doc.fontSize(12).font('Helvetica-Bold').text('TERMS', { underline: true });
    doc.moveDown();

    // Use .list() for numbered items
    // *** CHANGED: Font size from 10 to 9 ***
    doc.fontSize(9).font('Helvetica').list([
      'The Renter agrees to return the vehicle by the specified Final Return date and time.',
      'The vehicle is to be returned in the same condition it was received, ordinary wear and tear excepted.',
      'The Renter is responsible for any fines, tolls, or damages incurred during the rental period.',
      `The remaining balance of ₱${remainingBalance.toFixed(2)} is due upon vehicle pickup/return as agreed.`,
      `Rental Period: The rental period shall start on ${formattedStartDate} at ${formattedStartTime} and end on ${formattedEndDate} at ${formattedEndTime}`,
      'Fuel Policy: The vehicle must be returned with the same number of fuel bars as when it was rented. If the fuel level is lower, the renter will be charged accordingly.',
      "Driver's Responsibility: Only the renter or authorized drivers with valid driver's licenses may operate the vehicle.",
      'Prohibited Uses: The vehicle shall not be used for racing, towing, off-road driving, or any illegal activity.',
      'Late Return Policy: If the vehicle is returned later than the agreed time, applicable hourly or half-day rates will automatically apply. (Subject to 3-hour grace period for emergencies, unless otherwise updated by owner).',
      'Traffic Violations: Any traffic violations or penalties incurred during the rental period shall be the responsibility of the renter.',
      'Emergency or Breakdown: In case of vehicle malfunction, the renter must immediately contact the owner. Unauthorized repairs are not allowed unless approved by the owner.',
      "Identification Requirement: The renter must present a valid government-issued ID and driver's license before the vehicle is released.",
      'Damages: The renter is responsible for any damages to the unit during the rental period. Repair costs will be shouldered by the renter.',
      `Payment: All payments shall be made in full before or upon release of the vehicle.\nTotal Cost: ₱${totalCost.toFixed(2)}\nAmount Paid: ₱${amountPaid.toFixed(2)}\nRemaining Balance: ₱${remainingBalance.toFixed(2)}\nDownpayment Reference: ${booking.paymentReferenceNumber || 'N/A'}\n\n${extensionsText}`,
      'Agreement Validity: By signing below, the renter agrees to all the terms and conditions stated in this contract.'
    ], {
      bulletRadius: 0.1, // Use numbers instead of bullets
      textIndent: 10,
    });

    // *** CHANGED: Reduced space from 3 to 2 ***
    doc.moveDown(2);

    doc.fontSize(12).font('Helvetica-Bold').text('ACKNOWLEDGMENT AND SIGNATURES', { underline: true });
    doc.moveDown();

    // *** CHANGED: Set font size back to 10 for signatures ***
    doc.fontSize(10).font('Helvetica');
    doc.text(`Renter's Name: ${renter.name}`);
    doc.text(`Contact Number: ${renter.phoneNumber}`);
    doc.text('Signature of Renter: ____________________________');
    doc.text(`Date: ${formattedSignatureDate}`); // Pre-fill the date
    // *** CHANGED: Reduced space from 2 to 1.5 ***
    doc.moveDown(1.5);

    doc.text(`Owner's Name: ${owner.name}`);
    doc.text('Signature of Owner: ____________________________');
    doc.text(`Date: ${formattedSignatureDate}`); // Pre-fill the date

    // --- Finalize the PDF ---
    doc.end(); // This sends the response
    
  } catch (error) {
    console.error(`Error generating contract for ${req.params.bookingId}:`, error);
    if (!res.headersSent) {
        res.status(500).json({ message: "Server error generating contract." });
    } else {
        res.end();
    }
  }
};

const autoHandleOverdueBookings = async () => {
  log('Running cron job: autoHandleOverdueBookings...');
  const now = new Date(); // The current time

  try {
    const bookingsRef = db.collection('bookings');
    const snapshot = await bookingsRef
      .where('paymentStatus', '==', 'confirmed')
      .where('endDate', '<', admin.firestore.Timestamp.fromDate(now)) // Find all active trips that *should* have ended
      .get();

    if (snapshot.empty) {
      log('Cron Job: No active bookings found past their end date.');
      return;
    }

    const updatesBatch = db.batch();
    let notifications = [];

    snapshot.forEach(doc => {
      const booking = doc.data();
      const endDate = convertToDate(booking.endDate);
      if (!endDate) return; // Skip if date is invalid

      const gracePeriodEnd = DateTime.fromJSDate(endDate).plus({ hours: 3 }).toJSDate();

      if (now > gracePeriodEnd) {
        log(`Cron Job: Booking ${doc.id} is past 3-hour grace period. Updating status.`);
        
        const bookingRef = db.collection('bookings').doc(doc.id);
        updatesBatch.update(bookingRef, {
          paymentStatus: 'awaiting_return', // This is the new "late" status
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        notifications.push(createNotification(
          booking.ownerId,
          `Your vehicle for booking #${doc.id.substring(0,5)} is now 3 hours overdue for return.`,
          `/dashboard/my-bookings/${doc.id}`
        ));
         notifications.push(createNotification(
          booking.renterId,
          `Your booking (#${doc.id.substring(0,5)}) is now 3 hours overdue. Please return the vehicle. Late fees may apply.`,
          `/dashboard/my-bookings/${doc.id}`
        ));
      }
    });

    await updatesBatch.commit();
    if (notifications.length > 0) {
       await Promise.all(notifications);
       log(`Cron Job: Sent ${notifications.length} late return notifications.`);
    }

  } catch (error) {
     if (error.code === 9) { // FAILED_PRECONDITION
        console.error('Cron Job Error: Firestore composite index is missing for autoHandleOverdueBookings. Please create it.');
        console.error('The index required is on collection `bookings`: `paymentStatus` (ASC), `endDate` (ASC)');
     } else {
        console.error('[Cron Job: autoHandleOverdueBookings] Error:', error);
     }
  }
};

// 1. GET ALL FEES (For Admin)
const getAllPlatformFees = async (req, res) => {
  try {
    const feesSnapshot = await db.collection('platform_fees')
      .orderBy('submittedAt', 'desc')
      .get();

    const fees = feesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      submittedAt: convertToDate(doc.data().submittedAt)?.toISOString()
    }));

    res.status(200).json(fees);
  } catch (error) {
    console.error('[BookingController] Error fetching all fees:', error);
    res.status(500).json({ message: 'Error fetching fees.' });
  }
};

// 2. GET OWNER FEES (For Owner Dashboard)
const getOwnerPlatformFees = async (req, res) => {
  try {
    const ownerId = req.customUser.uid;
    // Note: If you get an index error, remove the .orderBy until you create the index
    const feesSnapshot = await db.collection('platform_fees')
      .where('ownerId', '==', ownerId)
      .get();

    const fees = feesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.status(200).json(fees);
  } catch (error) {
    console.error('[BookingController] Error fetching owner fees:', error);
    res.status(500).json({ message: 'Error fetching your fees.' });
  }
};

// 3. SUBMIT FEE (Owner Action)
const submitPlatformFeePayment = async (req, res) => {
  try {
    const { month, year, amount, referenceNumber } = req.body;
    const ownerId = req.customUser.uid;
    const userDoc = await db.collection('users').doc(ownerId).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    if (!month || !year || !amount || !referenceNumber) {
       return res.status(400).json({ message: 'Missing required fields.' });
    }

    const feeRecord = {
      ownerId,
      hostName: `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Unknown',
      hostEmail: userData.email || 'N/A',
      month,
      year: parseInt(year),
      amount: parseFloat(amount),
      referenceNumber,
      status: 'pending', // Default status
      submittedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await db.collection('platform_fees').add(feeRecord);

    log(`Platform fee submitted by ${ownerId} for ${month} ${year}.`);
    res.status(201).json({ message: 'Payment submitted successfully.', id: docRef.id });
  } catch (error) {
    console.error('[BookingController] Error submitting fee:', error);
    res.status(500).json({ message: 'Server error submitting payment.' });
  }
};

// 4. VERIFY FEE (Admin Action)
const verifyPlatformFee = async (req, res) => {
  try {
    const { feeId } = req.params;
    
    await db.collection('platform_fees').doc(feeId).update({
      status: 'verified',
      verifiedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    log(`Fee ${feeId} verified by admin.`);
    res.status(200).json({ message: 'Fee verified successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Error verifying fee.', error: error.message });
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
  confirmExtensionPayment,
  deferExtensionPayment,
  generateBookingContract,
  autoHandleOverdueBookings,
  getAllPlatformFees,
  getOwnerPlatformFees,
  submitPlatformFeePayment,
  verifyPlatformFee
};
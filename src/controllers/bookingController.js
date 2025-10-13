const { admin, db } = require('../utils/firebase');
const { createNotification } = require('../utils/notificationHelper'); // 👈 Import the helper

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
    const parsedTotalCost = parseFloat(totalCost);

    const downPayment = parseFloat((parsedTotalCost * 0.20).toFixed(2));
    const remainingBalance = parseFloat((parsedTotalCost - downPayment).toFixed(2));

    const newBooking = {
      vehicleId,
      renterId,
      ownerId, 
      startDate: admin.firestore.Timestamp.fromDate(start),
      endDate: admin.firestore.Timestamp.fromDate(end),
      totalCost: parsedTotalCost,
      downPayment: downPayment,
      remainingBalance: remainingBalance,
      amountPaid: 0,
      paymentStatus: 'pending_owner_approval', 
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('bookings').add(newBooking);
    
    await createNotification(
      ownerId,
      `You have a new booking request for your vehicle.`,
      `/booking/${docRef.id}`
    );

    log(`Booking request created with ID: ${docRef.id}`);
    res.status(201).json({ id: docRef.id, ...newBooking });

  } catch (error) {
    console.error('[BookingController] Error creating booking:', error);
    res.status(500).json({ message: 'Error creating booking request.' });
  }
};

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
        return res.status(200).json({ isAvailable: false, message: 'Vehicle is unavailable for the requested dates.' });
      }
    }

    const bookingsRef = db.collection('bookings').where('vehicleId', '==', vehicleId).where('paymentStatus', '==', 'confirmed');

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
      return res.status(200).json({ isAvailable: false, message: 'Vehicle is already booked for some of the requested dates.' });
    }

    const rentalPricePerDay = parseFloat(vehicleData.rentalPricePerDay);
    if (isNaN(rentalPricePerDay)) {
      return res.status(500).json({ message: 'Vehicle rental price is invalid.' });
    }

    const diffTime = Math.abs(requestedEnd.getTime() - requestedStart.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const totalCost = parseFloat((rentalPricePerDay * diffDays).toFixed(2));

    res.status(200).json({ isAvailable: true, message: 'Vehicle is available for the selected dates.', totalCost });
  } catch (error) {
    console.error('[BookingController] Error checking vehicle availability:', error);
    res.status(500).json({ message: 'Server error checking availability.', error: error.message });
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
        const renterId = req.customUser.uid;

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
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        await createNotification(
          bookingData.ownerId,
          `A renter has submitted payment for booking #${bookingId.substring(0, 5)}. Please verify.`,
          `/booking/${bookingId}`
        );
        
        log(`Downpayment for booking ${bookingId} confirmed by user. Awaiting owner verification.`);
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

    const bookingRef = db.collection('bookings').doc(bookingId);
    if (!(await bookingRef.get()).exists) {
      return res.status(404).json({ message: 'Booking not found.' });
    }

    await bookingRef.update({
      paymentStatus: newStatus,
      lastStatusUpdate: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({ message: `Booking status updated to ${newStatus}.` });
  } catch (error) {
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
};
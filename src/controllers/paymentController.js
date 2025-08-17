// backend/src/controllers/paymentController.js
const { admin, db } = require('../utils/firebase'); // Import from firebase-util

// Helper function for consistent logging
const log = (message) => {
    console.log(`[PaymentController] ${message}`);
};

// Helper function to safely convert Firestore Timestamp or ISO string to Date object
const convertToDate = (value) => {
    if (value instanceof admin.firestore.Timestamp) {
        return value.toDate();
    }
    if (typeof value === 'string') {
        const date = new Date(value);
        // Basic check to ensure it's a valid date after parsing
        return isNaN(date.getTime()) ? null : date;
    }
    return null; // Or throw an error, depending on desired strictness
};

/**
 * Initiates a manual payment process (Cash on Pickup or QR Code Scan) for the full amount.
 * This endpoint does NOT process actual payments but sets the booking status
 * to pending for manual verification.
 */
const initiateManualPayment = async (req, res) => {
    try {
        // Renamed 'amount' to 'totalCost' for clarity since it's now the full amount
        const { totalCost, currency = 'PHP', bookingDetails, paymentMethodType } = req.body;
        const userId = req.customUser.uid; // Accessing UID from customUser set by authMiddleware

        log(`Initiating manual payment for total cost: ${totalCost} ${currency} with type: ${paymentMethodType}`);

        if (!totalCost || totalCost <= 0) {
            return res.status(400).json({ message: 'Invalid amount provided for payment.' });
        }
        if (!['cash', 'qr_manual'].includes(paymentMethodType)) {
            return res.status(400).json({ message: 'Invalid payment method type. Must be "cash" or "qr_manual".' });
        }
        if (!bookingDetails || !bookingDetails.vehicleId || !bookingDetails.startDate || !bookingDetails.endDate) {
            return res.status(400).json({ message: 'Missing booking details.' });
        }

        // --- Downpayment Logic Removed ---
        // The code now assumes the full payment is processed at once.

        const bookingRef = db.collection('bookings').doc(); // Create a new doc reference for ID
        const bookingId = bookingRef.id; // Get the auto-generated ID

        let paymentStatus;
        let message;
        let paymentDetails = {
            method: paymentMethodType,
            totalCost: totalCost,
            currency: currency,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userId: userId,
            vehicleId: bookingDetails.vehicleId,
            startDate: bookingDetails.startDate,
            endDate: bookingDetails.endDate,
            bookingId: bookingId, // Store the generated booking ID
        };

        if (paymentMethodType === 'cash') {
            // Updated status to reflect a single, pending cash payment
            paymentStatus = 'pending_cash_payment';
            message = `Booking created. Please pay ₱${totalCost} in cash upon vehicle pickup.`;
            log('Booking set to pending_cash_payment.');
        } else if (paymentMethodType === 'qr_manual') {
            // Updated status to reflect a single, pending QR payment
            paymentStatus = 'awaiting_qr_payment';
            message = `Booking created. Please complete ₱${totalCost} payment via QR scan.`;
            log('Booking set to awaiting_qr_payment.');

            paymentDetails.qrCodeInfo = {
                qrImageUrl: 'https://placehold.co/300x300/228B22/FFFFFF?text=GCash+QR', // Placeholder QR
                instructions: `Scan this QR code with your GCash/Maya app. Enter exact amount (₱${totalCost}) and include booking ID as reference: ${bookingId}`,
                qrRefId: bookingId, // This is the reference user should put in notes
                amountToPay: parseFloat(totalCost), // Amount for QR scan is now the full cost
            };
        }

        // Store the initial booking details with the pending payment status
        await db.collection('bookings').doc(bookingId).set({ // Use doc(bookingId).set() to use the generated ID
            ...bookingDetails,
            renterId: userId,
            totalCost: totalCost,
            paymentStatus: paymentStatus,
            paymentDetails: paymentDetails, // Contains QR info if applicable
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.status(200).json({
            bookingId: bookingId,
            status: paymentStatus,
            message: message,
            paymentDetails: paymentDetails, // Include QR info and payment details
        });

    } catch (error) {
        console.error('Error in initiateManualPayment:', error);
        res.status(500).json({ message: 'Server error initiating manual payment.', error: error.message });
    }
};

/**
 * Endpoint for user to "confirm" a manual QR payment.
 */
const confirmManualQrPayment = async (req, res) => {
    try {
        const { bookingId } = req.body;
        const userId = req.customUser.uid;

        if (!bookingId) {
            return res.status(400).json({ message: 'Booking ID is required.' });
        }

        const bookingDocRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingDocRef.get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        const bookingData = bookingDoc.data();

        if (bookingData.renterId !== userId) {
            return res.status(403).json({ message: 'Unauthorized to confirm this booking.' });
        }

        // Updated status check to the new status
        if (bookingData.paymentStatus !== 'awaiting_qr_payment') {
            return res.status(400).json({ message: `Cannot confirm payment for booking with status: ${bookingData.paymentStatus}` });
        }

        // Updated status to reflect full payment confirmation by user
        await bookingDocRef.update({
            paymentStatus: 'qr_payment_confirmed_by_user',
            paymentConfirmationTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        log(`Booking ${bookingId} status updated to qr_payment_confirmed_by_user by user ${userId}.`);
        res.status(200).json({
            message: 'Your payment confirmation has been received. We will verify it shortly.',
            status: 'qr_payment_confirmed_by_user',
        });

    } catch (error) {
        console.error('Error in confirmManualQrPayment:', error);
        res.status(500).json({ message: 'Server error confirming manual QR payment.', error: error.message });
    }
};

/**
 * Admin-only endpoint to manually update booking payment status.
 */
const updateBookingPaymentStatus = async (req, res) => {
    try {
        const { bookingId, newStatus } = req.body;

        log(`Admin attempting to update booking ${bookingId} to status: ${newStatus}`);

        // Simplified list of valid statuses
        if (!bookingId || !newStatus || !['full_payment_received', 'cancelled_by_user', 'refunded'].includes(newStatus)) {
            return res.status(400).json({ message: 'Invalid booking ID or new status.' });
        }

        const bookingDocRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingDocRef.get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        const updateData = {
            paymentStatus: newStatus,
            lastStatusUpdate: admin.firestore.FieldValue.serverTimestamp(),
        };

        // No more downpayment-specific updates
        if (newStatus === 'full_payment_received') {
            updateData.fullPaymentReceivedAt = admin.firestore.FieldValue.serverTimestamp();
        }

        await bookingDocRef.update(updateData);

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
 * Endpoint for a user to cancel their booking.
 */
const cancelBooking = async (req, res) => {
    try {
        const { bookingId } = req.body;
        const userId = req.customUser.uid;

        if (!bookingId) {
            return res.status(400).json({ message: 'Booking ID is required.' });
        }

        const bookingDocRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingDocRef.get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        const bookingData = bookingDoc.data();

        if (bookingData.renterId !== userId) {
            return res.status(403).json({ message: 'Unauthorized to cancel this booking.' });
        }

        // Simplified status check and new status for cancellation
        if (['full_payment_received', 'cancelled_by_user', 'refunded'].includes(bookingData.paymentStatus)) {
             return res.status(400).json({ message: `Booking cannot be cancelled from its current status: ${bookingData.paymentStatus}` });
        }

        const newStatus = 'cancelled_by_user';
        const refundEligibility = bookingData.paymentStatus === 'qr_payment_confirmed_by_user'; // Refund only if payment was confirmed

        await bookingDocRef.update({
            paymentStatus: newStatus,
            cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.status(200).json({
            message: `Booking ${bookingId} has been cancelled. ${refundEligibility ? 'You may be eligible for a refund. Contact support.' : 'No payment was made, so no refund is applicable.'}`,
            status: newStatus,
            refundEligible: refundEligibility,
        });

    } catch (error) {
        console.error('Error in cancelBooking:', error);
        res.status(500).json({ message: 'Server error cancelling booking.', error: error.message });
    }
};


const getPaymentStatus = async (req, res) => {
    try {
        const { bookingId } = req.params;

        if (!bookingId) {
            return res.status(400).json({ message: 'Booking ID is required.' });
        }

        log(`Retrieving booking status for ID: ${bookingId}`);

        const bookingDoc = await db.collection('bookings').doc(bookingId).get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Booking not found.' });
        }

        const bookingData = bookingDoc.data();

        // Fetch vehicle details using bookingData.vehicleId
        let vehicleDetails = null;
        if (bookingData.vehicleId) {
            const vehicleDoc = await db.collection('vehicles').doc(bookingData.vehicleId).get();
            if (vehicleDoc.exists) {
                const data = vehicleDoc.data();
                vehicleDetails = {
                    id: vehicleDoc.id,
                    make: data.make,
                    model: data.model,
                    year: data.year,
                    rentalPricePerDay: data.rentalPricePerDay,
                    imageUrl: data.imageUrl,
                    location: data.location,
                    // Add any other vehicle fields relevant for display
                };
            } else {
                log(`Vehicle with ID ${bookingData.vehicleId} not found for booking ${bookingId}.`);
            }
        }

        // Apply convertToDate helper to all date fields before sending to frontend
        const startDate = convertToDate(bookingData.startDate);
        const endDate = convertToDate(bookingData.endDate);

        // Removed downpayment-specific fields from the response
        res.status(200).json({
            status: bookingData.paymentStatus,
            totalCost: bookingData.totalCost,
            currency: bookingData.paymentDetails?.currency || 'PHP',
            message: `Booking status is ${bookingData.paymentStatus}`,
            qrCodeInfo: bookingData.paymentDetails?.qrCodeInfo || null,
            vehicleId: bookingData.vehicleId,
            vehicleDetails: vehicleDetails,
            startDate: startDate ? startDate.toISOString() : null,
            endDate: endDate ? endDate.toISOString() : null,
        });

    } catch (error) {
        console.error('Error in getPaymentStatus:', error);
        res.status(500).json({ message: 'Server error retrieving booking status.', error: error.message });
    }
};


module.exports = {
    initiateManualPayment,
    confirmManualQrPayment,
    updateBookingPaymentStatus,
    cancelBooking,
    getPaymentStatus,
};

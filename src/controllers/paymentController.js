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
 * Initiates a manual payment process (Cash on Pickup or QR Code Scan) with downpayment logic.
 * This endpoint does NOT process actual payments but sets the booking status
 * to pending for manual verification.
 */
const initiateManualPayment = async (req, res) => {
    try {
        const { amount, currency = 'PHP', bookingDetails, paymentMethodType } = req.body;
        const userId = req.customUser.uid; // Accessing UID from customUser set by authMiddleware

        log(`Initiating manual payment with downpayment for amount: ${amount} ${currency} with type: ${paymentMethodType}`);

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Invalid amount provided for payment.' });
        }
        if (!['cash', 'qr_manual'].includes(paymentMethodType)) {
            return res.status(400).json({ message: 'Invalid payment method type. Must be "cash" or "qr_manual".' });
        }
        if (!bookingDetails || !bookingDetails.vehicleId || !bookingDetails.startDate || !bookingDetails.endDate) {
            return res.status(400).json({ message: 'Missing booking details.' });
        }

        // --- Downpayment Logic ---
        const DOWNPAYMENT_PERCENTAGE = 0.30; // 30% downpayment
        // The 2-day refund grace period starts *after* downpayment is received (see updateBookingPaymentStatus)

        const totalCost = parseFloat(amount);
        const downpaymentAmount = (totalCost * DOWNPAYMENT_PERCENTAGE).toFixed(2);
        const fullPaymentAmount = (totalCost - downpaymentAmount).toFixed(2);

        // This due date is for the downpayment itself
        const downpaymentDueDate = admin.firestore.Timestamp.fromMillis(
            Date.now() + 2 * 24 * 60 * 60 * 1000 // 2 days to pay downpayment from booking initiation
        );
        // --- End Downpayment Logic ---

        const bookingRef = db.collection('bookings').doc(); // Create a new doc reference for ID
        const bookingId = bookingRef.id; // Get the auto-generated ID

        let paymentStatus;
        let message;
        let paymentDetails = {
            method: paymentMethodType,
            totalCost: totalCost,
            downpaymentAmount: parseFloat(downpaymentAmount),
            fullPaymentAmount: parseFloat(fullPaymentAmount),
            downpaymentDueDate: downpaymentDueDate,
            currency: currency,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userId: userId,
            vehicleId: bookingDetails.vehicleId,
            startDate: bookingDetails.startDate,
            endDate: bookingDetails.endDate,
            bookingId: bookingId, // Store the generated booking ID
        };

        if (paymentMethodType === 'cash') {
            paymentStatus = 'pending_cash_downpayment'; // New status for cash downpayment
            message = `Booking created. Please pay ₱${downpaymentAmount} downpayment in cash upon vehicle pickup by ${new Date(downpaymentDueDate.toDate()).toLocaleDateString()}. Remaining ₱${fullPaymentAmount} due on final pickup.`;
            log('Booking set to pending_cash_downpayment.');
        } else if (paymentMethodType === 'qr_manual') {
            paymentStatus = 'awaiting_qr_downpayment'; // New status for QR downpayment
            message = `Booking created. Please complete ₱${downpaymentAmount} downpayment via QR scan by ${new Date(downpaymentDueDate.toDate()).toLocaleDateString()}. Remaining ₱${fullPaymentAmount} due on final pickup.`;
            log('Booking set to awaiting_qr_downpayment.');
            
            paymentDetails.qrCodeInfo = {
                qrImageUrl: 'https://placehold.co/300x300/228B22/FFFFFF?text=GCash+QR', // Placeholder QR
                instructions: `Scan this QR code with your GCash/Maya app. Enter exact amount (₱${downpaymentAmount}) and include booking ID as reference: ${bookingId}`,
                qrRefId: bookingId, // This is the reference user should put in notes
                amountToPay: parseFloat(downpaymentAmount), // Amount for QR scan
            };
        }

        // Store the initial booking details with the pending payment status
        await db.collection('bookings').doc(bookingId).set({ // Use doc(bookingId).set() to use the generated ID
            ...bookingDetails,
            renterId: userId,
            totalCost: totalCost,
            downpaymentAmount: parseFloat(downpaymentAmount),
            fullPaymentAmount: parseFloat(fullPaymentAmount),
            downpaymentDueDate: downpaymentDueDate,
            paymentStatus: paymentStatus,
            paymentDetails: paymentDetails, // Contains QR info if applicable
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.status(200).json({
            bookingId: bookingId,
            status: paymentStatus,
            message: message,
            paymentDetails: paymentDetails, // Include QR info and downpayment details
        });

    } catch (error) {
        console.error('Error in initiateManualPayment:', error);
        res.status(500).json({ message: 'Server error initiating manual payment.', error: error.message });
    }
};

/**
 * Endpoint for user to "confirm" a manual QR downpayment.
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

        if (bookingData.paymentStatus !== 'awaiting_qr_downpayment') {
            return res.status(400).json({ message: `Cannot confirm payment for booking with status: ${bookingData.paymentStatus}` });
        }

        await bookingDocRef.update({
            paymentStatus: 'qr_downpayment_confirmed_by_user',
            paymentConfirmationTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        log(`Booking ${bookingId} status updated to qr_downpayment_confirmed_by_user by user ${userId}.`);
        res.status(200).json({
            message: 'Your downpayment confirmation has been received. We will verify it shortly.',
            status: 'qr_downpayment_confirmed_by_user',
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

        if (!bookingId || !newStatus || !['downpayment_received', 'full_payment_received', 'cancelled_no_downpayment', 'cancelled_by_user_after_grace_period', 'refunded', 'cancelled_within_grace_period'].includes(newStatus)) {
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

        if (['full_payment_received', 'cancelled_no_downpayment', 'cancelled_by_user_after_grace_period', 'cancelled_within_grace_period', 'refunded'].includes(bookingData.paymentStatus)) {
            return res.status(400).json({ message: `Booking cannot be cancelled from its current status: ${bookingData.paymentStatus}` });
        }

        let newStatus;
        let refundEligibility = false;
        const now = admin.firestore.Timestamp.now();

        if (bookingData.paymentStatus === 'awaiting_qr_downpayment' || bookingData.paymentStatus === 'pending_cash_downpayment' || bookingData.paymentStatus === 'qr_downpayment_confirmed_by_user') {
            newStatus = 'cancelled_no_downpayment';
            refundEligibility = false;
            log(`Booking ${bookingId} cancelled before downpayment received. Status: ${newStatus}`);
        } else if (bookingData.paymentStatus === 'downpayment_received') {
            if (bookingData.cancellationGracePeriodEnd && now.toMillis() <= bookingData.cancellationGracePeriodEnd.toMillis()) {
                newStatus = 'cancelled_within_grace_period';
                refundEligibility = true;
                log(`Booking ${bookingId} cancelled within grace period. Status: ${newStatus}, Eligible for refund.`);
            } else {
                newStatus = 'cancelled_by_user_after_grace_period';
                refundEligibility = false;
                log(`Booking ${bookingId} cancelled after grace period. Status: ${newStatus}, Downpayment forfeited.`);
            }
        } else {
            return res.status(400).json({ message: `Cannot cancel booking with current status: ${bookingData.paymentStatus}` });
        }

        await bookingDocRef.update({
            paymentStatus: newStatus,
            cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.status(200).json({
            message: `Booking ${bookingId} has been cancelled. ${refundEligibility ? 'You are eligible for a downpayment refund.' : 'The downpayment is non-refundable as per policy.'}`,
            status: newStatus,
            refundEligible: refundEligibility,
            downpaymentAmount: bookingData.downpaymentAmount,
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
        const downpaymentDueDate = convertToDate(bookingData.downpaymentDueDate);
        const cancellationGracePeriodEnd = convertToDate(bookingData.cancellationGracePeriodEnd);

        res.status(200).json({
            status: bookingData.paymentStatus,
            totalCost: bookingData.totalCost,
            downpaymentAmount: bookingData.downpaymentAmount,
            fullPaymentAmount: bookingData.fullPaymentAmount,
            downpaymentDueDate: downpaymentDueDate ? downpaymentDueDate.toISOString() : null,
            cancellationGracePeriodEnd: cancellationGracePeriodEnd ? cancellationGracePeriodEnd.toISOString() : null,
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

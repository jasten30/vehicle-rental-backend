// backend/src/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const authMiddleware = require('../middleware/authMiddleware');

console.log('[PaymentRoutes] Loading Payment routes for manual methods...');

// Route to initiate a manual payment (cash or QR code)
// This will create a booking with a pending downpayment status
router.post('/initiate-manual-payment', authMiddleware.verifyToken, authMiddleware.authorizeRole(['renter']), paymentController.initiateManualPayment);

// Route for user to confirm they have made a manual QR downpayment
router.post('/confirm-manual-qr-payment', authMiddleware.verifyToken, authMiddleware.authorizeRole(['renter']), paymentController.confirmManualQrPayment);

// Route for user to cancel a booking
router.post('/cancel-booking', authMiddleware.verifyToken, authMiddleware.authorizeRole(['renter']), paymentController.cancelBooking);

// Route to get payment status (now retrieves booking status)
router.get('/status/:bookingId', authMiddleware.verifyToken, authMiddleware.authorizeRole(['renter']), paymentController.getPaymentStatus);

// Admin-only route to update payment status (e.g., mark as 'downpayment_received', 'full_payment_received', 'cancelled_no_downpayment', 'refunded' etc.)
// In a real app, this would have a stricter admin authorization middleware
router.put('/update-status', authMiddleware.verifyToken, authMiddleware.authorizeRole(['admin']), paymentController.updateBookingPaymentStatus);

console.log('[PaymentRoutes] Manual Payment routes loaded.');

module.exports = router;

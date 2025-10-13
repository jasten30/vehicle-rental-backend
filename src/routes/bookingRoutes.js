// backend/src/routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middleware/authMiddleware');

// --- Specific routes must come before generic routes with parameters ---

router.get(
  '/all',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['admin']),
  bookingController.getAllBookings
);

router.get(
  '/owner',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['owner', 'admin']),
  bookingController.getOwnerBookings
);

router.get(
  '/user/:userId',
  authMiddleware.verifyToken,
  bookingController.getBookingsByUser
);

router.get(
  '/vehicle/:vehicleId',
  authMiddleware.verifyToken,
  bookingController.getBookingsByVehicle
);

router.get(
  '/availability/:vehicleId',
  authMiddleware.verifyToken,
  bookingController.apiCheckAvailability
);

// --- Generic routes with parameters should come last ---

router.get(
  '/:bookingId',
  authMiddleware.verifyToken,
  bookingController.getBookingById
);

router.post(
  '/',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['renter', 'owner']),
  bookingController.createBooking
);

router.put(
  '/:bookingId/payment-method',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['renter']),
  bookingController.updateBookingPaymentMethod
);

router.put(
  '/:bookingId/status',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['owner', 'admin']),
  bookingController.updateBookingStatus
);

router.put(
  '/:bookingId/confirm-payment',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['owner', 'admin']),
  bookingController.confirmBookingPayment
);

router.delete(
  '/:bookingId',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['admin']),
  bookingController.deleteBooking
);

router.put('/:bookingId/approve', authMiddleware.verifyToken, authMiddleware.authorizeRole(['owner', 'admin']), bookingController.approveBooking);
router.put('/:bookingId/decline', authMiddleware.verifyToken, authMiddleware.authorizeRole(['owner', 'admin']), bookingController.declineBooking);

router.post(
    '/:bookingId/confirm-downpayment-by-user',
    authMiddleware.verifyToken,
    authMiddleware.authorizeRole(['renter']),
    bookingController.confirmDownpaymentByUser
);

// --- ADD THIS ROUTE TO FIX THE 404 ERROR ---
// Route for owner/admin to confirm they have received the payment
router.post(
  '/:bookingId/confirm-owner-payment',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['owner', 'admin']),
  bookingController.confirmOwnerPayment
);


module.exports = router;
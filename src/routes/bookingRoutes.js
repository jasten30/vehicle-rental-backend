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
  authMiddleware.verifyToken, // Note: This check requires a renter role
  authMiddleware.authorizeRole(['renter', 'owner']), // Added authorization
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
  authMiddleware.authorizeRole(['renter', 'owner']), // Only renters should create bookings
  bookingController.createBooking
);

router.post(
  '/:bookingId/report',
  authMiddleware.verifyToken, // Authorizes any logged-in user (renter or owner)
  bookingController.submitBookingReport
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

router.put(
  '/:bookingId/cancel',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['renter']),
  bookingController.cancelBooking
);

router.post(
    '/:bookingId/confirm-downpayment-by-user',
    authMiddleware.verifyToken,
    authMiddleware.authorizeRole(['renter', 'owner']),
    bookingController.confirmDownpaymentByUser
);

router.post(
  '/:bookingId/confirm-owner-payment',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['owner', 'admin']),
  bookingController.confirmOwnerPayment
);

router.post(
  '/:bookingId/request-extension',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['renter']),
  bookingController.requestBookingExtension
);

router.post(
  '/:bookingId/confirm-extension',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['renter']), 
  bookingController.confirmExtensionPayment
);

router.post(
  '/:bookingId/defer-extension',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['renter']),
  bookingController.deferExtensionPayment
);

router.get(
  '/:bookingId/contract',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['owner', 'admin']), 
  bookingController.generateBookingContract
);

module.exports = router;
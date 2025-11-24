// backend/src/routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middleware/authMiddleware');

// ==================================================================
// SPECIFIC ROUTES (Must come BEFORE generic /:bookingId routes)
// ==================================================================

// --- ADMIN ROUTES ---

router.get(
  '/all',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['admin']),
  bookingController.getAllBookings
);

// NEW: Admin gets all platform fee records
router.get(
  '/admin/platform-fees',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['admin']),
  bookingController.getAllPlatformFees
);

// NEW: Admin verifies a specific fee payment
router.put(
  '/admin/platform-fees/:feeId/verify',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['admin']),
  bookingController.verifyPlatformFee
);

// --- OWNER ROUTES ---

router.get(
  '/owner',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['owner', 'admin']),
  bookingController.getOwnerBookings
);

// NEW: Owner gets their own fee payment history
router.get(
  '/owner/my-fees',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['owner', 'admin']),
  bookingController.getOwnerPlatformFees
);

// Existing: Owner submits a fee payment
router.post(
  '/pay-platform-fee',
  authMiddleware.verifyToken,
  authMiddleware.authorizeRole(['owner', 'admin']),
  bookingController.submitPlatformFeePayment
);

// --- GENERAL/SHARED ROUTES ---

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
  authMiddleware.authorizeRole(['renter', 'owner']), 
  bookingController.apiCheckAvailability
);

// ==================================================================
// GENERIC ROUTES (Parameters like /:bookingId) - MUST BE LAST
// ==================================================================

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

router.post(
  '/:bookingId/report',
  authMiddleware.verifyToken, 
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
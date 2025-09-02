// backend/src/routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middleware/authMiddleware');

// Route to get all bookings (admin only)
router.get('/', authMiddleware.verifyToken, authMiddleware.authorizeRole(['admin']), bookingController.getAllBookings);

// Route for owners to get bookings for all their vehicles
router.get('/owner', authMiddleware.verifyToken, authMiddleware.authorizeRole(['owner', 'admin']), bookingController.getOwnerBookings);

// Route to get bookings by a specific user (renter or self-access)
// We remove authorizeRole to handle the permission check in the controller
router.get('/user/:userId', authMiddleware.verifyToken, bookingController.getBookingsByUser);

// Route to get all bookings for a specific vehicle
router.get('/vehicle/:vehicleId', authMiddleware.verifyToken, bookingController.getBookingsByVehicle);

// Route to check vehicle availability
router.get('/availability/:vehicleId', authMiddleware.verifyToken, bookingController.apiCheckAvailability);

// Route to get a single booking by its ID
router.get('/:bookingId', authMiddleware.verifyToken, bookingController.getBookingById);

// Route to create a new booking
router.post('/', authMiddleware.verifyToken, authMiddleware.authorizeRole(['renter', 'owner']), bookingController.createBooking);

// Route to update a booking's payment method (renter only)
router.put('/:bookingId/payment-method', authMiddleware.verifyToken, authMiddleware.authorizeRole(['renter']), bookingController.updateBookingPaymentMethod);

// Route to update a booking's status (admin/owner only)
router.put('/:bookingId/status', authMiddleware.verifyToken, authMiddleware.authorizeRole(['owner', 'admin']), bookingController.updateBookingStatus);

// Route to delete a booking (admin only)
router.delete('/:bookingId', authMiddleware.verifyToken, authMiddleware.authorizeRole(['admin']), bookingController.deleteBooking);

module.exports = router;

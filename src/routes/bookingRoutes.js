// backend/src/routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middleware/authMiddleware');

// Public route to get ALL bookings (e.g., for admin overview or general listing if applicable)
// This was the missing route handler causing the TypeError.
router.get('/', bookingController.getAllBookings);

// Route to create a new booking (requires authentication)
router.post('/', authMiddleware.verifyToken, authMiddleware.authorizeRole(['renter', 'admin']), bookingController.createBooking); // Added 'admin' role here

// Route to check vehicle availability for specific dates (GET request, parameters in query)
router.get('/availability/:vehicleId', authMiddleware.verifyToken, authMiddleware.authorizeRole(['renter', 'owner', 'admin']), bookingController.apiCheckAvailability); // Added 'owner', 'admin'

// Routes for getting bookings (e.g., for a user or vehicle)
router.get('/user/:userId', authMiddleware.verifyToken, authMiddleware.authorizeRole(['renter', 'owner', 'admin']), bookingController.getBookingsByUser);
router.get('/vehicle/:vehicleId', authMiddleware.verifyToken, authMiddleware.authorizeRole(['owner', 'admin']), bookingController.getBookingsByVehicle);
router.get('/:bookingId', authMiddleware.verifyToken, authMiddleware.authorizeRole(['renter', 'owner', 'admin']), bookingController.getBookingById);

// Route to update a booking's payment method (renter can update their own booking)
router.put('/:bookingId/payment-method', authMiddleware.verifyToken, authMiddleware.authorizeRole(['renter', 'admin']), bookingController.updateBookingPaymentMethod);

// Route to update booking status (typically admin/owner function)
router.put('/:bookingId/status', authMiddleware.verifyToken, authMiddleware.authorizeRole(['owner', 'admin']), bookingController.updateBookingStatus);

// Route to delete a booking (typically admin/owner function)
router.delete('/:bookingId', authMiddleware.verifyToken, authMiddleware.authorizeRole(['owner', 'admin']), bookingController.deleteBooking);


module.exports = router;

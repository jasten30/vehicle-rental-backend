const { admin, db } = require('../utils/firebase');

/**
 * Creates a new review for a vehicle booking.
 */
const createReview = async (req, res) => {
  try {
    // DEBUG: Log the entire customUser object to check if auth middleware is working
    console.log('Auth Middleware User:', req.customUser);

    const renterId = req.customUser.uid;
    const { bookingId, vehicleId, rating, categoricalRatings, comment } = req.body;

    // DEBUG: Log the incoming payload from the frontend
    console.log('Received payload:', req.body);

    if (!bookingId || !vehicleId || !rating || !categoricalRatings || !comment) {
      console.log('Validation failed: A required field is missing.');
      return res.status(400).json({ message: 'Missing required review fields.' });
    }

    const bookingRef = db.collection('bookings').doc(bookingId);
    const reviewRef = db.collection('reviews').doc(); // Create a new document reference for the review

    await db.runTransaction(async (transaction) => {
      console.log(`Starting transaction for booking ID: ${bookingId}`);
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        console.log('Transaction failed: Booking not found.');
        throw new Error('Booking not found.');
      }

      const bookingData = bookingDoc.data();
      console.log('Booking data retrieved:', bookingData);

      // Security Checks
      if (bookingData.renterId !== renterId) {
        console.log(`Authorization failed. Booking renter: ${bookingData.renterId}, Requester: ${renterId}`);
        throw new Error('You are not authorized to review this booking.');
      }
      if (bookingData.reviewSubmitted) {
        console.log('Transaction failed: Review already submitted.');
        throw new Error('A review has already been submitted for this booking.');
      }
      if (!['completed', 'returned'].includes(bookingData.paymentStatus)) {
        console.log(`Transaction failed: Invalid booking status - ${bookingData.paymentStatus}`);
        throw new Error('You can only review completed trips.');
      }

      console.log('All security checks passed. Creating review...');
      // Create the new review document
      const newReview = {
        vehicleId,
        bookingId,
        renterId,
        renterName: req.customUser.name || 'Anonymous', // Assumes name is on custom token
        rating,
        categoricalRatings,
        comment,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      transaction.set(reviewRef, newReview);

      // Mark the booking as having a review submitted to prevent duplicates
      transaction.update(bookingRef, { reviewSubmitted: true });
      console.log('Transaction successful: Review created and booking updated.');
    });

    res.status(201).json({ message: 'Review submitted successfully.' });
  } catch (error) {
    console.error('Error creating review:', error);
    res.status(500).json({ message: error.message || 'Server error creating review.' });
  }
};

module.exports = {
  createReview,
};


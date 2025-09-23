const { admin, db } = require('../utils/firebase');

/**
 * Creates a new review for a vehicle booking.
 */
const createReview = async (req, res) => {
  try {
    const renterId = req.customUser.uid;
    const { bookingId, vehicleId, rating, categoricalRatings, comment } = req.body;

    if (!bookingId || !vehicleId || !rating || !categoricalRatings || !comment) {
      return res.status(400).json({ message: 'Missing required review fields.' });
    }
    
    const bookingRef = db.collection('bookings').doc(bookingId);
    const reviewRef = db.collection('reviews').doc(); // Create a new document reference

    await db.runTransaction(async (transaction) => {
        const bookingDoc = await transaction.get(bookingRef);
        if (!bookingDoc.exists) {
            throw new Error('Booking not found.');
        }
        
        const bookingData = bookingDoc.data();

        // Security Checks
        if (bookingData.renterId !== renterId) {
            throw new Error('You are not authorized to review this booking.');
        }
        if (bookingData.reviewSubmitted) {
            throw new Error('A review has already been submitted for this booking.');
        }
        if (!['completed', 'returned'].includes(bookingData.paymentStatus)) {
            throw new Error('You can only review completed trips.');
        }
        
        // Create the new review document
        const newReview = {
            vehicleId,
            bookingId,
            renterId,
            renterName: req.customUser.name || 'Anonymous',
            rating,
            categoricalRatings,
            comment,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        transaction.set(reviewRef, newReview);

        // Mark the booking as having a review submitted to prevent duplicates
        transaction.update(bookingRef, { reviewSubmitted: true });
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

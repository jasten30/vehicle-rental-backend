const { admin, db } = require('../utils/firebase');
const { createNotification } = require('../utils/notificationHelper');
const { getAuth } = require('firebase-admin/auth');

// Helper to get user details
const getReviewerDetails = async (userId) => {
  if (!userId) return { name: 'Anonymous', profilePhotoUrl: null };
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return { name: 'Anonymous', profilePhotoUrl: null };
    const userData = userDoc.data();
    return {
      name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'User',
      profilePhotoUrl: userData.profilePhotoUrl || null,
    };
  } catch (error) {
    console.error(`Error fetching reviewer details for ${userId}:`, error);
    return { name: 'Anonymous', profilePhotoUrl: null };
  }
};

/**
 * Creates a new review for a vehicle booking.
 */
const createReview = async (req, res) => {
  try {
    const renterId = req.customUser.uid;
    const { bookingId, vehicleId, rating, categoricalRatings, comment } = req.body;

    if (!bookingId || !vehicleId || !rating || !categoricalRatings || !comment) {
      console.log('Validation failed: A required field is missing.');
      return res.status(400).json({ message: 'Missing required review fields.' });
    }

    const bookingRef = db.collection('bookings').doc(bookingId);
    const vehicleRef = db.collection('vehicles').doc(vehicleId); // <-- Get vehicle ref
    const reviewRef = db.collection('reviews').doc(); 

    await db.runTransaction(async (transaction) => {
      console.log(`Starting transaction for booking ID: ${bookingId}`);
      
      const [bookingDoc, vehicleDoc] = await Promise.all([
        transaction.get(bookingRef),
        transaction.get(vehicleRef)
      ]);

      if (!bookingDoc.exists) {
        console.log('Transaction failed: Booking not found.');
        throw new Error('Booking not found.');
      }
      if (!vehicleDoc.exists) {
        console.log('Transaction failed: Vehicle not found.');
        throw new Error('Vehicle not found.');
      }

      const bookingData = bookingDoc.data();
      const vehicleData = vehicleDoc.data(); // <-- Get vehicle data
      const ownerId = vehicleData.ownerId; // <-- GET THE OWNER ID

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
        ownerId: ownerId, // <-- ADDED OWNER ID
        renterName: req.customUser.name || 'Anonymous', 
        rating, // This should be the overallRating (e.g., 4.5)
        overallRating: rating, // Add this for clarity
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

// --- UPDATED 'getReviewsForHost' ---
const getReviewsForHost = async (req, res) => {
  try {
    const { hostId } = req.params;
    if (!hostId) {
      return res.status(400).json({ message: 'Host ID is required.' });
    }

    const reviewsRef = db.collection('reviews');
    const snapshot = await reviewsRef.where('ownerId', '==', hostId).get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    const reviewPromises = snapshot.docs.map(async (doc) => {
      const review = doc.data();
      
      // Fetch reviewer info
      const reviewerDetails = await getReviewerDetails(review.renterId);
      
      // Fetch vehicle info
      let vehicleDetails = { make: 'Unknown', model: 'Vehicle' };
      if (review.vehicleId) {
        const vehicleDoc = await db.collection('vehicles').doc(review.vehicleId).get();
        
        // --- THIS IS THE FIX ---
        // Changed vehicleDoc.exists() to vehicleDoc.exists
        if (vehicleDoc.exists) { 
        // --- END OF FIX ---
          vehicleDetails.make = vehicleDoc.data().make;
          vehicleDetails.model = vehicleDoc.data().model;
        }
      }

      return {
        id: doc.id,
        comment: review.comment,
        overallRating: review.overallRating || review.rating,
        createdAt: review.createdAt,
        reviewerName: reviewerDetails.name,
        reviewerPhotoUrl: reviewerDetails.profilePhotoUrl,
        vehicleMake: vehicleDetails.make,
        vehicleModel: vehicleDetails.model,
        reply: review.reply || null,
      };
    });

    const populatedReviews = await Promise.all(reviewPromises);
    
    populatedReviews.sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
        return dateB - dateA;
    });

    res.status(200).json(populatedReviews);

  } catch (error) {
    console.error(`Error fetching reviews for host ${req.params.hostId}:`, error);
    res.status(500).json({ message: 'Error fetching host reviews.', error: error.message });
  }
};
// --- END UPDATE ---

// --- NEW FUNCTION ---
const submitReviewReply = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { text } = req.body;
    const hostId = req.customUser.uid; // The person replying is the host

    if (!text || text.trim() === '') {
      return res.status(400).json({ message: 'Reply text is required.' });
    }

    const reviewRef = db.collection('reviews').doc(reviewId);
    const reviewDoc = await reviewRef.get();

    if (!reviewDoc.exists) {
      return res.status(404).json({ message: 'Review not found.' });
    }

    const reviewData = reviewDoc.data();

    // Security check: Only the owner of the vehicle (host) can reply
    if (reviewData.ownerId !== hostId) {
      return res.status(403).json({ message: 'You are not authorized to reply to this review.' });
    }

    // Check if a reply already exists
    if (reviewData.reply) {
      return res.status(400).json({ message: 'A reply has already been submitted for this review.' });
    }

    // Create the reply object
    const reply = {
      text: text.trim(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      hostId: hostId,
    };

    // Update the review document with the new reply
    await reviewRef.update({
      reply: reply
    });

    // Notify the renter that the host replied
    await createNotification(
      reviewData.renterId,
      `The host replied to your review for ${reviewData.vehicleMake || 'their vehicle'}.`,
      `/users/${hostId}` // Link back to the host's profile
    );

    res.status(201).json({ message: 'Reply posted successfully.', reply });

  } catch (error) {
    console.error('Error submitting review reply:', error);
    res.status(500).json({ message: error.message || 'Server error submitting reply.' });
  }
};
// --- END NEW FUNCTION ---

module.exports = {
  createReview,
  getReviewsForHost,
  submitReviewReply, // <-- ADD TO EXPORTS
};
const express = require('express');
const router = express.Router();
const reviewsController = require('../controllers/reviewsController');
// Import both verifyToken and authorizeRole
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

// POST /api/reviews - Create a new review
// Only authenticated 'renters' can create a review
router.post(
  '/', 
  verifyToken, 
  authorizeRole(['renter', 'owners']), 
  reviewsController.createReview
);

// GET /api/reviews/host/:hostId - Get all reviews for a host
router.get(
  '/host/:hostId',
  verifyToken, 
  reviewsController.getReviewsForHost
);

// --- ADD THIS NEW ROUTE ---
// POST /api/reviews/:reviewId/reply - Post a reply to a review
router.post(
  '/:reviewId/reply',
  verifyToken,
  authorizeRole(['owner', 'admin']), // Only owners or admin can reply
  reviewsController.submitReviewReply
);
// --- END NEW ROUTE ---

module.exports = router;
const express = require('express');
const router = express.Router();
const reviewsController = require('../controllers/reviewsController');
const { verifyToken } = require('../middleware/authMiddleware');

// This route now has logging to confirm it's being accessed.
router.post('/', verifyToken, (req, res, next) => {
    console.log('[ReviewsRoute] POST /api/reviews hit. Proceeding to controller...');
    next();
}, reviewsController.createReview);

module.exports = router;


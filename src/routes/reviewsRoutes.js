const express = require('express');
const router = express.Router();
const reviewsController = require('../controllers/reviewsController');
const { verifyToken } = require('../middleware/authMiddleware');

// Route to create a new review
router.post('/', verifyToken, reviewsController.createReview);

module.exports = router;

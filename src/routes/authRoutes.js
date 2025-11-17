const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const authMiddleware = require('../middleware/authMiddleware');

// POST /api/auth/register - User registration
router.post('/register', authController.register);

// POST /api/auth/login - User login ---
router.post('/login', authController.login);

// POST /api/auth/forgot-password - Forgot password
router.post('/forgot-password', authController.forgotPassword);

// --- ADD THIS PUBLIC ROUTE ---
// POST /api/auth/contact - Public contact form
router.post('/contact', authController.handleContactForm);
// --- END ADD ---

// Protected routes
router.post('/token-login', authMiddleware.verifyToken, authController.tokenLogin);

router.post('/reauthenticate', authMiddleware.verifyToken, authController.reauthenticateWithPassword);

module.exports = router;
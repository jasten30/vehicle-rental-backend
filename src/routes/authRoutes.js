// src/routes/authRoutes.js

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const authMiddleware = require('../middleware/authMiddleware');

// POST /api/auth/register - User registration
router.post('/register', authController.register);

// POST /api/auth/login - User login ---
router.post('/login', authController.login);

// Route for token-based login (used for phone auth)
router.post('/token-login', authMiddleware.verifyToken, authController.tokenLogin);

router.post('/reauthenticate', authMiddleware.verifyToken, authController.reauthenticateWithPassword);

module.exports = router;
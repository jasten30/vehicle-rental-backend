// src/routes/authRoutes.js

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// POST /api/auth/register - User registration
router.post('/register', authController.register);

// --- NEW: POST /api/auth/login - User login ---
router.post('/login', authController.login);

module.exports = router;
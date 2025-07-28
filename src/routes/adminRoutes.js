// src/routes/adminRoutes.js

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

// GET /api/admin/users - Get all users (protected, admin only)
router.get('/users', protect, authorizeRoles('admin'), adminController.getAllUsers);

module.exports = router;
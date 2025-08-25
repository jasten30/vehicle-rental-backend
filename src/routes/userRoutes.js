// backend/src/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

// Public route to create a user profile (e.g., on signup)
// Not needed here since we handle it in authMiddleware now

// Protected routes (require valid token)
router.get('/profile', verifyToken, userController.getUserProfile);
router.put('/profile', verifyToken, userController.updateUserProfile);

// NEW ROUTE TO HANDLE USER PROFILE UPDATES VIA POST
router.post('/', verifyToken, userController.updateUserProfile);

// Admin routes (require 'admin' role)
router.get('/all-users', verifyToken, authorizeRole(['admin']), userController.getAllUsers);
router.put('/update-role/:userId', verifyToken, authorizeRole(['admin']), userController.updateUserRoleByAdmin);

module.exports = router;

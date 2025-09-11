const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

// Protected routes (require valid token)
router.get('/profile', verifyToken, userController.getUserProfile);
router.put('/profile', verifyToken, userController.updateUserProfile);
router.post('/', verifyToken, userController.updateUserProfile);

// Admin routes (require 'admin' role)
router.get(
  '/all-users',
  verifyToken,
  authorizeRole(['admin']),
  userController.getAllUsers
);
router.put(
  '/update-role/:userId',
  verifyToken,
  authorizeRole(['admin']),
  userController.updateUserRoleByAdmin
);

// Routes for email verification
router.post(
  '/send-email-verification',
  verifyToken, // Use the destructured 'verifyToken'
  userController.sendEmailVerificationCode
);
router.post(
  '/verify-email-code',
  verifyToken, // Use the destructured 'verifyToken'
  userController.verifyEmailCode
);

module.exports = router;
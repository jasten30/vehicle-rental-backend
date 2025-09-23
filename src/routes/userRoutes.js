const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

// Protected routes (require valid token)
router.get('/profile', verifyToken, userController.getUserProfile);
router.put('/profile', verifyToken, userController.updateUserProfile);

// Route for an admin to delete a user and their associated data
router.delete(
  '/:userId',
  verifyToken,
  authorizeRole(['admin']),
  userController.deleteUser
);

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
  verifyToken,
  userController.sendEmailVerificationCode
);
router.post(
  '/verify-email-code',
  verifyToken,
  userController.verifyEmailCode
);

// Route for submitting a host application
router.post(
  '/submit-host-application',
  verifyToken,
  authorizeRole(['renter']),
  userController.submitHostApplication
);

// UPDATED: Route for submitting the driver application now accepts JSON with Base64 strings
router.post(
    '/drive-application',
    verifyToken,
    userController.submitDriveApplication
);

router.get('/host-applications', verifyToken, authorizeRole(['admin']), userController.getAllHostApplications);

// Routes for admin to manage host applications
router.put(
  '/approve-host-application',
  verifyToken,
  authorizeRole(['admin']),
  userController.approveHostApplication
);

router.put(
  '/decline-host-application',
  verifyToken,
  authorizeRole(['admin']),
  userController.declineHostApplication
);

module.exports = router;


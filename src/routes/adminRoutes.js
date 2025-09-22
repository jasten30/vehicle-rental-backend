const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

// All routes in this file are protected and can only be accessed by an admin.

// GET /api/admin/drive-applications
router.get(
  '/drive-applications',
  verifyToken,
  authorizeRole(['admin']),
  adminController.getDriveApplications
);

// POST /api/admin/drive-applications/approve
router.post(
  '/drive-applications/approve',
  verifyToken,
  authorizeRole(['admin']),
  adminController.approveDriveApplication
);

// POST /api/admin/drive-applications/decline
router.post(
  '/drive-applications/decline',
  verifyToken,
  authorizeRole(['admin']),
  adminController.declineDriveApplication
);

module.exports = router;

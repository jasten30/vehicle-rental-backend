const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

// Protect all admin routes and ensure the user has the 'admin' role
router.use(verifyToken, authorizeRole(['admin']));

// --- Drive Applications ---

// GET /api/admin/drive-applications
router.get(
  '/drive-applications',
  adminController.getDriveApplications // Middleware already applied via router.use
);

// POST /api/admin/drive-applications/approve
router.post(
  '/drive-applications/approve',
  adminController.approveDriveApplication // Middleware already applied
);

// POST /api/admin/drive-applications/decline
router.post(
  '/drive-applications/decline',
  adminController.declineDriveApplication // Middleware already applied
);


// --- Booking Reports ---

// GET /api/admin/reports - Fetch all booking reports
router.get(
    '/reports',
    adminController.getBookingReports // Middleware already applied
);

// PUT /api/admin/reports/:reportId/resolve - Mark a report as resolved
router.put(
    '/reports/:reportId/resolve',
    adminController.resolveBookingReport // Middleware already applied
);

// --- Admin-User Chat ---
router.post(
    '/chats/find-or-create',
    adminController.findOrCreateAdminUserChat // Point to new controller function
);


module.exports = router;
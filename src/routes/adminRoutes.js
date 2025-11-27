const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

// Protect all admin routes and ensure the user has the 'admin' role
router.use(verifyToken, authorizeRole(['admin']));

// -----------------------------------------------------------------
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

// -----------------------------------------------------------------
// --- Platform Fees ---

// GET /api/admin/platform-fees - Fetch all manually reported platform fees
router.get(
  '/platform-fees',
  adminController.getAllPlatformFees
);

// PUT /api/admin/platform-fees/:feeId/verify - Verify a pending payment report
router.put(
  '/platform-fees/:feeId/verify',
  adminController.verifyPlatformFee // <-- NEW VERIFICATION ROUTE
);

// -----------------------------------------------------------------
// --- Financial Statements ---

// GET /api/admin/host-statements - Fetch all summarized monthly host statements/balances
router.get(
  '/host-statements',
  adminController.getAllHostMonthlyStatements
);

// -----------------------------------------------------------------
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

// -----------------------------------------------------------------
// --- Admin-User Chat ---
router.post(
  '/chats/find-or-create',
  adminController.findOrCreateAdminUserChat // Point to new controller function
);


module.exports = router;
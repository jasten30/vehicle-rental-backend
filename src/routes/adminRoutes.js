const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

/* * [Developer's Note]:
 * Global Middleware Application
 * -----------------------------
 * All routes defined in this router are protected.
 * 1. verifyToken: Ensures the request has a valid JWT.
 * 2. authorizeRole(['admin']): Ensures the user has the 'admin' role claim.
 */
router.use(verifyToken, authorizeRole(['admin']));


// =================================================================
// [Developer's Note]: DRIVE APPLICATIONS
// Managing requests from users wanting to become drivers/renters.
// =================================================================

// GET /api/admin/drive-applications
router.get(
  '/drive-applications',
  adminController.getDriveApplications
);

// POST /api/admin/drive-applications/approve
router.post(
  '/drive-applications/approve',
  adminController.approveDriveApplication
);

// POST /api/admin/drive-applications/decline
router.post(
  '/drive-applications/decline',
  adminController.declineDriveApplication
);


// =================================================================
// [Developer's Note]: HOST APPLICATIONS (NEW)
// Managing requests from users wanting to list vehicles (become owners).
// =================================================================

// PUT /api/admin/approve-host-application
// Updates user role to 'owner' and application status to 'approved'
router.put(
  '/approve-host-application',
  adminController.approveHostApplication
);

// PUT /api/admin/decline-host-application
// Updates application status to 'declined'
router.put(
  '/decline-host-application',
  adminController.declineHostApplication
);


// =================================================================
// [Developer's Note]: PLATFORM FEES & FINANCE
// Managing manual fee reports from owners.
// =================================================================

// GET /api/admin/platform-fees
// Fetch all manually reported platform fees
router.get(
  '/platform-fees',
  adminController.getAllPlatformFees
);

// PUT /api/admin/platform-fees/:feeId/verify
// Verify a pending payment report so it reflects on the owner's dashboard
router.put(
  '/platform-fees/:feeId/verify',
  adminController.verifyPlatformFee
);

// GET /api/admin/host-statements
// Fetch all summarized monthly host statements/balances
router.get(
  '/host-statements',
  adminController.getAllHostMonthlyStatements
);


// =================================================================
// [Developer's Note]: BOOKING REPORTS
// Handling disputes or issues reported on bookings.
// =================================================================

// GET /api/admin/reports
// Fetch all booking reports
router.get(
  '/reports',
  adminController.getBookingReports
);

// PUT /api/admin/reports/:reportId/resolve
// Mark a report as resolved
router.put(
  '/reports/:reportId/resolve',
  adminController.resolveBookingReport
);


// =================================================================
// [Developer's Note]: ADMIN CHAT
// Direct communication channel.
// =================================================================

// POST /api/admin/chats/find-or-create
// Initiates or retrieves a 1-on-1 chat with a specific user
router.post(
  '/chats/find-or-create',
  adminController.findOrCreateAdminUserChat
);


module.exports = router;
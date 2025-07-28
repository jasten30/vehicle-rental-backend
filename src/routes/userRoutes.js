// backend/src/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController'); // Ensure this imports correctly
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

// Route to get user profile (requires authentication)
router.get('/profile', verifyToken, authorizeRole(['renter', 'admin']), userController.getUserProfile);

// Route to update user profile (requires authentication)
router.put('/profile', verifyToken, authorizeRole(['renter', 'admin']), userController.updateUserProfile);

// --- COMMENTED OUT: Routes for owner role requests (if they existed in your original userRoutes.js) ---
// These functions are not currently exported by the userController.js version I provided.
// If you need these features later, we will re-add the functions to userController.js
// and then uncomment/add these routes.
// router.post('/request-owner-role', verifyToken, authorizeRole(['renter']), userController.requestOwnerRole);
// router.get('/owner-role-requests', verifyToken, authorizeRole(['admin']), userController.getOwnerRoleRequests);
// router.put('/owner-role-requests/:requestId', verifyToken, authorizeRole(['admin']), userController.updateOwnerRoleRequest);

module.exports = router;

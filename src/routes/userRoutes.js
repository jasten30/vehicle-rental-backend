const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

// Route to get user profile (requires authentication)
// Allow 'renter', 'owner', and 'admin' roles to access their own profile
router.get('/profile', verifyToken, authorizeRole(['renter', 'owner', 'admin']), userController.getUserProfile);

// Route to update user profile (requires authentication)
// Allow 'renter', 'owner', and 'admin' roles to update their own profile
router.put('/profile', verifyToken, authorizeRole(['renter', 'owner', 'admin']), userController.updateUserProfile);

// --- COMMENTED OUT: Routes for owner role requests (if they existed in your original userRoutes.js) ---
// These functions are not currently exported by the userController.js version I provided.
// If you need these features later, we will re-add the functions to userController.js
// and then uncomment/add these routes.
// router.post('/request-owner-role', verifyToken, authorizeRole(['renter']), userController.requestOwnerRole);
// router.get('/owner-role-requests', verifyToken, authorizeRole(['admin']), userController.getOwnerRoleRequests);
// router.put('/owner-role-requests/:requestId', verifyToken, authorizeRole(['admin']), userController.updateOwnerRoleRequest);

module.exports = router;

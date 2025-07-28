const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

// Public routes (no authentication required)
router.get('/', vehicleController.getAllVehicles); // Get all vehicles

// Owner-specific routes (requires authentication and owner/admin role)
// IMPORTANT: This more specific route MUST come BEFORE the general /:id route
router.get('/my-listings', verifyToken, authorizeRole(['owner', 'admin']), vehicleController.getVehiclesByOwner);

// Public routes (no authentication required) - now after my-listings
router.get('/:id', vehicleController.getVehicleById); // Get vehicle by ID

// Admin and Owner specific routes (requires authentication and admin OR owner role)
// FIXED: Added 'owner' to authorizeRole for add, update, and delete
router.post('/', verifyToken, authorizeRole(['admin', 'owner']), vehicleController.addVehicle); // Add vehicle
router.put('/:id', verifyToken, authorizeRole(['admin', 'owner']), vehicleController.updateVehicle); // Update vehicle
router.delete('/:id', verifyToken, authorizeRole(['admin', 'owner']), vehicleController.deleteVehicle); // Delete vehicle

module.exports = router;

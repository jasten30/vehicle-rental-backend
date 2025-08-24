const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

// Public routes (no authentication required)
router.get('/', vehicleController.getAllVehicles);
router.get('/:id', vehicleController.getVehicleById);

// Owner-specific routes (requires authentication and owner/admin role)
router.get('/my-listings', verifyToken, authorizeRole(['owner', 'admin']), vehicleController.getVehiclesByOwner);

// Admin, Owner, and Renter specific routes
// FIXED: The addVehicle route now allows 'renter', 'admin', and 'owner' roles.
router.post('/', verifyToken, authorizeRole(['admin', 'owner', 'renter']), vehicleController.addVehicle);

// Admin and Owner specific routes (requires authentication and admin OR owner role)
router.put('/:id', verifyToken, authorizeRole(['admin', 'owner']), vehicleController.updateVehicle);
router.delete('/:id', verifyToken, authorizeRole(['admin', 'owner']), vehicleController.deleteVehicle);

module.exports = router;
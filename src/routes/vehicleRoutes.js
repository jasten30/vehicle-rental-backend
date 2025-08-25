const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');

// Public routes (no authentication required)
// The more specific route must be defined first
router.get('/my-listings', verifyToken, authorizeRole(['owner', 'admin']), vehicleController.getVehiclesByOwner);
router.get('/:id', vehicleController.getVehicleById);
router.get('/', vehicleController.getAllVehicles);

// The rest of your routes are fine as they are
router.post('/', verifyToken, authorizeRole(['admin', 'owner', 'renter']), vehicleController.addVehicle);
router.put('/:id', verifyToken, authorizeRole(['admin', 'owner']), vehicleController.updateVehicle);
router.delete('/:id', verifyToken, authorizeRole(['admin', 'owner']), vehicleController.deleteVehicle);

module.exports = router;

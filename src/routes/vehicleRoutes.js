const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');
const { verifyToken, authorizeRole } = require('../middleware/authMiddleware');
const authMiddleware = require('../middleware/authMiddleware'); // authMiddleware is imported twice, but harmless

// --- Specific routes must come before generic routes with parameters ---

// GET /api/vehicles/my-listings (For the logged-in owner's dashboard)
router.get(
  '/my-listings', 
  verifyToken, 
  authorizeRole(['owner', 'admin']), 
  vehicleController.getVehiclesByOwner
);

// --- NEW ROUTE ---
// GET /api/vehicles/owner/:userId (For public profiles)
router.get(
  '/owner/:userId',
  verifyToken, // Any logged-in user can view this
  vehicleController.getPublicVehiclesByOwner
);

// --- MOVED DOWN ---
// GET /api/vehicles/:id (Generic "by ID" route must come AFTER specific ones)
router.get(
  '/:id', 
  vehicleController.getVehicleById
);

// GET /api/vehicles/ (Public route to get all vehicles)
router.get(
  '/', 
  vehicleController.getAllVehicles
);

// --- PROTECTED ROUTES ---

// POST /api/vehicles/ (Only owners/admin can add)
router.post(
  '/', 
  verifyToken, 
  authorizeRole(['admin', 'owner']), // <-- Corrected: Renters can't add vehicles
  vehicleController.addVehicle
);

// PUT /api/vehicles/:id (Only owners/admin can update)
router.put(
  '/:id', 
  verifyToken, 
  authorizeRole(['admin', 'owner']), 
  vehicleController.updateVehicle
);

// DELETE /api/vehicles/:id (Only owners/admin can delete)
router.delete(
  '/:id', 
  verifyToken, 
  authorizeRole(['admin', 'owner']), 
  vehicleController.deleteVehicle
);

module.exports = router;
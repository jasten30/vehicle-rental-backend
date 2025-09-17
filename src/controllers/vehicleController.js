const { admin, db, storageBucket } = require('../utils/firebase');
const axios = require('axios');

/**
 * Helper function to upload a Base64 image to Firebase Storage.
 */
const uploadBase64Image = async (base64String, folderName = 'vehicle_images') => {
  if (!base64String || !base64String.startsWith('data:image/')) {
    return null;
  }
  const matches = base64String.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error('Invalid Base64 image string format.');
  }
  const contentType = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');
  const fileName = `${folderName}/${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${contentType.split('/')[1]}`;
  const file = storageBucket.file(fileName);
  await file.save(buffer, {
    metadata: { contentType: contentType },
    public: true,
  });
  return `https://storage.googleapis.com/${storageBucket.name}/${fileName}`;
};

/**
 * Helper function to geocode a location object.
 */
const geocodeLocation = async (location) => {
  if (!location || !location.city || !location.country) {
    return null;
  }
  let query = `${location.barangay}, ${location.city}, ${location.region}, ${location.country}`;
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: query, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'Car-Rental-App/1.0' },
    });
    if (response.data && response.data.length > 0) {
      return { lat: parseFloat(response.data[0].lat), lon: parseFloat(response.data[0].lon) };
    }
  } catch (error) {
    // Fallback on error
  }
  query = `${location.city}, ${location.country}`;
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: query, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'Car-Rental-App/1.0' },
    });
    if (response.data && response.data.length > 0) {
      return { lat: parseFloat(response.data[0].lat), lon: parseFloat(response.data[0].lon) };
    }
  } catch (error) {
    console.error('[VehicleController] Geocoding failed for all attempts.');
  }
  return null;
};

/**
 * Get all vehicles, enriched with owner's email for the admin view.
 */
const getAllVehicles = async (req, res) => {
  try {
    console.log('[VehicleController] Fetching all vehicles from Firestore...');
    const vehiclesSnapshot = await db.collection('vehicles').get();

    if (vehiclesSnapshot.empty) {
      console.log('[VehicleController] No vehicles found.');
      return res.status(200).json([]);
    }

    const vehiclesData = vehiclesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Get all unique owner IDs to fetch them efficiently
    const ownerIds = [...new Set(vehiclesData.map(v => v.ownerId).filter(Boolean))];

    if (ownerIds.length === 0) {
        console.log('[VehicleController] No owners found for the listed vehicles.');
        return res.status(200).json(vehiclesData); // Return vehicles without owner info
    }

    // Fetch all owner documents in parallel
    const ownerPromises = ownerIds.map(id => db.collection('users').doc(id).get());
    const ownerDocs = await Promise.all(ownerPromises);

    // Create a map for easy lookup of owner emails
    const ownersMap = new Map();
    ownerDocs.forEach(doc => {
      if (doc.exists) {
        ownersMap.set(doc.id, doc.data());
      }
    });

    // Enrich each vehicle with its owner's email
    const enrichedVehicles = vehiclesData.map(vehicle => {
      const owner = ownersMap.get(vehicle.ownerId);
      // Also format the availability data correctly
      let parsedAvailability = [];
      if (vehicle.availability && Array.isArray(vehicle.availability)) {
          parsedAvailability = vehicle.availability.map(range => ({
              start: range.start ? range.start.toDate().toISOString() : null,
              end: range.end ? range.end.toDate().toISOString() : null,
          }));
      }
      return {
        ...vehicle,
        ownerEmail: owner ? owner.email : 'N/A',
        createdAt: vehicle.createdAt ? vehicle.createdAt.toDate().toISOString() : null,
        updatedAt: vehicle.updatedAt ? vehicle.updatedAt.toDate().toISOString() : null,
        availability: parsedAvailability,
      };
    });

    console.log(`[VehicleController] Successfully fetched ${enrichedVehicles.length} vehicles.`);
    res.status(200).json(enrichedVehicles);
  } catch (error) {
    console.error('[VehicleController] Error fetching vehicles:', error);
    res.status(500).json({ message: 'Error fetching vehicles.', error: error.message });
  }
};

/**
 * Get a single vehicle by ID.
 */
const getVehicleById = async (req, res) => {
  try {
    const { id } = req.params;
    const vehicleDoc = await db.collection('vehicles').doc(id).get();

    if (!vehicleDoc.exists) {
      return res.status(404).json({ message: 'Vehicle not found.' });
    }

    const data = vehicleDoc.data();
    let parsedAvailability = [];
    if (data.availability && Array.isArray(data.availability)) {
        parsedAvailability = data.availability.map(range => ({
            start: range.start ? range.start.toDate().toISOString() : null,
            end: range.end ? range.end.toDate().toISOString() : null,
        }));
    }

    const vehicle = {
        id: vehicleDoc.id,
        ...data,
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
        updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
        availability: parsedAvailability,
        features: data.features || [],
    };
    
    res.status(200).json(vehicle);
  } catch (error) {
    console.error(`[VehicleController] Error fetching vehicle by ID ${req.params.id}:`, error);
    res.status(500).json({ message: 'Error fetching vehicle.', error: error.message });
  }
};

/**
 * Add a new vehicle.
 */
const addVehicle = async (req, res) => {
  try {
    const {
      make, model, year, seatingCapacity, vehicleType, transmission, fuelType,
      availability, location, pricing, safety, exteriorPhotos, interiorPhotos,
      profilePhotoUrl, cor, or, features,
    } = req.body;
    const ownerId = req.customUser.uid;

    if (!make || !model || !year) {
      return res.status(400).json({ message: 'Missing required vehicle fields.' });
    }

    const coordinates = await geocodeLocation(location);

    const newVehicle = {
      ownerId,
      make,
      model,
      year: parseInt(year, 10),
      seatingCapacity: seatingCapacity ? parseInt(seatingCapacity, 10) : null,
      rentalPricePerDay: parseFloat(pricing?.manualPrice),
      location,
      latitude: coordinates ? coordinates.lat : null,
      longitude: coordinates ? coordinates.lon : null,
      // UPDATED: Use the 'availability' constant directly from req.body
      availability: (availability || []).map(period => ({
        start: admin.firestore.Timestamp.fromDate(new Date(period.start)),
        end: admin.firestore.Timestamp.fromDate(new Date(period.end)),
      })),
      vehicleType,
      transmission,
      fuelType,
      features,
      pricing,
      safety,
      cor,
      or,
      profilePhotoUrl,
      exteriorPhotos,
      interiorPhotos,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('vehicles').add(newVehicle);
    res.status(201).json({ id: docRef.id });
  } catch (error) {
    console.error('[VehicleController] Error adding vehicle:', error);
    res.status(500).json({ message: 'Error adding vehicle.', error: error.message });
  }
};

/**
 * Update an existing vehicle.
 */
const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const ownerId = req.customUser.uid;

    const vehicleRef = db.collection('vehicles').doc(id);
    const vehicleDoc = await vehicleRef.get();

    if (!vehicleDoc.exists) {
      return res.status(404).json({ message: 'Vehicle not found.' });
    }
    if (vehicleDoc.data().ownerId !== ownerId) {
      return res.status(403).json({ message: 'Unauthorized: You do not own this vehicle.' });
    }

    if (updates.location) {
      const coordinates = await geocodeLocation(updates.location);
      if (coordinates) {
        updates.latitude = coordinates.lat;
        updates.longitude = coordinates.lon;
      }
    }

    if (updates.year) updates.year = parseInt(updates.year);
    if (updates.pricing?.manualPrice) updates.rentalPricePerDay = parseFloat(updates.pricing.manualPrice);
    if (updates.seatingCapacity) updates.seatingCapacity = parseInt(updates.seatingCapacity);

    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await vehicleRef.update(updates);
    res.status(200).json({ message: 'Vehicle updated successfully.', id });
  } catch (error) {
    console.error(`[VehicleController] Error updating vehicle ID ${req.params.id}:`, error);
    res.status(500).json({ message: 'Error updating vehicle.', error: error.message });
  }
};

/**
 * Delete a vehicle.
 */
const deleteVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.customUser.uid;

    const vehicleRef = db.collection('vehicles').doc(id);
    const vehicleDoc = await vehicleRef.get();

    if (!vehicleDoc.exists) {
      return res.status(404).json({ message: 'Vehicle not found.' });
    }
    if (vehicleDoc.data().ownerId !== ownerId) {
      return res.status(403).json({ message: 'Unauthorized: You do not own this vehicle.' });
    }

    await vehicleRef.delete();
    res.status(200).json({ message: 'Vehicle deleted successfully.' });
  } catch (error) {
    console.error(`[VehicleController] Error deleting vehicle ID ${req.params.id}:`, error);
    res.status(500).json({ message: 'Error deleting vehicle.', error: error.message });
  }
};

/**
 * Get vehicles by owner ID (authenticated user).
 */
const getVehiclesByOwner = async (req, res) => {
  try {
    const ownerId = req.customUser.uid;
    const vehiclesRef = db.collection('vehicles');
    const snapshot = await vehiclesRef.where('ownerId', '==', ownerId).get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    const vehicles = snapshot.docs.map(doc => {
      const data = doc.data();
      let parsedAvailability = [];
      if (data.availability && Array.isArray(data.availability)) {
          parsedAvailability = data.availability.map(range => ({
              start: range.start ? range.start.toDate().toISOString() : null,
              end: range.end ? range.end.toDate().toISOString() : null,
          }));
      }
      return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
          updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
          availability: parsedAvailability,
      };
    });
    res.status(200).json(vehicles);
  } catch (error) {
    console.error(`[VehicleController] Error fetching vehicles for owner ${req.customUser.uid}:`, error);
    res.status(500).json({ message: 'Error fetching owner vehicles.', error: error.message });
  }
};

module.exports = {
  getAllVehicles,
  getVehicleById,
  addVehicle,
  updateVehicle,
  deleteVehicle,
  getVehiclesByOwner,
};
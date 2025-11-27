const { admin, db, storageBucket } = require('../utils/firebase');
const axios = require('axios');

/**
 * Helper function to upload a Base64 image to Firebase Storage.
 */
const uploadBase64Image = async (base64String, folderName = 'vehicle_images') => {
  if (!base64String || !base64String.startsWith('data:image/')) {
    return base64String;
  }
  const matches = base64String.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    console.error('Invalid Base64 image string format detected.');
    return null;
  }
  const contentType = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const fileExtension = contentType.split('/')[1];
  const fileName = `${folderName}/${uniqueSuffix}.${fileExtension}`;

  const file = storageBucket.file(fileName);
  try {
    await file.save(buffer, {
      metadata: { contentType: contentType },
      public: true,
    });
    return file.publicUrl();
  } catch (uploadError) {
    console.error(`[VehicleController] Error uploading image to ${fileName}:`, uploadError);
    return null;
  }
};

/**
 * Helper function to extract the storage path from a public Google URL.
 */
const extractStoragePath = (url) => {
    if (!url || !url.includes(storageBucket.name)) return null;
    try {
        const urlParts = new URL(url);
        const prefix = `/b/${storageBucket.name}/o/`;
        if (urlParts.pathname.startsWith(prefix)) {
            return decodeURIComponent(urlParts.pathname.substring(prefix.length).split('?')[0]);
        }
    } catch(e){ 
        console.error("Error extracting path from URL:", url, e)
    }
    return null;
};

/**
 * Helper function to geocode a location object using Nominatim.
 */
const geocodeLocation = async (location) => {
  if (!location || !location.city || !location.country) {
    return null;
  }
  let query = `${location.barangay || ''}, ${location.city}, ${location.region || ''}, ${location.country}`.replace(/ ,/g, ',');
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: query, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'Car-Rental-App/1.0 (Development)' },
    });
    if (response.data && response.data.length > 0) {
      return { lat: parseFloat(response.data[0].lat), lon: parseFloat(response.data[0].lon) };
    }
  } catch (error) {
    console.error(`[VehicleController] Geocoding error (attempt 1) for query "${query}":`, error.message);
  }

  query = `${location.city}, ${location.country}`;
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: query, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'Car-Rental-App/1.0 (Development)' },
    });
    if (response.data && response.data.length > 0) {
      return { lat: parseFloat(response.data[0].lat), lon: parseFloat(response.data[0].lon) };
    }
  } catch (error) {
    console.error(`[VehicleController] Geocoding error (attempt 2) for query "${query}":`, error.message);
  }

  console.warn('[VehicleController] Geocoding failed for all attempts.');
  return null;
};

// ==================================================================
// CONTROLLER FUNCTIONS
// ==================================================================

const getAllVehicles = async (req, res) => {
  try {
    const vehiclesSnapshot = await db.collection('vehicles').get();

    if (vehiclesSnapshot.empty) {
      return res.status(200).json([]);
    }

    let vehiclesData = vehiclesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const shouldEnrich = req.customUser?.role === 'admin';

    if (shouldEnrich) {
       const ownerIds = [...new Set(vehiclesData.map(v => v.ownerId).filter(Boolean))];
       if (ownerIds.length > 0) {
         const ownerPromises = ownerIds.map(id => db.collection('users').doc(id).get());
         const ownerDocs = await Promise.all(ownerPromises);
         const ownersMap = new Map();
         ownerDocs.forEach(doc => {
           if (doc.exists) ownersMap.set(doc.id, doc.data());
         });
         vehiclesData = vehiclesData.map(vehicle => ({
             ...vehicle,
             ownerEmail: ownersMap.get(vehicle.ownerId)?.email || 'N/A'
         }));
       }
    }

    const formattedVehicles = vehiclesData.map(vehicle => {
      let parsedAvailability = [];
      if (vehicle.availability && Array.isArray(vehicle.availability)) {
        parsedAvailability = vehicle.availability
          .map(range => {
            const start = range.start?.toDate ? range.start.toDate().toISOString() : null;
            const end = range.end?.toDate ? range.end.toDate().toISOString() : null;
            return (start && end) ? { start, end } : null;
          })
          .filter(range => range !== null);
      }
      return {
        ...vehicle,
        createdAt: vehicle.createdAt?.toDate ? vehicle.createdAt.toDate().toISOString() : null,
        updatedAt: vehicle.updatedAt?.toDate ? vehicle.updatedAt.toDate().toISOString() : null,
        availability: parsedAvailability,
        features: vehicle.features || {},
      };
    });

    res.status(200).json(formattedVehicles);
  } catch (error) {
    console.error('[VehicleController][getAllVehicles] Error fetching vehicles:', error);
    res.status(500).json({ message: 'Error fetching vehicles.', error: error.message });
  }
};

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
      parsedAvailability = data.availability
        .map(range => {
           const start = range.start?.toDate ? range.start.toDate().toISOString() : null;
           const end = range.end?.toDate ? range.end.toDate().toISOString() : null;
           return (start && end) ? { start, end } : null;
        })
        .filter(range => range !== null);
    }

    const vehicle = {
        id: vehicleDoc.id,
        ...data,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : null,
        updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : null,
        availability: parsedAvailability,
        features: data.features || {},
    };

    res.status(200).json(vehicle);
  } catch (error) {
    console.error(`[VehicleController][getVehicleById] Error fetching vehicle by ID ${req.params.id}:`, error);
    res.status(500).json({ message: 'Error fetching vehicle.', error: error.message });
  }
};

const addVehicle = async (req, res) => {
  try {
    // --- NEW: SUSPENSION CHECK ---
    // If the user is suspended, block them from adding new vehicles
    if (req.customUser.isSuspended) {
        return res.status(403).json({ 
            message: 'Your account is suspended. You cannot list new vehicles.' 
        });
    }
    // -----------------------------

    const vehicleData = req.body;
    const ownerId = req.customUser.uid;
    const folderPath = `vehicles/${ownerId}`;

    if (!vehicleData.make || !vehicleData.model || !vehicleData.year) {
      console.warn('[VehicleController][addVehicle] Add vehicle failed: Missing required fields.');
      return res.status(400).json({ message: 'Missing required vehicle fields (make, model, year).' });
    }

    const cleanData = { ...vehicleData };
    // --- Image Uploads ---
    if (cleanData.cor?.corImage) { cleanData.cor.corImage = await uploadBase64Image(cleanData.cor.corImage, `${folderPath}/documents`); }
    const orImageBase64 = cleanData.or?.orImage || cleanData.or?.orImageUrl;
    if (orImageBase64) {
      const orUrl = await uploadBase64Image(orImageBase64, `${folderPath}/documents`);
      if (cleanData.or) { cleanData.or.orImage = orUrl; cleanData.or.orImageUrl = orUrl; }
      else { cleanData.or = { orImage: orUrl, orImageUrl: orUrl }; }
    }
    if (cleanData.profilePhotoUrl) { cleanData.profilePhotoUrl = await uploadBase64Image(cleanData.profilePhotoUrl, `${folderPath}/profile`); }
    if (Array.isArray(cleanData.exteriorPhotos) && cleanData.exteriorPhotos.length > 0) {
      const urls = await Promise.all(cleanData.exteriorPhotos.map((p, i) => uploadBase64Image(p, `${folderPath}/exterior_${i}`)));
      cleanData.exteriorPhotos = urls.filter(url => url);
    } else { cleanData.exteriorPhotos = []; }
    if (Array.isArray(cleanData.interiorPhotos) && cleanData.interiorPhotos.length > 0) {
      const urls = await Promise.all(cleanData.interiorPhotos.map((p, i) => uploadBase64Image(p, `${folderPath}/interior_${i}`)));
      cleanData.interiorPhotos = urls.filter(url => url);
    } else { cleanData.interiorPhotos = []; }

    const coordinates = await geocodeLocation(cleanData.location);

    const newVehicle = {
      ownerId,
      assetType: cleanData.assetType || 'vehicle', 
      motorcycleType: cleanData.motorcycleType || null,
      engineDisplacement: cleanData.engineDisplacement ? parseInt(cleanData.engineDisplacement, 10) : null,
      make: cleanData.make || null,
      model: cleanData.model || null,
      year: cleanData.year ? parseInt(cleanData.year, 10) : null,
      seatingCapacity: cleanData.seats ? parseInt(cleanData.seats, 10) : (cleanData.seatingCapacity ? parseInt(cleanData.seatingCapacity, 10) : null),
      vehicleType: cleanData.vehicleType || null,
      transmission: cleanData.transmission || null,
      fuelType: cleanData.fuelType || null,
      location: cleanData.location || null,
      latitude: coordinates ? coordinates.lat : null,
      longitude: coordinates ? coordinates.lon : null,
      rentalPricePerDay: parseFloat(cleanData.pricing?.manualPrice || cleanData.pricing?.recommendedPrice || 0),
      pricing: cleanData.pricing || {},
      availability: (cleanData.availability || [])
        .filter(period => period.start && period.end)
        .map(period => {
          try {
            const startDate = admin.firestore.Timestamp.fromDate(new Date(`${period.start}T00:00:00Z`));
            const endDate = admin.firestore.Timestamp.fromDate(new Date(`${period.end}T00:00:00Z`));
            if (isNaN(startDate.toDate().getTime()) || isNaN(endDate.toDate().getTime())) throw new Error('Invalid date');
            return { start: startDate, end: endDate };
          } catch (dateError) {
             console.error(`[VehicleController][addVehicle] FAILED DATE CONVERSION for period:`, period, dateError);
             return null;
          }
        })
        .filter(period => period !== null),
      features: cleanData.features || {},
      safety: cleanData.safety || {},
      cor: cleanData.cor || {},
      or: cleanData.or || {},
      profilePhotoUrl: cleanData.profilePhotoUrl || null,
      exteriorPhotos: cleanData.exteriorPhotos,
      interiorPhotos: cleanData.interiorPhotos,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('vehicles').add(newVehicle);
    res.status(201).json({ message: "Vehicle added successfully", id: docRef.id });

  } catch (error) {
    console.error('[VehicleController][addVehicle] Critical error adding vehicle:', error);
    res.status(500).json({ message: 'An internal error occurred while adding the vehicle.'});
  }
};

const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body.updates || req.body;
    const ownerId = req.customUser.uid;
    const folderPath = `vehicles/${ownerId}`;

    const vehicleRef = db.collection('vehicles').doc(id);
    const vehicleDoc = await vehicleRef.get();

    if (!vehicleDoc.exists) {
      console.warn(`[VehicleController][updateVehicle] Update failed: Vehicle not found for ID: ${id}`);
      return res.status(404).json({ message: 'Vehicle not found.' });
    }
    if (vehicleDoc.data().ownerId !== ownerId) {
      console.warn(`[VehicleController][updateVehicle] Update forbidden: User ${ownerId} does not own vehicle ${id}`);
      return res.status(403).json({ message: 'Unauthorized: You do not own this vehicle.' });
    }

    const cleanUpdates = { ...updates };
    
    if (cleanUpdates.cor?.corImage?.startsWith('data:image')) { cleanUpdates.cor.corImage = await uploadBase64Image(cleanUpdates.cor.corImage, `${folderPath}/documents`); }
    const orImageBase64 = cleanUpdates.or?.orImage || cleanUpdates.or?.orImageUrl;
    if (orImageBase64?.startsWith('data:image')) {
      const orUrl = await uploadBase64Image(orImageBase64, `${folderPath}/documents`);
      if (cleanUpdates.or) { cleanUpdates.or.orImage = orUrl; cleanUpdates.or.orImageUrl = orUrl; }
      else { cleanUpdates.or = { orImage: orUrl, orImageUrl: orUrl }; }
    }
    if (cleanUpdates.profilePhotoUrl?.startsWith('data:image')) { cleanUpdates.profilePhotoUrl = await uploadBase64Image(cleanUpdates.profilePhotoUrl, `${folderPath}/profile`); }
    
    if (Array.isArray(cleanUpdates.exteriorPhotos)) {
      const p = await Promise.all(cleanUpdates.exteriorPhotos.map((photo, i) => uploadBase64Image(photo, `${folderPath}/exterior_${i}`)));
      cleanUpdates.exteriorPhotos = p.filter(url => url);
    } else if (cleanUpdates.hasOwnProperty('exteriorPhotos')) { 
      delete cleanUpdates.exteriorPhotos; 
    }
    
    if (Array.isArray(cleanUpdates.interiorPhotos)) {
      const p = await Promise.all(cleanUpdates.interiorPhotos.map((photo, i) => uploadBase64Image(photo, `${folderPath}/interior_${i}`)));
      cleanUpdates.interiorPhotos = p.filter(url => url);
    } else if (cleanUpdates.hasOwnProperty('interiorPhotos')) { 
      delete cleanUpdates.interiorPhotos; 
    }

    if (cleanUpdates.location && typeof cleanUpdates.location === 'object') {
      const coordinates = await geocodeLocation(cleanUpdates.location);
      if (coordinates) { cleanUpdates.latitude = coordinates.lat; cleanUpdates.longitude = coordinates.lon; }
    }

    if (cleanUpdates.year) { cleanUpdates.year = parseInt(cleanUpdates.year, 10); }
    const price = cleanUpdates.pricing?.manualPrice ?? cleanUpdates.pricing?.recommendedPrice;
    if (price !== undefined && price !== null) { cleanUpdates.rentalPricePerDay = parseFloat(price); }
    if (cleanUpdates.seats) { cleanUpdates.seatingCapacity = parseInt(cleanUpdates.seats, 10); }
    else if (cleanUpdates.seatingCapacity) { cleanUpdates.seatingCapacity = parseInt(cleanUpdates.seatingCapacity, 10); }
    
    if (cleanUpdates.hasOwnProperty('engineDisplacement')) {
        cleanUpdates.engineDisplacement = cleanUpdates.engineDisplacement ? parseInt(cleanUpdates.engineDisplacement, 10) : null;
    }

    if (cleanUpdates.hasOwnProperty('availability') && Array.isArray(cleanUpdates.availability)) {
      cleanUpdates.availability = cleanUpdates.availability
        .filter(period => period.start && period.end)
        .map(period => {
          try {
            const startDate = admin.firestore.Timestamp.fromDate(new Date(`${period.start}T00:00:00Z`));
            const endDate = admin.firestore.Timestamp.fromDate(new Date(`${period.end}T00:00:00Z`));
            if (isNaN(startDate.toDate().getTime()) || isNaN(endDate.toDate().getTime())) {
                throw new Error('Invalid date created from string');
            }
            return { start: startDate, end: endDate };
          } catch (dateError) {
             console.error(`[VehicleController][updateVehicle] FAILED DATE CONVERSION for period:`, period, dateError);
             return null;
          }
        })
        .filter(period => period !== null);
    } else if (cleanUpdates.hasOwnProperty('availability')) {
      cleanUpdates.availability = [];
    }

    cleanUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await vehicleRef.update(cleanUpdates);
    res.status(200).json({ message: 'Vehicle updated successfully.', id });

  } catch (error) {
    console.error(`[VehicleController][updateVehicle] Critical error updating vehicle ID ${req.params.id}:`, error);
    res.status(500).json({ message: 'An internal error occurred while updating the vehicle.'});
  }
};

const deleteVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.customUser.uid;
    const userRole = req.customUser.role; // Get the role

    const vehicleRef = db.collection('vehicles').doc(id);
    const vehicleDoc = await vehicleRef.get();

    if (!vehicleDoc.exists) {
      console.warn(`[VehicleController][deleteVehicle] Delete failed: Vehicle not found for ID: ${id}`);
      return res.status(404).json({ message: 'Vehicle not found.' });
    }

    // --- PERMISSION CHECK ---
    // Allow if user is Admin OR if user matches the ownerId
    if (userRole !== 'admin' && vehicleDoc.data().ownerId !== ownerId) {
       console.warn(`[VehicleController][deleteVehicle] Delete forbidden: User ${ownerId} does not own vehicle ${id}`);
      return res.status(403).json({ message: 'Unauthorized: You do not own this vehicle.' });
    }

    // --- Delete associated images ---
    const vehicleData = vehicleDoc.data();
    const imagePathsToDelete = [];

    if (vehicleData.cor?.corImage) imagePathsToDelete.push(vehicleData.cor.corImage);
    if (vehicleData.or?.orImage) imagePathsToDelete.push(vehicleData.or.orImage);
    if (vehicleData.profilePhotoUrl) imagePathsToDelete.push(vehicleData.profilePhotoUrl);
    if (Array.isArray(vehicleData.exteriorPhotos)) vehicleData.exteriorPhotos.forEach(url => imagePathsToDelete.push(url));
    if (Array.isArray(vehicleData.interiorPhotos)) vehicleData.interiorPhotos.forEach(url => imagePathsToDelete.push(url));

    const deletePromises = [];
    for (const url of imagePathsToDelete) {
        const path = extractStoragePath(url);
        if (path) {
            deletePromises.push(
                storageBucket.file(path).delete().catch(err => 
                    console.error(`Failed to delete ${path}:`, err.message)
                )
            );
        }
    }
    
    await Promise.all(deletePromises);
    
    await vehicleRef.delete();
    console.log(`[VehicleController][deleteVehicle] Vehicle ID ${id} deleted successfully.`);
    res.status(200).json({ message: 'Vehicle deleted successfully.' });

  } catch (error) {
    console.error(`[VehicleController][deleteVehicle] Critical error deleting vehicle ID ${req.params.id}:`, error);
    res.status(500).json({ message: 'An internal error occurred while deleting the vehicle.'});
  }
};

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
         parsedAvailability = data.availability
           .map(range => {
               const start = range.start?.toDate ? range.start.toDate().toISOString() : null;
               const end = range.end?.toDate ? range.end.toDate().toISOString() : null;
               return (start && end) ? { start, end } : null;
           })
           .filter(range => range !== null);
      }
      return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : null,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : null,
          availability: parsedAvailability,
      };
    });
    res.status(200).json(vehicles);
  } catch (error) {
    console.error(`[VehicleController][getVehiclesByOwner] Error fetching vehicles for owner ${req.customUser.uid}:`, error);
    res.status(500).json({ message: 'Error fetching owner vehicles.', error: error.message });
  }
};

const getPublicVehiclesByOwner = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required.' });
    }

    const vehiclesRef = db.collection('vehicles');
    const snapshot = await vehiclesRef.where('ownerId', '==', userId).get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    const vehicles = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
          id: doc.id,
          make: data.make,
          model: data.model,
          year: data.year,
          rentalPricePerDay: data.rentalPricePerDay,
          location: data.location,
          profilePhotoUrl: data.profilePhotoUrl,
          exteriorPhotos: data.exteriorPhotos,
          assetType: data.assetType || 'vehicle'
      };
    });
    res.status(200).json(vehicles);
  } catch (error) {
    console.error(`[VehicleController][getPublicVehiclesByOwner] Error fetching vehicles for owner ${req.params.userId}:`, error);
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
  getPublicVehiclesByOwner, 
};
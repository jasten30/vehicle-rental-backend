// backend/controllers/vehicleController.js
const { admin, db, storageBucket } = require('../utils/firebase'); // Import storageBucket
const axios = require('axios'); // Import axios for making HTTP requests

/**
 * Helper function to upload a Base64 image to Firebase Storage.
 * Returns the public URL of the uploaded image.
 */
const uploadBase64Image = async (base64String, folderName = 'vehicle_images') => {
    // Check if it's a Base64 string (starts with data:image/...)
    if (!base64String || !base64String.startsWith('data:image/')) {
        return null; // Not a Base64 image, return null or throw error
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

    console.log(`[VehicleController] Uploading image to: gs://${storageBucket.name}/${fileName}`);

    await file.save(buffer, {
        metadata: { contentType: contentType },
        public: true, // Make the file publicly accessible
    });

    const publicUrl = `https://storage.googleapis.com/${storageBucket.name}/${fileName}`;
    console.log(`[VehicleController] Image uploaded. Public URL: ${publicUrl}`);
    return publicUrl;
};

/**
 * Helper function to geocode a location object into latitude and longitude.
 * Includes a fallback for more reliable results.
 * @param {{barangay: string, city: string, region: string, country: string}} location The location object.
 * @returns {Promise<{ lat: number, lon: number } | null>}
 */
const geocodeLocation = async (location) => {
    if (!location || !location.city || !location.country) {
        console.error('[VehicleController] Geocoding requires at least a city and country.');
        return null;
    }
    
    // Attempt 1: Full address string
    let query = `${location.barangay}, ${location.city}, ${location.region}, ${location.country}`;
    try {
        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: { q: query, format: 'json', limit: 1 },
            headers: { 'User-Agent': 'Car-Rental-App/1.0' }
        });
        if (response.data && response.data.length > 0) {
            console.log('[VehicleController] Geocoding successful with full address.');
            return { lat: parseFloat(response.data[0].lat), lon: parseFloat(response.data[0].lon) };
        }
    } catch (error) {
        console.warn(`[VehicleController] Geocoding failed for full address: ${error.message}`);
    }

    // Attempt 2: Fallback to a simpler query with just city and country
    console.log('[VehicleController] Full address failed. Attempting fallback with city and country...');
    query = `${location.city}, ${location.country}`;
    try {
        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: { q: query, format: 'json', limit: 1 },
            headers: { 'User-Agent': 'Car-Rental-App/1.0' }
        });
        if (response.data && response.data.length > 0) {
            console.log('[VehicleController] Geocoding successful with city and country fallback.');
            return { lat: parseFloat(response.data[0].lat), lon: parseFloat(response.data[0].lon) };
        }
    } catch (error) {
        console.warn(`[VehicleController] Geocoding failed for fallback query: ${error.message}`);
    }

    // Final failure
    console.error('[VehicleController] Geocoding failed for all attempts.');
    return null;
};

/**
 * Get all vehicles.
 */
const getAllVehicles = async (req, res) => {
    try {
        console.log('[VehicleController] Fetching all vehicles from Firestore...');
        const vehiclesRef = db.collection('vehicles');
        const snapshot = await vehiclesRef.get();

        if (snapshot.empty) {
            console.log('[VehicleController] No vehicles found.');
            return res.status(200).json([]);
        }

        const vehicles = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            
            // This is the fixed, robust check for the availability field
            let parsedAvailability = [];
            if (data.availability && Array.isArray(data.availability)) {
                parsedAvailability = data.availability.map(range => ({
                    start: range.start ? range.start.toDate().toISOString() : null,
                    end: range.end ? range.end.toDate().toISOString() : null,
                }));
            } else {
                console.warn(`[VehicleController] Vehicle ID ${doc.id} has malformed or missing availability data. Setting to empty array.`);
            }

            vehicles.push({
                id: doc.id,
                ...data,
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
                updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
                availability: parsedAvailability, // Use the new parsed variable
            });
        });

        console.log(`[VehicleController] Successfully fetched ${vehicles.length} vehicles.`);
        res.status(200).json(vehicles);
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
        console.log(`[VehicleController] Fetching vehicle with ID: ${id}`);
        const vehicleDoc = await db.collection('vehicles').doc(id).get();

        if (!vehicleDoc.exists) {
            console.log(`[VehicleController] Vehicle with ID ${id} not found.`);
            return res.status(404).json({ message: 'Vehicle not found.' });
        }

        const data = vehicleDoc.data();

        // Apply the same robust check here for consistency
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
        };

        console.log(`[VehicleController] Successfully fetched vehicle: ${id}`);
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
        // Destructure the nested fields correctly from the request body
        const {
            make, model, year, seatingCapacity, availability, location, pricing, safety, photos,
            cor, or, driversLicense, payoutDetails
        } = req.body;
        
        const ownerId = req.customUser.uid;

        // The backend will now check for all the required fields using the correct names.
        if (!make || !model || !year || !cor?.plateNumber || !pricing?.manualPrice || !ownerId || !location || !photos || photos.length === 0) {
            console.error('[VehicleController] Missing required fields for adding a vehicle.');
            return res.status(400).json({ message: 'Missing required vehicle fields. Please fill out all steps and upload at least one photo.' });
        }

        // Pass the entire location object to the updated geocodeLocation function
        const coordinates = await geocodeLocation(location);
        if (!coordinates) {
            console.error('[VehicleController] Invalid location provided.');
            return res.status(400).json({ message: 'Could not find a valid location for the provided address.' });
        }
        
        const newVehicle = {
            ownerId,
            make,
            model,
            year: parseInt(year),
            seatingCapacity,
            rentalPricePerDay: parseFloat(pricing?.manualPrice), // Pull from nested object
            location,
            latitude: coordinates.lat,
            longitude: coordinates.lon,
            availability: availability || [],
            pricing, // Use the entire pricing object
            safety, // Use the entire safety object
            cor, // Use the entire COR object
            or,  // Use the entire OR object
            photos,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection('vehicles').add(newVehicle);
        console.log('[VehicleController] Vehicle added with ID:', docRef.id);
        res.status(201).json({ id: docRef.id, ...newVehicle });
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

        console.log(`[VehicleController] Attempting to update vehicle ID: ${id} by owner: ${ownerId}`);

        const vehicleRef = db.collection('vehicles').doc(id);
        const vehicleDoc = await vehicleRef.get();

        if (!vehicleDoc.exists) {
            console.log(`[VehicleController] Vehicle with ID ${id} not found.`);
            return res.status(404).json({ message: 'Vehicle not found.' });
        }

        if (vehicleDoc.data().ownerId !== ownerId) {
            console.warn(`[VehicleController] Unauthorized attempt to update vehicle ${id} by user ${ownerId}.`);
            return res.status(403).json({ message: 'Unauthorized: You do not own this vehicle.' });
        }

        if (updates.location) {
            // Pass the entire location object to the updated geocodeLocation function
            const coordinates = await geocodeLocation(updates.location);
            if (coordinates) {
                updates.latitude = coordinates.lat;
                updates.longitude = coordinates.lon;
            }
        }
        
        if (updates.year) updates.year = parseInt(updates.year);
        if (updates.pricing?.manualPrice) updates.rentalPricePerDay = parseFloat(updates.pricing.manualPrice);

        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        
        // The frontend now sends a clean payload. Just update the document with the new data.
        await vehicleRef.update(updates);
        console.log(`[VehicleController] Vehicle ID ${id} updated successfully.`);
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
        const ownerId = req.customUser.uid; // Ensure only owner can delete their vehicle

        console.log(`[VehicleController] Attempting to delete vehicle ID: ${id} by owner: ${ownerId}`);

        const vehicleRef = db.collection('vehicles').doc(id);
        const vehicleDoc = await vehicleRef.get();

        if (!vehicleDoc.exists) {
            console.log(`[VehicleController] Vehicle with ID ${id} not found for deletion.`);
            return res.status(404).json({ message: 'Vehicle not found.' });
        }

        if (vehicleDoc.data().ownerId !== ownerId) {
            console.warn(`[VehicleController] Unauthorized attempt to delete vehicle ${id} by user ${ownerId}.`);
            return res.status(403).json({ message: 'Unauthorized: You do not own this vehicle.' });
        }

        await vehicleRef.delete();
        console.log(`[VehicleController] Vehicle ID ${id} deleted successfully.`);
        res.status(200).json({ message: 'Vehicle deleted successfully.' });
    } catch (error) {
        console.error(`[VehicleController] Error deleting vehicle ID ${req.params.id}:`, error);
        res.status(500).json({ message: 'Error deleting vehicle.', error: error.message });
    }
};

/**
 * Get vehicles by owner ID (authenticated user).
 * This endpoint will implicitly use the authenticated user's UID.
 */
const getVehiclesByOwner = async (req, res) => {
    try {
        const ownerId = req.customUser.uid; // Get ownerId from the authenticated user's token
        console.log(`[VehicleController] Fetching vehicles for authenticated owner ID: ${ownerId}`);

        const vehiclesRef = db.collection('vehicles');
        // Query vehicles where the 'ownerId' field matches the authenticated user's UID
        const snapshot = await vehiclesRef.where('ownerId', '==', ownerId).get();

        if (snapshot.empty) {
            console.log(`[VehicleController] No vehicles found for owner ${ownerId}.`);
            return res.status(200).json([]); // Return an empty array if no vehicles are found
        }

        const vehicles = snapshot.docs.map(doc => {
            const data = doc.data();
            
            // This is the correct, robust way to handle the availability field
            let parsedAvailability = [];
            if (data.availability && Array.isArray(data.availability)) {
                parsedAvailability = data.availability.map(range => ({
                    start: range.start ? range.start.toDate().toISOString() : null,
                    end: range.end ? range.end.toDate().toISOString() : null,
                }));
            } else {
                console.warn(`[VehicleController] Vehicle ID ${doc.id} has malformed or missing availability data.`);
            }

            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
                updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
                availability: parsedAvailability,
            };
        });

        console.log(`[VehicleController] Successfully fetched ${vehicles.length} vehicles for owner ID: ${ownerId}.`);
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
    getVehiclesByOwner, // Export the function
};
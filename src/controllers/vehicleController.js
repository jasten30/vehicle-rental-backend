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
 * Helper function to geocode a location string into latitude and longitude.
 * Uses the Nominatim OpenStreetMap API.
 * @param {string} location The address or location string to geocode.
 * @returns {Promise<{ lat: number, lon: number } | null>}
 */
const geocodeLocation = async (location) => {
    if (!location) {
        return null;
    }
    try {
        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
                q: location,
                format: 'json',
                limit: 1
            },
            headers: {
                'User-Agent': 'Car-Rental-App/1.0 (contact@your-app-domain.com)'
            }
        });

        const data = response.data;
        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lon: parseFloat(data[0].lon)
            };
        } else {
            return null;
        }
    } catch (error) {
        console.error('[VehicleController] Geocoding failed:', error.message);
        return null;
    }
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
            vehicles.push({
                id: doc.id,
                ...data,
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
                updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
                availability: data.availability ? data.availability.map(range => ({
                    start: range.start ? range.start.toDate().toISOString() : null,
                    end: range.end ? range.end.toDate().toISOString() : null,
                })) : [],
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
        const vehicle = {
            id: vehicleDoc.id,
            ...data,
            createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
            updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
            availability: data.availability ? data.availability.map(range => ({
                start: range.start ? range.start.toDate().toISOString() : null,
                end: range.end ? range.end.toDate().toISOString() : null,
            })) : [],
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
        const {
            make, model, year, licensePlate, rentalPricePerDay, description, location, seatingCapacity, availability,
            crImageUrl, orImageUrl, userProfileImageUrl, driversLicenseImageUrl, exteriorPhotoUrl, interiorPhotoUrl,
            safetyChecklist, safetyNotes, photos, // FIX: Added the 'photos' array from the frontend payload
            // FIX: Added other fields sent from the frontend
            driversLicenseNumber,
            mobileNumber,
            qrCodeUrl,
        } = req.body;
        const ownerId = req.customUser.uid;

        // FIX: The backend will now check for all the required fields.
        if (!make || !model || !year || !licensePlate || !rentalPricePerDay || !ownerId || !location || !photos || photos.length === 0) {
            console.error('[VehicleController] Missing required fields for adding a vehicle.');
            return res.status(400).json({ message: 'Missing required vehicle fields. Please fill out all steps and upload at least one photo.' });
        }

        const coordinates = await geocodeLocation(location);
        if (!coordinates) {
            console.error('[VehicleController] Invalid location provided.');
            return res.status(400).json({ message: 'Could not find a valid location for the provided address.' });
        }

        // FIX: Combine all image uploads into a single array for processing
        const allImagesToUpload = [
            { field: 'crImageUrl', url: crImageUrl, folder: 'documents' },
            { field: 'orImageUrl', url: orImageUrl, folder: 'documents' },
            { field: 'userProfileImageUrl', url: userProfileImageUrl, folder: 'user_profiles' },
            { field: 'driversLicenseImageUrl', url: driversLicenseImageUrl, folder: 'documents' },
            ...photos.map((url, index) => ({
                field: `photo_${index}`,
                url,
                folder: 'vehicle_photos'
            }))
        ];

        const uploadedImageUrls = {};
        const uploadedPhotoUrls = [];

        for (const image of allImagesToUpload) {
            if (image.url && image.url.startsWith('data:image/')) {
                const publicUrl = await uploadBase64Image(image.url, image.folder);
                if (image.field.startsWith('photo_')) {
                    uploadedPhotoUrls.push(publicUrl);
                } else {
                    uploadedImageUrls[image.field] = publicUrl;
                }
            } else if (image.url) {
                // If the URL is not a Base64 string, assume it's already a public URL
                if (image.field.startsWith('photo_')) {
                    uploadedPhotoUrls.push(image.url);
                } else {
                    uploadedImageUrls[image.field] = image.url;
                }
            }
        }
        
        const newVehicle = {
            make,
            model,
            year: parseInt(year),
            licensePlate,
            rentalPricePerDay: parseFloat(rentalPricePerDay),
            description: description || '',
            ownerId,
            location,
            latitude: coordinates.lat,
            longitude: coordinates.lon,
            seatingCapacity,
            availability: availability || [],
            safety: {
                checklist: safetyChecklist,
                notes: safetyNotes
            },
            // FIX: Store the new fields from the frontend
            driversLicenseNumber,
            mobileNumber,
            qrCodeUrl,
            // FIX: Use the new uploaded image URLs
            crImageUrl: uploadedImageUrls.crImageUrl || '',
            orImageUrl: uploadedImageUrls.orImageUrl || '',
            userProfileImageUrl: uploadedImageUrls.userProfileImageUrl || '',
            driversLicenseImageUrl: uploadedImageUrls.driversLicenseImageUrl || '',
            // FIX: Use the new array of photo URLs
            photos: uploadedPhotoUrls,
            exteriorPhotoUrl: uploadedPhotoUrls[0] || '', // Set first photo as exterior
            interiorPhotoUrl: uploadedPhotoUrls[1] || '', // Set second photo as interior
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection('vehicles').add(newVehicle);
        console.log(`[VehicleController] Vehicle added with ID: ${docRef.id}`);
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
            const coordinates = await geocodeLocation(updates.location);
            if (!coordinates) {
                return res.status(400).json({ message: 'Could not find a valid location for the provided address.' });
            }
            updates.latitude = coordinates.lat;
            updates.longitude = coordinates.lon;
        }

        // FIX: The update logic is now more robust. It handles Base64 image uploads and
        // updates for all image fields, including the new 'photos' array.
        const imageFields = ['userProfileImageUrl', 'crImageUrl', 'orImageUrl', 'driversLicenseImageUrl', 'exteriorPhotoUrl', 'interiorPhotoUrl'];
        const updatedData = { ...updates };
        const uploadedPhotoUrls = [];

        // Handle the main photo fields
        for (const field of imageFields) {
            if (updatedData[field] && updatedData[field].startsWith('data:image/')) {
                try {
                    updatedData[field] = await uploadBase64Image(updatedData[field], 'vehicle_photos');
                } catch (uploadError) {
                    console.error(`[VehicleController] Failed to upload image for ${field}:`, uploadError);
                    return res.status(500).json({ message: `Failed to upload image for ${field}.`, error: uploadError.message });
                }
            } else if (updatedData[field] === '') {
                updatedData[field] = '';
            }
        }

        // Handle the new 'photos' array
        if (updatedData.photos && Array.isArray(updatedData.photos)) {
            for (const url of updatedData.photos) {
                if (url && url.startsWith('data:image/')) {
                    const publicUrl = await uploadBase64Image(url, 'vehicle_photos');
                    uploadedPhotoUrls.push(publicUrl);
                } else if (url) {
                    uploadedPhotoUrls.push(url); // Keep existing public URLs
                }
            }
            updatedData.photos = uploadedPhotoUrls;
            // Update exterior/interior URLs based on the new photos array
            updatedData.exteriorPhotoUrl = uploadedPhotoUrls[0] || '';
            updatedData.interiorPhotoUrl = uploadedPhotoUrls[1] || '';
        }


        if (updatedData.year) updatedData.year = parseInt(updatedData.year);
        if (updatedData.rentalPricePerDay) updatedData.rentalPricePerDay = parseFloat(updatedData.rentalPricePerDay);

        if (updatedData.availability && Array.isArray(updatedData.availability)) {
            updatedData.availability = updatedData.availability.map(range => ({
                start: range.start ? new Date(range.start) : null,
                end: range.end ? new Date(range.end) : null,
            }));
        }

        // Ensure safety checklist and notes are correctly formatted
        if (updatedData.safetyChecklist) {
            updatedData.safety = {
                checklist: updatedData.safetyChecklist,
                notes: updatedData.safetyNotes
            };
            delete updatedData.safetyChecklist;
            delete updatedData.safetyNotes;
        }

        updatedData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        
        await vehicleRef.update(updatedData);
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
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
                updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
                availability: data.availability ? data.availability.map(range => ({
                    start: range.start ? range.start.toDate().toISOString() : null,
                    end: range.end ? range.end.toDate().toISOString() : null,
                })) : [],
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

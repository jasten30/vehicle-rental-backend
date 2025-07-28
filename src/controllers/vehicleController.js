const { admin, db, storageBucket } = require('../utils/firebase'); // Import storageBucket

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
 * Get all vehicles.
 */
const getAllVehicles = async (req, res) => {
    try {
        console.log('[VehicleController] Fetching all vehicles from Firestore...');
        const vehiclesRef = db.collection('vehicles');
        const snapshot = await vehiclesRef.get();

        if (snapshot.empty) {
            console.log('[VehicleController] No vehicles found.');
            return res.status(200).json([]); // Return an empty array if no vehicles
        }

        const vehicles = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            vehicles.push({
                id: doc.id,
                ...data,
                // Ensure dates are ISO strings if they are Firestore Timestamps
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
        const { make, model, year, licensePlate, rentalPricePerDay, description, imageUrl, location } = req.body;
        const ownerId = req.customUser.uid; // Owner is the authenticated user

        if (!make || !model || !year || !licensePlate || !rentalPricePerDay || !ownerId || !location) {
            return res.status(400).json({ message: 'Missing required vehicle fields.' });
        }

        let finalImageUrl = imageUrl || ''; // Default to empty string

        // If imageUrl is a Base64 string, upload it to storage
        if (imageUrl && imageUrl.startsWith('data:image/')) {
            console.log('[VehicleController] Image is Base64, uploading to Firebase Storage...');
            try {
                finalImageUrl = await uploadBase64Image(imageUrl);
            } catch (uploadError) {
                console.error('[VehicleController] Failed to upload Base64 image:', uploadError);
                return res.status(500).json({ message: 'Failed to upload image.', error: uploadError.message });
            }
        }

        const newVehicle = {
            make,
            model,
            year: parseInt(year),
            licensePlate,
            rentalPricePerDay: parseFloat(rentalPricePerDay),
            description: description || '',
            imageUrl: finalImageUrl, // Use the uploaded URL or original URL
            ownerId,
            location,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            availability: [],
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
        const ownerId = req.customUser.uid; // Ensure only owner can update their vehicle

        console.log(`[VehicleController] Attempting to update vehicle ID: ${id} by owner: ${ownerId}`);

        const vehicleRef = db.collection('vehicles').doc(id);
        const vehicleDoc = await vehicleRef.get();

        if (!vehicleDoc.exists) {
            console.log(`[VehicleController] Vehicle with ID ${id} not found.`);
            return res.status(404).json({ message: 'Vehicle not found.' });
        }

        if (vehicleDoc.data().ownerId !== ownerId) {
            console.warn(`[VehicleController] Unauthorized attempt to update vehicle ${id} by user ${ownerId}. Owner is ${vehicleDoc.data().ownerId}`);
            return res.status(403).json({ message: 'Unauthorized: You do not own this vehicle.' });
        }

        let finalImageUrl = updates.imageUrl; // Start with the provided imageUrl

        // If imageUrl is a Base64 string, upload it to storage
        if (updates.imageUrl && updates.imageUrl.startsWith('data:image/')) {
            console.log('[VehicleController] Image is Base64, uploading to Firebase Storage for update...');
            try {
                finalImageUrl = await uploadBase64Image(updates.imageUrl);
            } catch (uploadError) {
                console.error('[VehicleController] Failed to upload Base64 image during update:', uploadError);
                return res.status(500).json({ message: 'Failed to upload image during update.', error: uploadError.message });
            }
        } else if (updates.imageUrl === '') {
            // If imageUrl is explicitly set to empty, clear it
            finalImageUrl = '';
        }
        // If it's a regular URL, it remains as is.

        const updatedData = {
            ...updates,
            imageUrl: finalImageUrl, // Use the new URL or original if no change/upload
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (updatedData.year) updatedData.year = parseInt(updatedData.year);
        if (updatedData.rentalPricePerDay) updatedData.rentalPricePerDay = parseFloat(updatedData.rentalPricePerDay);

        // Handle availability updates: ensure dates are converted if provided
        if (updatedData.availability && Array.isArray(updatedData.availability)) {
            updatedData.availability = updatedData.availability.map(range => ({
                start: range.start ? new Date(range.start) : null,
                end: range.end ? new Date(range.end) : null,
            }));
        }

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
            console.warn(`[VehicleController] Unauthorized attempt to delete vehicle ${id} by user ${ownerId}. Owner is ${vehicleDoc.data().ownerId}`);
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

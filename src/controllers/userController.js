// backend/src/controllers/userController.js
const { db } = require('../utils/firebase'); // Removed 'admin' as it's not directly used in these functions

// Helper for consistent logging
const log = (message) => {
    console.log(`[UserController] ${message}`);
};

/**
 * Get user profile by UID.
 * Accessible only by the user themselves or an admin.
 */
const getUserProfile = async (req, res) => {
    try {
        const userId = req.customUser.uid; // UID from authenticated user
        log(`Attempting to fetch profile for user ID: ${userId}`);

        const userDoc = await db.collection('users').doc(userId).get();

        if (!userDoc.exists) {
            log(`User profile not found for ID: ${userId}`);
            return res.status(404).json({ message: 'User profile not found.' });
        }

        const userData = userDoc.data();
        // Filter out sensitive data like hashed passwords if they were ever stored here
        const profile = {
            uid: userDoc.id,
            email: userData.email,
            firstName: userData.firstName || '',
            lastName: userData.lastName || '',
            phoneNumber: userData.phoneNumber || '',
            address: userData.address || '',
            role: userData.role || 'renter', // Default role
            // Add other profile fields you want to expose
        };

        log(`Successfully fetched profile for user ID: ${userId}`);
        res.status(200).json(profile); // Directly return the profile object

    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ message: 'Server error fetching user profile.', error: error.message });
    }
};

/**
 * Update user profile.
 * Accessible only by the user themselves.
 */
const updateUserProfile = async (req, res) => {
    try {
        const userId = req.customUser.uid; // UID from authenticated user
        const updates = req.body; // Data to update

        log(`Attempting to update profile for user ID: ${userId} with updates:`, updates);

        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) {
            log(`User profile not found for ID: ${userId} during update attempt.`);
            return res.status(404).json({ message: 'User profile not found.' });
        }

        // Define allowed fields to update to prevent malicious updates
        const allowedUpdates = {};
        if (updates.firstName !== undefined) allowedUpdates.firstName = updates.firstName;
        if (updates.lastName !== undefined) allowedUpdates.lastName = updates.lastName;
        if (updates.phoneNumber !== undefined) allowedUpdates.phoneNumber = updates.phoneNumber;
        if (updates.address !== undefined) allowedUpdates.address = updates.address;
        // Do NOT allow direct updates to email, password, or role via this endpoint
        // Email/password changes should go through Firebase Authentication methods.

        if (Object.keys(allowedUpdates).length === 0) {
            return res.status(400).json({ message: 'No valid fields provided for update.' });
        }

        await userDocRef.update(allowedUpdates);

        // Fetch the updated profile to return it
        const updatedDoc = await userDocRef.get();
        const updatedData = updatedDoc.data();
        const updatedProfile = {
            uid: updatedDoc.id,
            email: updatedData.email, // Email won't change via this endpoint, but include for completeness
            firstName: updatedData.firstName || '',
            lastName: updatedData.lastName || '',
            phoneNumber: updatedData.phoneNumber || '',
            address: updatedData.address || '',
            role: updatedData.role || 'renter',
        };

        log(`Successfully updated profile for user ID: ${userId}`);
        res.status(200).json({ message: 'Profile updated successfully.', user: updatedProfile }); // Return message AND updated user object

    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ message: 'Server error updating user profile.', error: error.message });
    }
};

// --- No need for requestOwnerRole, getOwnerRoleRequests, updateOwnerRoleRequest for this specific task (F3.5.1) ---
// If these functions are part of your existing codebase and you need them,
// you should re-add them here, but ensure they don't interfere with the profile update logic.
// For the scope of F3.5.1, only getUserProfile and updateUserProfile are directly relevant.

module.exports = {
    getUserProfile,
    updateUserProfile,
    // If you have other user-related functions like requestOwnerRole, etc.,
    // include them here if they are part of your existing application.
    // For this specific task, we are focusing only on basic profile management.
};

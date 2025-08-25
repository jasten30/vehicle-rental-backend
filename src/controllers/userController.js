// backend/src/controllers/userController.js
const { db } = require('../utils/firebase');
const admin = require('firebase-admin');

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
        const userId = req.customUser.uid;
        log(`Attempting to fetch profile for user ID: ${userId}`);

        const userDoc = await db.collection('users').doc(userId).get();

        if (!userDoc.exists) {
            log(`User profile not found for ID: ${userId}`);
            return res.status(404).json({ message: 'User profile not found.' });
        }

        const userData = userDoc.data();
        const profile = {
            uid: userDoc.id,
            email: userData.email,
            firstName: userData.firstName || '',
            lastName: userData.lastName || '',
            phoneNumber: userData.phoneNumber || '',
            address: userData.address || '',
            role: userData.role || 'renter',
        };

        log(`Successfully fetched profile for user ID: ${userId}`);
        res.status(200).json(profile);
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
        const userId = req.customUser.uid;
        const updates = req.body;

        log(`Attempting to update profile for user ID: ${userId} with updates:`, updates);

        const userDocRef = db.collection('users').doc(userId);
        
        const allowedUpdates = {};
        if (updates.firstName !== undefined) allowedUpdates.firstName = updates.firstName;
        if (updates.lastName !== undefined) allowedUpdates.lastName = updates.lastName;
        if (updates.phoneNumber !== undefined) allowedUpdates.phoneNumber = updates.phoneNumber;
        if (updates.address !== undefined) allowedUpdates.address = updates.address;
        
        if (updates.userProfileImageUrl !== undefined) allowedUpdates.userProfileImageUrl = updates.userProfileImageUrl;
        if (updates.driversLicense !== undefined) allowedUpdates.driversLicense = updates.driversLicense;
        if (updates.payoutDetails !== undefined) allowedUpdates.payoutDetails = updates.payoutDetails;
        
        if (Object.keys(allowedUpdates).length === 0) {
            return res.status(400).json({ message: 'No valid fields provided for update.' });
        }

        await userDocRef.set(allowedUpdates, { merge: true });

        const updatedDoc = await userDocRef.get();
        const updatedData = updatedDoc.data();
        const updatedProfile = {
            uid: updatedDoc.id,
            email: updatedData.email,
            firstName: updatedData.firstName || '',
            lastName: updatedData.lastName || '',
            phoneNumber: updatedData.phoneNumber || '',
            address: updatedData.address || '',
            role: updatedData.role || 'renter',
            userProfileImageUrl: updatedData.userProfileImageUrl || '',
            driversLicense: updatedData.driversLicense || {},
            payoutDetails: updatedData.payoutDetails || {},
        };

        log(`Successfully updated profile for user ID: ${userId}`);
        res.status(200).json({ message: 'Profile updated successfully.', user: updatedProfile });
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ message: 'Server error updating user profile.', error: error.message });
    }
};

/**
 * Gets a list of all users and their basic details.
 * This is for the admin dashboard. Only accessible by admins.
 */
const getAllUsers = async (req, res) => {
    try {
        log('Attempting to fetch all user profiles for admin dashboard.');
        
        const usersSnapshot = await db.collection('users').get();
        const users = [];
        
        // Use a Promise.all to fetch vehicle counts for each user concurrently
        const userPromises = usersSnapshot.docs.map(async doc => {
            const userData = doc.data();
            // Fetch vehicle count for this user
            const vehicleCountQuery = await db.collection('vehicles').where('ownerId', '==', doc.id).count().get();
            const listingCount = vehicleCountQuery.data().count;

            return {
                uid: doc.id,
                email: userData.email,
                role: userData.role || 'renter',
                listingCount: listingCount,
            };
        });
        
        const allUsers = await Promise.all(userPromises);
        
        log(`Successfully fetched ${allUsers.length} user profiles.`);
        res.status(200).json(allUsers);
    } catch (error) {
        console.error('Error fetching all users:', error);
        res.status(500).json({ message: 'Failed to fetch all users.', error: error.message });
    }
};

/**
 * Updates a user's role by an admin.
 * Requires the admin role on the customUser object.
 */
const updateUserRoleByAdmin = async (req, res) => {
    try {
        const { userId } = req.params;
        const { role } = req.body;
        
        log(`Admin user ${req.customUser.uid} attempting to update role for ${userId} to ${role}.`);

        if (!role || (role !== 'owner' && role !== 'renter')) {
            return res.status(400).json({ message: 'Invalid role provided. Must be "owner" or "renter".' });
        }

        const userDocRef = db.collection('users').doc(userId);
        await userDocRef.set({ role }, { merge: true });

        log(`Successfully updated user ${userId} to role: ${role}.`);
        res.status(200).json({ message: 'User role updated successfully.', userId, newRole: role });

    } catch (error) {
        console.error('Error updating user role by admin:', error);
        res.status(500).json({ message: 'Failed to update user role.', error: error.message });
    }
};

module.exports = {
    getUserProfile,
    updateUserProfile,
    getAllUsers, // New
    updateUserRoleByAdmin, // New
};

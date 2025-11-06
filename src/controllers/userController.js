const { admin, db, storageBucket } = require('../utils/firebase');
const { sendVerificationEmail } = require('../utils/emailService');
const { getAuth } = require('firebase-admin/auth');

const log = (message, data = '') => {
  console.log(`[UserController] ${message}`, data);
};


const uploadBase64Image = async (base64String, folderName) => {
  if (!base64String || !base64String.startsWith('data:image/')) {
    // If it's already a URL, just return it.
    if (typeof base64String === 'string' && base64String.startsWith('http')) {
      return base64String;
    }
    return null;
  }
  const matches = base64String.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    console.error('Invalid Base64 string format.');
    return null;
  }

  const contentType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const fileName = `${folderName}/${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const file = storageBucket.file(fileName);

  try {
    await file.save(buffer, { metadata: { contentType }, public: true });
    // Return the correct public URL
    return file.publicUrl();
  } catch (uploadError) {
    console.error(`[UserController/upload] Error uploading image to ${fileName}:`, uploadError);
    return null;
  }
};
// =============================================================

const createUserProfile = async (req, res) => {
  try {
    const userId = req.customUser.uid;
    const { email, phone_number } = req.customUser;

    if (!email && !phone_number) {
      return res.status(400).json({ message: 'User token is missing email and phone number.' });
    }

    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();
    if (userDoc.exists) {
      return res.status(409).json({ message: 'User profile already exists.' });
    }

    const newUserProfile = {
      role: 'renter',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      emailVerified: req.customUser.email_verified || false,
      favorites: [],
      isBlocked: false,
    };

    if (email) newUserProfile.email = email;
    if (phone_number) newUserProfile.phoneNumber = phone_number;

    await userDocRef.set(newUserProfile, { merge: true }); // Use merge just in case
    res.status(210).json({ message: 'User profile created successfully.', user: newUserProfile });
  } catch (error) {
    console.error('Error creating user profile:', error);
    res.status(500).json({ message: 'Server error creating user profile.' });
  }
};

const getUserProfile = async (req, res) => {
  try {
    const userId = req.customUser.uid;
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User profile not found.' });
    }
    const userData = userDoc.data();
    const profile = {
      uid: userDoc.id,
      email: userData.email || '',
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
      phoneNumber: userData.phoneNumber || '',
      address: userData.address || null,
      role: userData.role || 'renter',
      about: userData.about || '',
      bannerImageUrl: userData.bannerImageUrl || '',
      profilePhotoUrl: userData.profilePhotoUrl || '',
      // --- ADDED ---
      payoutQRCodeUrl: userData.payoutQRCodeUrl || null,
      payoutDetails: userData.payoutDetails || null,
      // --- END ADDED ---
      isApprovedToDrive: userData.isApprovedToDrive || false,
      isMobileVerified: userData.isMobileVerified || false,
      emailVerified: userData.emailVerified || false,
      createdAt: userData.createdAt || null,
      monthlyBookingCounts: userData.monthlyBookingCounts || {},
      favorites: userData.favorites || [],
      isBlocked: userData.isBlocked || false,
    };
    res.status(200).json(profile);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Server error fetching user profile.' });
  }
};

const updateUserProfile = async (req, res) => {
  try {
    const userId = req.customUser.uid;
    const updates = req.body; // This will contain editableProfile
    const userDocRef = db.collection('users').doc(userId);

    // --- HANDLE IMAGE UPLOADS ---
    if (updates.bannerImageBase64) {
      const bannerUrl = await uploadBase64Image(updates.bannerImageBase64, `user_banners/${userId}`);
      if (bannerUrl) {
        updates.bannerImageUrl = bannerUrl;
      }
      delete updates.bannerImageBase64;
    }

    if (updates.profilePhotoBase64) {
        const photoUrl = await uploadBase64Image(updates.profilePhotoBase64, `user_photos/${userId}`);
        if (photoUrl) {
            updates.profilePhotoUrl = photoUrl; // Set the new URL
        }
        delete updates.profilePhotoBase64; // Remove base64 data
    }
    
    // --- !! ADDED QR CODE UPLOAD LOGIC !! ---
    if (updates.payoutQRCode && updates.payoutQRCode.startsWith('data:image')) {
      const folderName = `user_payout_qr/${userId}`;
      // Upload the new QR code
      updates.payoutQRCodeUrl = await uploadBase64Image(updates.payoutQRCode, folderName);
      // Remove the large Base64 string so it's not saved to Firestore
      delete updates.payoutQRCode; 
    }
    // --- !! END ADDED LOGIC !! ---


    if (updates.email && updates.email !== req.customUser.email) {
      try {
        await getAuth().updateUser(userId, {
          email: updates.email,
          emailVerified: false
        });
        updates.emailVerified = false;
      } catch (authError) {
        return res.status(400).json({ message: 'This email may already be in use.' });
      }
    }
    
    // Whitelist the fields that can be updated from the modal
    const allowedUpdates = {};
    if (updates.firstName !== undefined) allowedUpdates.firstName = updates.firstName;
    if (updates.lastName !== undefined) allowedUpdates.lastName = updates.lastName;
    if (updates.phoneNumber !== undefined) allowedUpdates.phoneNumber = updates.phoneNumber;
    if (updates.address !== undefined) allowedUpdates.address = updates.address;
    if (updates.about !== undefined) allowedUpdates.about = updates.about;
    if (updates.bannerImageUrl !== undefined) allowedUpdates.bannerImageUrl = updates.bannerImageUrl;
    if (updates.isMobileVerified !== undefined) allowedUpdates.isMobileVerified = updates.isMobileVerified;
    if (updates.email !== undefined) allowedUpdates.email = updates.email;
    if (updates.emailVerified !== undefined) allowedUpdates.emailVerified = updates.emailVerified;
    if (updates.profilePhotoUrl !== undefined) allowedUpdates.profilePhotoUrl = updates.profilePhotoUrl;
    // --- ADDED ---
    if (updates.payoutQRCodeUrl !== undefined) allowedUpdates.payoutQRCodeUrl = updates.payoutQRCodeUrl;
    if (updates.payoutDetails !== undefined) allowedUpdates.payoutDetails = updates.payoutDetails;
    // --- END ADDED ---

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update.' });
    }

    // Update name field if first/last name changes
    if (allowedUpdates.firstName || allowedUpdates.lastName) {
      const currentUserDoc = await userDocRef.get();
      const currentData = currentUserDoc.exists ? currentUserDoc.data() : {};
      const firstName = allowedUpdates.firstName ?? currentData.firstName ?? '';
      const lastName = allowedUpdates.lastName ?? currentData.lastName ?? '';
      const newName = `${firstName} ${lastName}`.trim();
      allowedUpdates.name = newName;
      
      // Update Firebase Auth display name
      if (newName) {
        await getAuth().updateUser(userId, { displayName: newName });
      }
    }

    await userDocRef.set(allowedUpdates, { merge: true });
    const updatedDoc = await userDocRef.get();
    res.status(200).json({ message: 'Profile updated successfully.', user: updatedDoc.data() });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ message: 'Server error updating user profile.' });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const vehiclesRef = db.collection('vehicles');
    const snapshot = await vehiclesRef.where('ownerId', '==', userId).get();

    if (!snapshot.empty) {
      log(`Found ${snapshot.size} vehicle(s) to delete for user ${userId}.`);
      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      log(`Successfully deleted vehicles for user ${userId}.`);
    }

    try {
      await getAuth().deleteUser(userId);
      log(`Successfully deleted user from Firebase Auth: ${userId}`);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        console.warn(`User not found in Firebase Auth, but proceeding with Firestore cleanup for UID: ${userId}`);
      } else {
        throw error;
      }
    }
    
    const userRef = db.collection('users').doc(userId);
    await userRef.delete();
    log(`Successfully deleted user from Firestore: ${userId}`);

    res.status(200).json({ message: 'User and all associated data have been deleted successfully.' });
  } catch (error) {
    console.error(`Error during deletion process for user ${req.params.userId}:`, error);
    res.status(500).json({ message: 'Failed to complete the user deletion process.' });
  }
};

const submitDriveApplication = async (req, res) => {
    try {
        const userId = req.customUser.uid;
        const { otherIdType, licenseImageBase64, otherIdImageBase64 } = req.body;

        if (!licenseImageBase64 || !otherIdImageBase64 || !otherIdType) {
            return res.status(400).json({ message: 'Missing required application data or images.' });
        }

        const [licenseUrl, otherIdUrl] = await Promise.all([
            uploadBase64Image(licenseImageBase64, `drive_applications/${userId}`),
            uploadBase64Image(otherIdImageBase64, `drive_applications/${userId}`)
        ]);

        if (!licenseUrl || !otherIdUrl) {
            return res.status(500).json({ message: 'Failed to upload one or more ID photos.' });
        }
        
        const applicationData = {
            userId: userId,
            status: 'pending',
            submittedAt: admin.firestore.FieldValue.serverTimestamp(),
            licenseUrl: licenseUrl,
            otherIdType: otherIdType,
            otherIdUrl: otherIdUrl,
        };

        await db.collection('driveApplications').add(applicationData);
        res.status(201).json({ message: 'Driver application submitted successfully.' });
    } catch (error) {
        console.error('Error submitting drive application:', error);
        res.status(500).json({ message: 'Server error while submitting application.' });
    }
};

const submitHostApplication = async (req, res) => {
  try {
    const userId = req.customUser.uid;
    const applicationData = req.body;

    const application = {
      ...applicationData,
      userId: userId,
      status: 'pending',
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('hostApplications').add(application);
    log(`New host application submitted by user: ${userId}`);
    res.status(201).json({ message: 'Application submitted successfully.' });
  } catch (error) {
    console.error('Error submitting host application:', error);
    res.status(500).json({ message: 'Failed to submit application.' });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const usersSnapshot = await db.collection('users').get();
    const userPromises = usersSnapshot.docs.map(async (doc) => {
      const userData = doc.data();
      const vehicleCountQuery = await db.collection('vehicles').where('ownerId', '==', doc.id).count().get();
      const listingCount = vehicleCountQuery.data().count;
      return {
        uid: doc.id,
        email: userData.email,
        name: userData.name || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
        role: userData.role || 'renter',
        listingCount: listingCount,
        createdAt: userData.createdAt,
        isBlocked: userData.isBlocked || false,
      };
    });
    const allUsers = await Promise.all(userPromises);
    res.status(200).json(allUsers);
  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({ message: 'Failed to fetch all users.' });
  }
};

const updateUserRoleByAdmin = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    if (!role || (role !== 'owner' && role !== 'renter')) {
      return res.status(400).json({ message: 'Invalid role provided.' });
    }
    const userDocRef = db.collection('users').doc(userId);
    await userDocRef.set({ role }, { merge: true });
    
    await getAuth().setCustomUserClaims(userId, { role: role });

    res.status(200).json({ message: 'User role updated successfully.', userId, newRole: role });
  } catch (error) {
    console.error('Error updating user role by admin:', error);
    res.status(500).json({ message: 'Failed to update user role.' });
  }
};

const sendEmailVerificationCode = async (req, res) => {
  try {
    const { uid } = req.customUser;
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User profile not found.' });
    }
    const email = userDoc.data().email;
    if (!email) {
      return res.status(400).json({ message: 'No email address is associated with this account.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = admin.firestore.Timestamp.fromMillis(Date.now() + 15 * 60 * 1000);
    console.log(`[DEV HINT] Verification code for ${email} is: ${code}`);

    await userRef.update({
      emailVerificationCode: code,
      emailVerificationExpires: expires,
    });
    await sendVerificationEmail(email, code);

    res.status(200).json({ message: 'Verification code sent successfully.' });
  } catch (error) {
    console.error('Error sending email verification code:', error);
    res.status(500).json({ message: 'Failed to send verification code.' });
  }
};

const verifyEmailCode = async (req, res) => {
  try {
    const { uid } = req.customUser;
    const { code } = req.body;
    if (!code || code.length !== 6) {
      return res.status(400).json({ message: 'Invalid code format.' });
    }
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found.' });
    }
    const userData = userDoc.data();
    if (userData.emailVerificationCode !== code) {
      return res.status(400).json({ message: 'Incorrect verification code.' });
    }
    if (admin.firestore.Timestamp.now() > userData.emailVerificationExpires) {
      return res.status(400).json({ message: 'Verification code has expired.' });
    }
    await userRef.update({
      emailVerified: true,
      emailVerificationCode: admin.firestore.FieldValue.delete(),
      emailVerificationExpires: admin.firestore.FieldValue.delete(),
    });
    await getAuth().updateUser(uid, { emailVerified: true });
    res.status(200).json({ message: 'Email verified successfully.' });
  } catch (error) {
    console.error('Error verifying email code:', error);
    res.status(500).json({ message: 'Failed to verify code.' });
  }
};

const getAllHostApplications = async (req, res) => {
  try {
    const snapshot = await db.collection('hostApplications').where('status', '==', 'pending').get();
    if (snapshot.empty) {
      return res.status(200).json([]);
    }
    const applications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(applications);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch host applications.' });
  }
};

const approveHostApplication = async (req, res) => {
  try {
    const { applicationId, userId } = req.body;
    
    await db.collection('hostApplications').doc(applicationId).update({ status: 'approved' });
    
    await db.collection('users').doc(userId).update({ role: 'owner', isApprovedToDrive: true });
    
    await getAuth().setCustomUserClaims(userId, { role: 'owner' });

    log(`Host application ${applicationId} for user ${userId} approved.`);
    res.status(200).json({ message: 'Host application approved successfully.' });
  } catch (error) {
    console.error('Error approving host application:', error);
    res.status(500).json({ message: 'Failed to approve application.' });
  }
};

const declineHostApplication = async (req, res) => {
  try {
    const { applicationId } = req.body;
    await db.collection('hostApplications').doc(applicationId).update({ status: 'declined' });
    
    log(`Host application ${applicationId} declined.`);
    res.status(200).json({ message: 'Host application declined successfully.' });
  } catch (error) {
    console.error('Error declining host application:', error);
    res.status(500).json({ message: 'Failed to decline application.' });
  }
};

const toggleFavoriteVehicle = async (req, res) => {
    const { vehicleId } = req.body;
    const userId = req.customUser.uid; 

    if (!vehicleId) {
        return res.status(400).json({ message: 'Vehicle ID is required.' });
    }

    const userRef = db.collection('users').doc(userId);

    try {
        let newFavorites = [];
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const userData = userDoc.data();
        const currentFavorites = userData.favorites || [];

        if (currentFavorites.includes(vehicleId)) {
            // Remove from favorites (unfavorite)
            newFavorites = currentFavorites.filter(id => id !== vehicleId);
            await userRef.update({ favorites: newFavorites });
        } else {
            // Add to favorites (favorite)
            newFavorites = [...currentFavorites, vehicleId];
            await userRef.update({ favorites: newFavorites });
        }

        // Return the new, updated list of favorites
        res.status(200).json({ favorites: newFavorites });

    } catch (error) {
        console.error(`Error toggling favorite for user ${userId}:`, error);
        res.status(500).json({ message: 'Server error while updating favorites.' });
    }
};

const updateUserBlockStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { isBlocked } = req.body;
    const adminUserId = req.customUser.uid;

    if (typeof isBlocked !== 'boolean') {
      return res.status(400).json({ message: 'Invalid "isBlocked" value. Must be true or false.' });
    }

    if (userId === adminUserId) {
        return res.status(400).json({ message: 'Admin cannot block themselves.' });
    }

    const userRef = db.collection('users').doc(userId);
    await userRef.update({
      isBlocked: isBlocked,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    if (isBlocked) {
        try {
            await getAuth().revokeRefreshTokens(userId);
            log(`Revoked refresh tokens for blocked user ${userId}.`);
        } catch (revokeError) {
             console.error(`Failed to revoke refresh tokens for user ${userId}:`, revokeError.message);
        }
    }

    log(`Admin ${adminUserId} ${isBlocked ? 'blocked' : 'unblocked'} user ${userId}.`);
    res.status(200).json({ message: `User ${isBlocked ? 'blocked' : 'unblocked'} successfully.` });

  } catch (error) {
    console.error(`Error updating user block status for ${req.params.userId}:`, error);
    res.status(500).json({ message: 'Server error updating user status.' });
  }
};


module.exports = {
  createUserProfile,
  getUserProfile,
  updateUserProfile,
  deleteUser,
  submitDriveApplication,
  getAllUsers,
  submitHostApplication,
  updateUserRoleByAdmin,
  sendEmailVerificationCode,
  verifyEmailCode,
  getAllHostApplications,
  approveHostApplication,
  declineHostApplication,
  toggleFavoriteVehicle,
  updateUserBlockStatus,
};


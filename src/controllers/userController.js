const { db, storageBucket } = require('../utils/firebase');
const admin = require('firebase-admin');
const { sendVerificationEmail } = require('../utils/emailService');

// Helper for consistent logging
const log = (message, data = '') => {
  console.log(`[UserController] ${message}`, data);
};

// Helper function to upload a Base64 image
const uploadBase64Image = async (base64String, folderName) => {
  if (!base64String || !base64String.startsWith('data:image/')) return null;
  const matches = base64String.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!matches || matches.length !== 3)
    throw new Error('Invalid Base64 string.');

  const contentType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const fileName = `${folderName}/${Date.now()}_${Math.random()
    .toString(36)
    .substring(2, 9)}`;
  const file = storageBucket.file(fileName);

  await file.save(buffer, { metadata: { contentType }, public: true });
  return `https://storage.googleapis.com/${storageBucket.name}/${fileName}`;
};

const createUserProfile = async (req, res) => {
  try {
    const userId = req.customUser.uid;
    // UPDATED: Get both email and phoneNumber from the decoded token
    const { email, phone_number } = req.customUser;

    log(`Attempting to create a new profile for user ID: ${userId}`);

    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();

    if (userDoc.exists) {
      log(`User profile for ID: ${userId} already exists.`);
      return res.status(409).json({ message: 'User profile already exists.' });
    }

    // UPDATED: Create a profile object that can handle a missing email
    const newUserProfile = {
      role: 'renter',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      emailVerified: false,
    };

    // Only add email or phoneNumber if they exist in the token
    if (email) {
      newUserProfile.email = email;
    }
    if (phone_number) {
      newUserProfile.phoneNumber = phone_number;
    }

    if (!email && !phone_number) {
      return res
        .status(400)
        .json({ message: 'User token is missing email and phone number.' });
    }

    await userDocRef.set(newUserProfile);

    log(`Successfully created profile for user ID: ${userId}`);
    res
      .status(201)
      .json({ message: 'User profile created successfully.', user: newUserProfile });
  } catch (error) {
    console.error('Error creating user profile:', error);
    res.status(500).json({
      message: 'Server error creating user profile.',
      error: error.message,
    });
  }
};

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
      isApprovedToDrive: userData.isApprovedToDrive || false,
      isMobileVerified: userData.isMobileVerified || false,
      emailVerified: userData.emailVerified || false,
      createdAt: userData.createdAt || null,
    };
    log(`Successfully fetched profile for user ID: ${userId}`);
    res.status(200).json(profile);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({
      message: 'Server error fetching user profile.',
      error: error.message,
    });
  }
};

const updateUserProfile = async (req, res) => {
  try {
    const userId = req.customUser.uid;
    const updates = req.body;
    const userDocRef = db.collection('users').doc(userId);

    if (updates.bannerImageBase64) {
      const bannerUrl = await uploadBase64Image(updates.bannerImageBase64);
      if (bannerUrl) {
        updates.bannerImageUrl = bannerUrl;
      }
      delete updates.bannerImageBase64;
    }

    const allowedUpdates = {};
    if (updates.firstName !== undefined)
      allowedUpdates.firstName = updates.firstName;
    if (updates.lastName !== undefined)
      allowedUpdates.lastName = updates.lastName;
    if (updates.phoneNumber !== undefined)
      allowedUpdates.phoneNumber = updates.phoneNumber;
    if (updates.address !== undefined)
      allowedUpdates.address = updates.address;
    if (updates.about !== undefined) allowedUpdates.about = updates.about;
    if (updates.bannerImageUrl !== undefined)
      allowedUpdates.bannerImageUrl = updates.bannerImageUrl;
    if (updates.isMobileVerified !== undefined)
      allowedUpdates.isMobileVerified = updates.isMobileVerified;

    if (Object.keys(allowedUpdates).length === 0) {
      return res
        .status(400)
        .json({ message: 'No valid fields provided for update.' });
    }
    
    // Create a composite name field if first/last names are being updated
    if (allowedUpdates.firstName || allowedUpdates.lastName) {
        const currentUserDoc = await userDocRef.get();
        const currentData = currentUserDoc.data();
        const firstName = allowedUpdates.firstName ?? currentData.firstName ?? '';
        const lastName = allowedUpdates.lastName ?? currentData.lastName ?? '';
        allowedUpdates.name = `${firstName} ${lastName}`.trim();
    }


    await userDocRef.set(allowedUpdates, { merge: true });

    const updatedDoc = await userDocRef.get();
    res
      .status(200)
      .json({ message: 'Profile updated successfully.', user: updatedDoc.data() });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res
      .status(500)
      .json({
        message: 'Server error updating user profile.',
        error: error.message,
      });
  }
};

const getAllUsers = async (req, res) => {
  try {
    log('Attempting to fetch all user profiles for admin dashboard.');
    const usersSnapshot = await db.collection('users').get();

    const userPromises = usersSnapshot.docs.map(async (doc) => {
      const userData = doc.data();
      const vehicleCountQuery = await db
        .collection('vehicles')
        .where('ownerId', '==', doc.id)
        .count()
        .get();
      const listingCount = vehicleCountQuery.data().count;
      return {
        uid: doc.id,
        email: userData.email,
        name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
        role: userData.role || 'renter',
        listingCount: listingCount,
        createdAt: userData.createdAt,
      };
    });

    const allUsers = await Promise.all(userPromises);
    log(`Successfully fetched ${allUsers.length} user profiles.`);
    res.status(200).json(allUsers);
  } catch (error) {
    console.error('Error fetching all users:', error);
    res
      .status(500)
      .json({ message: 'Failed to fetch all users.', error: error.message });
  }
};

const updateUserRoleByAdmin = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    log(
      `Admin user ${req.customUser.uid} attempting to update role for ${userId} to ${role}.`
    );

    if (!role || (role !== 'owner' && role !== 'renter')) {
      return res.status(400).json({ message: 'Invalid role provided.' });
    }

    const userDocRef = db.collection('users').doc(userId);
    await userDocRef.set({ role }, { merge: true });

    log(`Successfully updated user ${userId} to role: ${role}.`);
    res
      .status(200)
      .json({ message: 'User role updated successfully.', userId, newRole: role });
  } catch (error) {
    console.error('Error updating user role by admin:', error);
    res
      .status(500)
      .json({ message: 'Failed to update user role.', error: error.message });
  }
};

/**
 * Generates and sends an email verification code to the authenticated user.
 */
const sendEmailVerificationCode = async (req, res) => {
  try {
    const { uid, email } = req.customUser;

    // 2. Add a safety check for the email
    if (!email) {
      log(`Verification code request failed: User ${uid} has no email address.`);
      return res
        .status(400)
        .json({ message: 'No email address is associated with this account.' });
    }

    log(`Sending verification code to email: ${email} for user: ${uid}`);

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = admin.firestore.Timestamp.fromMillis(Date.now() + 15 * 60 * 1000);

    console.log(`[DEV HINT] Verification code for ${email} is: ${code}`);

    await db.collection('users').doc(uid).update({
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

/**
 * Verifies an email OTP code submitted by a user.
 */
const verifyEmailCode = async (req, res) => {
  try {
    const { uid } = req.customUser;
    const { code } = req.body;
    log(`Verifying email code '${code}' for user: ${uid}`);

    if (!code || code.length !== 6) {
      return res.status(400).json({ message: 'Invalid code format.' });
    }

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const userData = userDoc.data();
    const now = admin.firestore.Timestamp.now();

    if (userData.emailVerificationCode !== code) {
      return res.status(400).json({ message: 'Incorrect verification code.' });
    }
    if (now > userData.emailVerificationExpires) {
      return res.status(400).json({ message: 'Verification code has expired.' });
    }

    // Code is correct, update verification status in Firestore and Firebase Auth
    await userRef.update({
      emailVerified: true,
      emailVerificationCode: admin.firestore.FieldValue.delete(), // Remove used code
      emailVerificationExpires: admin.firestore.FieldValue.delete(),
    });
    await admin.auth().updateUser(uid, { emailVerified: true });

    log(`Email successfully verified for user: ${uid}`);
    res.status(200).json({ message: 'Email verified successfully.' });
  } catch (error) {
    console.error('Error verifying email code:', error);
    res.status(500).json({ message: 'Failed to verify code.' });
  }
};

module.exports = {
  createUserProfile,
  getUserProfile,
  updateUserProfile,
  getAllUsers,
  updateUserRoleByAdmin,
  sendEmailVerificationCode,
  verifyEmailCode,
};
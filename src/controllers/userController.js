const { admin, db, storageBucket } = require('../utils/firebase');
const { sendVerificationEmail } = require('../utils/emailService');

const log = (message, data = '') => {
  console.log(`[UserController] ${message}`, data);
};

const uploadBase64Image = async (base64String, folderName) => {
  if (!base64String || !base64String.startsWith('data:image/')) return null;
  const matches = base64String.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) throw new Error('Invalid Base64 string.');

  const contentType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const fileName = `${folderName}/${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const file = storageBucket.file(fileName);

  await file.save(buffer, { metadata: { contentType }, public: true });
  return `https://storage.googleapis.com/${storageBucket.name}/${fileName}`;
};

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
    };

    if (email) newUserProfile.email = email;
    if (phone_number) newUserProfile.phoneNumber = phone_number;

    await userDocRef.set(newUserProfile);
    res.status(201).json({ message: 'User profile created successfully.', user: newUserProfile });
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
      isApprovedToDrive: userData.isApprovedToDrive || false,
      isMobileVerified: userData.isMobileVerified || false,
      emailVerified: userData.emailVerified || false,
      createdAt: userData.createdAt || null,
      // --- THIS IS THE FIX ---
      // Ensure monthlyBookingCounts is always included in the user profile
      monthlyBookingCounts: userData.monthlyBookingCounts || {},
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
    const updates = req.body;
    const userDocRef = db.collection('users').doc(userId);

    if (updates.bannerImageBase64) {
      const bannerUrl = await uploadBase64Image(updates.bannerImageBase64, 'user_banners');
      if (bannerUrl) {
        updates.bannerImageUrl = bannerUrl;
      }
      delete updates.bannerImageBase64;
    }

    if (updates.email && updates.email !== req.customUser.email) {
      try {
        await admin.auth().updateUser(userId, {
          email: updates.email,
          emailVerified: false
        });
        updates.emailVerified = false;
      } catch (authError) {
        return res.status(400).json({ message: 'This email may already be in use.' });
      }
    }
    
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

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update.' });
    }

    if (allowedUpdates.firstName || allowedUpdates.lastName) {
      const currentUserDoc = await userDocRef.get();
      const currentData = currentUserDoc.exists ? currentUserDoc.data() : {};
      const firstName = allowedUpdates.firstName ?? currentData.firstName ?? '';
      const lastName = allowedUpdates.lastName ?? currentData.lastName ?? '';
      allowedUpdates.name = `${firstName} ${lastName}`.trim();
    }

    await userDocRef.set(allowedUpdates, { merge: true });
    const updatedDoc = await userDocRef.get();
    res.status(200).json({ message: 'Profile updated successfully.', user: updatedDoc.data() });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ message: 'Server error updating user profile.' });
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
    await admin.auth().updateUser(uid, { emailVerified: true });
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
    
    await admin.auth().setCustomUserClaims(userId, { role: 'owner' });

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

module.exports = {
  createUserProfile,
  getUserProfile,
  updateUserProfile,
  getAllUsers,
  submitHostApplication,
  updateUserProfile,
  updateUserRoleByAdmin,
  sendEmailVerificationCode,
  verifyEmailCode,
  getAllHostApplications,
  approveHostApplication,
  declineHostApplication,
};

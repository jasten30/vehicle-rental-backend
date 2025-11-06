const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { hashPassword, comparePasswords } = require('../utils/passwordUtil');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/emailService');

const log = (message) => {
  console.log(`[AuthController] ${message}`);
};

const register = async (req, res) => {
  try {
    const { email, password, firstName, lastName, phoneNumber } = req.body;
    const defaultRole = 'renter';

    if (!email || !password || !firstName || !lastName || !phoneNumber) {
      return res
        .status(400)
        .json({ message: 'All fields are required.' });
    }

    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      phoneNumber: phoneNumber,
      displayName: `${firstName} ${lastName}`,
      emailVerified: false,
    });

    await admin.auth().setCustomUserClaims(userRecord.uid, { role: defaultRole });

    const userDocRef = admin.firestore().collection('users').doc(userRecord.uid);
    await userDocRef.set({
      uid: userRecord.uid,
      email: userRecord.email,
      phoneNumber: userRecord.phoneNumber,
      firstName: firstName,
      lastName: lastName,
      name: `${firstName} ${lastName}`,
      role: defaultRole,
      passwordHash: await hashPassword(password), // This is now just for fallback/migration
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      emailVerified: false,
      isMobileVerified: true, 
      favorites: [], 
      isBlocked: false,
    });

    const customToken = await admin.auth().createCustomToken(userRecord.uid);

    res.status(201).json({
      message: 'User registered successfully!',
      token: customToken,
    });
  } catch (error) {
    console.error('Error during registration:', error.code, error.message);
    let errorMessage = 'Server error during registration.';
    if (error.code === 'auth/email-already-exists') {
      errorMessage = 'The email address is already in use by another account.';
    } else if (error.code === 'auth/invalid-phone-number') {
      errorMessage = 'The phone number is not a valid format.';
    } else if (error.code === 'auth/phone-number-already-exists') {
      errorMessage = 'The phone number is already in use by another account.';
    }
    res.status(500).json({ message: errorMessage, error: error.message });
  }
};

// --- !! COMPLETELY UPDATED LOGIN FUNCTION !! ---
const login = async (req, res) => {
  const { idToken } = req.body; // Expect an ID Token, not email/password
  log(`Login attempt with ID Token...`);
  
  if (!idToken) {
    log('Login failed: ID Token is required.');
    return res.status(400).json({ message: 'ID Token is required.' });
  }

  try {
    // 1. Verify the ID Token from the frontend
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    log(`ID Token verified for UID: ${uid}`);

    // 2. Get user data from Firestore
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) {
      log(`Firestore user document not found for UID: ${uid}`);
      return res.status(404).json({ message: 'User data not found.' });
    }
    const userData = userDoc.data();

    // 3. Check if user is blocked
    if (userData.isBlocked === true) {
        log(`Login failed: User ${uid} is blocked.`);
        return res.status(403).json({ message: 'Your account has been restricted. Please contact support.' });
    }
    
    // 4. Create a new *Custom* Token that includes their role
    // This allows your frontend Firebase instance to know their role
    const customToken = await admin
      .auth()
      .createCustomToken(uid, { role: userData.role });
    
    log(`Custom token created for UID: ${uid}`);
    res.status(200).json({
      message: 'Login successful!',
      token: customToken, // Send the new custom token back
    });

  } catch (error) {
    console.error('Error during login:', error.code, error.message);
    let errorMessage = 'Server error during login.';
    if (error.code === 'auth/id-token-expired') {
      errorMessage = 'Login session expired. Please sign in again.';
    } else if (error.code === 'auth/id-token-revoked') {
      errorMessage = 'Your account session has been revoked. Please sign in again.';
    }
    res.status(500).json({ message: errorMessage, error: error.message });
  }
};
// --- !! END UPDATED LOGIN FUNCTION !! ---


const tokenLogin = async (req, res) => {
  // This function is now very similar to login, but is used by initializeAuth
  try {
    const { uid } = req.customUser;
    log(`Token login attempt for UID: ${uid}`);

    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User data not found.' });
    }
    
    const userData = userDoc.data();

    if (userData.isBlocked === true) {
        log(`Token login failed: User ${uid} is blocked.`);
        return res.status(403).json({ message: 'Your account has been restricted.' });
    }
    
    // Create a new custom token with the user's role
    const customToken = await admin.auth().createCustomToken(uid, { role: userData.role });
    
    log(`Custom token created for UID: ${uid}`);
    res.status(200).json({
      message: 'Login successful!',
      token: customToken,
    });
  } catch (error) {
    console.error('Error during token login:', error);
    res.status(500).json({ message: 'Server error during token login.' });
  }
};

const reauthenticateWithPassword = async (req, res) => {
  // This function remains unchanged and will work fine
  try {
    const { password } = req.body;
    const { uid } = req.customUser;
    
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User data not found.' });
    }

    // We still check the Firestore hash here for re-authentication
    const passwordMatch = await comparePasswords(password, userDoc.data().passwordHash);
    
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Incorrect password.' });
    }
    
    res.status(200).json({ message: 'Re-authentication successful.' });
  } catch (error) {
    console.error('Error during re-authentication:', error);
    res.status(500).json({ message: 'Server error during re-authentication.' });
  }
};

const forgotPassword = async (req, res) => {
  // This function is correct as-is
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  try {
    const user = await getAuth().getUserByEmail(email);
    if (!user) {
        return res.status(200).json({ message: 'If this email is registered, a reset link will be sent.' });
    }

    const resetLink = await getAuth().generatePasswordResetLink(email);
    
    await sendPasswordResetEmail(email, resetLink);
    
    res.status(200).json({ message: 'Password reset link sent! Please check your email.' });
  
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
        return res.status(200).json({ message: 'If this email is registered, a reset link will be sent.' });
    }
    console.error('[authController] Error generating password reset link:', error);
    res.status(500).json({ message: 'Server error.', error: error.message });
  }
};

module.exports = {
  register,
  login,
  tokenLogin,
  reauthenticateWithPassword,
  forgotPassword,
};
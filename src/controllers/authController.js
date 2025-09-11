const admin = require('firebase-admin');
const { hashPassword, comparePasswords } = require('../utils/passwordUtil');
const { sendVerificationEmail } = require('../utils/emailService');

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

    log(`Attempting to register user: ${email} with default role: ${defaultRole}`);

    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      phoneNumber: phoneNumber,
      displayName: `${firstName} ${lastName}`,
      emailVerified: false,
    });

    await admin.auth().setCustomUserClaims(userRecord.uid, { role: defaultRole });
    log(`Custom claim { role: '${defaultRole}' } set for user: ${userRecord.uid}`);

    const hashedPassword = await hashPassword(password);
    const userDocRef = admin.firestore().collection('users').doc(userRecord.uid);

    await userDocRef.set({
      uid: userRecord.uid,
      email: userRecord.email,
      phoneNumber: userRecord.phoneNumber,
      firstName: firstName,
      lastName: lastName,
      name: `${firstName} ${lastName}`,
      role: defaultRole,
      passwordHash: hashedPassword,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      emailVerified: false,
      isMobileVerified: false,
    });

    // We can optionally send the first verification email right away
    // const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    // await sendVerificationEmail(email, verificationCode);
    
    const customToken = await admin.auth().createCustomToken(userRecord.uid);

    log(`User registered successfully: ${userRecord.uid} (${email})`);
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
    }
    res.status(500).json({ message: errorMessage, error: error.message });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;
  log(`Login attempt for email: ${email}`);
  if (!email || !password) {
    log('Login failed: Email and password are required.');
    return res.status(400).json({ message: 'Email and password are required.' });
  }
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    log(`Found user record for ${email}. UID: ${userRecord.uid}`);
    const userDoc = await admin
      .firestore()
      .collection('users')
      .doc(userRecord.uid)
      .get();
    if (!userDoc.exists) {
      log(`Firestore user document not found for UID: ${userRecord.uid}`);
      return res.status(404).json({ message: 'User data not found.' });
    }
    const userData = userDoc.data();
    const storedPasswordHash = userData.passwordHash;
    if (!storedPasswordHash) {
      log(`No password hash found in Firestore for UID: ${userRecord.uid}.`);
      return res
        .status(500)
        .json({ message: 'Server configuration error: Password hash missing.' });
    }
    const passwordMatch = await comparePasswords(password, storedPasswordHash);
    log(`Password comparison result: ${passwordMatch}`);
    if (!passwordMatch) {
      log('Login failed: Invalid credentials (password mismatch).');
      return res.status(401).json({ message: 'Invalid credentials.' });
    }
    const customToken = await admin
      .auth()
      .createCustomToken(userRecord.uid, { role: userData.role });
    log(`Custom token created for UID: ${userRecord.uid}`);
    res.status(200).json({
      message: 'Login successful!',
      token: customToken,
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        role: userData.role,
        displayName: userData.displayName || null,
      },
    });
  } catch (error) {
    console.error('Error during login:', error.code, error.message);
    let errorMessage = 'Server error during login.';
    if (
      error.code === 'auth/user-not-found' ||
      error.code === 'auth/invalid-email' ||
      error.code === 'auth/wrong-password'
    ) {
      errorMessage = 'Invalid credentials.';
    }
    res.status(500).json({ message: errorMessage, error: error.message });
  }
};

/**
 * Handles login via a Firebase ID token (e.g., from a phone auth).
 * It finds the user's role and issues a custom token.
 */
const tokenLogin = async (req, res) => {
  try {
    const { uid } = req.customUser; // This comes from your verifyToken middleware
    log(`Token login attempt for UID: ${uid}`);

    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User data not found.' });
    }
    
    const userData = userDoc.data();
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

module.exports = {
  register,
  login,
  tokenLogin,
};
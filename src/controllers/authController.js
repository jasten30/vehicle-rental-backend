// backend/src/controllers/authController.js
const admin = require('firebase-admin');
const { hashPassword, comparePasswords } = require('../utils/passwordUtil');

const log = (message) => {
  console.log(`[AuthController] ${message}`);
};

const register = async (req, res) => {
  try {
    const { email, password, role = 'renter', ...userData } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    log(`Attempting to register user: ${email} with role: ${role}`);

    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
    });

    // --- CRUCIAL FIX: Set the custom user claim on the Firebase token ---
    await admin.auth().setCustomUserClaims(userRecord.uid, { role: role });
    log(`Custom claim { role: '${role}' } set for user: ${userRecord.uid}`);

    const hashedPassword = await hashPassword(password);
    const userDocRef = admin.firestore().collection('users').doc(userRecord.uid);
    await userDocRef.set({
      uid: userRecord.uid,
      email: userRecord.email,
      role: role,
      passwordHash: hashedPassword,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...userData,
    });

    log(`User registered successfully: ${userRecord.uid} (${email}) with role ${role}`);
    res.status(201).json({ message: 'User registered successfully!', uid: userRecord.uid });
  } catch (error) {
    console.error('Error during registration:', error.code, error.message);
    let errorMessage = 'Server error during registration.';
    if (error.code === 'auth/email-already-exists') {
      errorMessage = 'The email address is already in use by another account.';
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
    const userDoc = await admin.firestore().collection('users').doc(userRecord.uid).get();
    if (!userDoc.exists) {
      log(`Firestore user document not found for UID: ${userRecord.uid}`);
      return res.status(404).json({ message: 'User data not found.' });
    }
    const userData = userDoc.data();
    const storedPasswordHash = userData.passwordHash;
    if (!storedPasswordHash) {
      log(`No password hash found in Firestore for UID: ${userRecord.uid}.`);
      return res.status(500).json({ message: 'Server configuration error: Password hash missing.' });
    }
    const passwordMatch = await comparePasswords(password, storedPasswordHash);
    log(`Password comparison result: ${passwordMatch}`);
    if (!passwordMatch) {
      log('Login failed: Invalid credentials (password mismatch).');
      return res.status(401).json({ message: 'Invalid credentials.' });
    }
    const customToken = await admin.auth().createCustomToken(userRecord.uid, { role: userData.role });
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
    if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-email' || error.code === 'auth/wrong-password') {
      errorMessage = 'Invalid credentials.';
    }
    res.status(500).json({ message: errorMessage, error: error.message });
  }
};

module.exports = {
  register,
  login,
};

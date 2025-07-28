// backend/src/controllers/authController.js
const admin = require('firebase-admin'); // Firebase Admin SDK
const { hashPassword, comparePasswords } = require('../utils/passwordUtil'); // Assuming this is correct now

// Helper for consistent logging
const log = (message) => {
  console.log(`[AuthController] ${message}`);
};

// --- User Registration (Example - if you have one) ---
const register = async (req, res) => {
  try {
    const { email, password, role = 'renter', ...userData } = req.body; // Default role to 'renter'

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    log(`Attempting to register user: ${email} with role: ${role}`);

    // 1. Create user in Firebase Authentication
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      // displayName: userData.displayName, // Optional
      // photoURL: userData.photoURL,     // Optional
    });

    // Hash the password for storage in Firestore
    const hashedPassword = await hashPassword(password);

    // 2. Store additional user data (including role) in Firestore
    const userDocRef = admin.firestore().collection('users').doc(userRecord.uid);
    await userDocRef.set({
      uid: userRecord.uid,
      email: userRecord.email,
      role: role, // Store the role
      passwordHash: hashedPassword,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...userData, // Spread any other provided user data
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


// --- User Login ---
const login = async (req, res) => {
  const { email, password } = req.body;

  // --- DEBUG LOGS ---
  log(`Login attempt for email: ${email}`);

  if (!email || !password) {
    log('Login failed: Email and password are required.');
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    // 1. Authenticate user with Firebase Authentication
    // Note: Firebase Admin SDK does not have a direct 'signInWithEmailAndPassword'
    // for security reasons. You typically verify credentials by:
    // a) Using Firebase Client SDK on frontend to get ID Token, then verify on backend.
    // b) For backend-only login (less common for user-facing apps), you might need
    //    to create a custom token or use a more complex flow.
    //
    // Assuming your frontend sends email/password and expects backend to verify:
    // We'll use admin.auth().getUserByEmail() and then compare password with Firestore's stored hash.
    // This is a common pattern if you're not using client-side Firebase Auth directly for login.

    const userRecord = await admin.auth().getUserByEmail(email);
    log(`Found user record for ${email}. UID: ${userRecord.uid}`);

    // 2. Retrieve user's stored password hash from Firestore (if you store it there)
    // IMPORTANT: If you are relying purely on Firebase Auth for password management,
    // you typically DO NOT store password hashes in Firestore.
    // If you are, ensure your registration process hashes and stores it.
    const userDoc = await admin.firestore().collection('users').doc(userRecord.uid).get();

    if (!userDoc.exists) {
      log(`Firestore user document not found for UID: ${userRecord.uid}`);
      return res.status(404).json({ message: 'User data not found.' });
    }

    const userData = userDoc.data();
    const storedPasswordHash = userData.passwordHash; // Assuming you store passwordHash

    if (!storedPasswordHash) {
      log(`No password hash found in Firestore for UID: ${userRecord.uid}.`);
      return res.status(500).json({ message: 'Server configuration error: Password hash missing.' });
    }

    // 3. Compare provided password with stored hash
    const passwordMatch = await comparePasswords(password, storedPasswordHash);
    log(`Password comparison result: ${passwordMatch}`);

    if (!passwordMatch) {
      log('Login failed: Invalid credentials (password mismatch).');
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    // 4. If password matches, create a custom Firebase token
    // This token can then be used by the frontend with Firebase Client SDK
    const customToken = await admin.auth().createCustomToken(userRecord.uid, { role: userData.role });
    log(`Custom token created for UID: ${userRecord.uid}`);

    // 5. Send token and basic user info back to frontend
    res.status(200).json({
      message: 'Login successful!',
      token: customToken,
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        role: userData.role,
        displayName: userData.displayName || null, // Include display name if available
      },
    });

  } catch (error) {
    console.error('Error during login:', error.code, error.message);
    let errorMessage = 'Server error during login.';
    if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-email' || error.code === 'auth/wrong-password') {
      errorMessage = 'Invalid credentials.'; // Generic message for security
    }
    res.status(500).json({ message: errorMessage, error: error.message });
  }
};

module.exports = {
  register,
  login,
};

const admin = require('firebase-admin');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(403).json({ message: 'No token provided or malformed token.' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userDocRef = admin.firestore().collection('users').doc(decodedToken.uid);
    let userDoc = await userDocRef.get();

    // If the user's profile doesn't exist in Firestore, create it.
    if (!userDoc.exists) {
      console.log('[AuthMiddleware] User document not found. Creating a new one...');
      
      const { email, phone_number } = decodedToken; // Get both fields
      
      const newUserProfile = {
        role: 'renter',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        emailVerified: decodedToken.email_verified || false,
      };

      // Only add email or phoneNumber if they exist in the token
      if (email) {
        newUserProfile.email = email;
      }
      if (phone_number) {
        newUserProfile.phoneNumber = phone_number;
      }

      // This is a critical safety check
      if (!email && !phone_number) {
        throw new Error('User token is missing both email and phone number.');
      }
      
      await userDocRef.set(newUserProfile);
      userDoc = await userDocRef.get(); // Re-fetch the newly created document
    }

    const userData = userDoc.data();
    req.customUser = {
      uid: decodedToken.uid,
      email: userData.email || decodedToken.email,
      role: userData.role || 'renter',
      phone_number: userData.phoneNumber || decodedToken.phone_number,
    };
    
    console.log(`[AuthMiddleware] User authenticated: ${req.customUser.uid}, Role: ${req.customUser.role}`);
    next();
  } catch (error) {
    console.error('[AuthMiddleware] Token verification failed:', error.message);
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }
    return res.status(500).json({ message: 'Failed to authenticate token.', error: error.message });
  }
};

const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (!req.customUser || !req.customUser.role) {
      return res.status(403).json({ message: 'Access denied. User role not found.' });
    }
    if (roles.includes(req.customUser.role)) {
      next();
    } else {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }
  };
};

module.exports = {
  verifyToken,
  authorizeRole,
};
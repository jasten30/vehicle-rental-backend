// backend/src/middleware/authMiddleware.js
const admin = require('firebase-admin');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log('[AuthMiddleware] Received Authorization Header:', authHeader ? authHeader.substring(0, 30) + '...' : 'None');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[AuthMiddleware] No Bearer token found or malformed header. Denying access.');
    return res.status(403).json({ message: 'No token provided or malformed token.' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    console.log('[AuthMiddleware] Token successfully verified. UID:', decodedToken.uid);
    console.log('[AuthMiddleware] Decoded Token Claims:', decodedToken); // Log all decoded claims

    req.customUser = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: 'renter', // Default, will be updated from Firestore
    };

    const userDoc = await admin.firestore().collection('users').doc(decodedToken.uid).get();
    if (userDoc.exists && userDoc.data().role) {
      req.customUser.role = userDoc.data().role;
      console.log(`[AuthMiddleware] User role from Firestore: ${req.customUser.role}`);
    } else {
      console.log('[AuthMiddleware] User document or role not found in Firestore. Defaulting to "renter".');
    }

    next();
  } catch (error) {
    // --- IMPORTANT: Log the full error object for debugging ---
    console.error('[AuthMiddleware] !!! DETAILED TOKEN VERIFICATION ERROR !!!');
    console.error('[AuthMiddleware] Error Code:', error.code);
    console.error('[AuthMiddleware] Error Message:', error.message);
    console.error('[AuthMiddleware] Full Error Object:', error);


    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    } else if (error.code === 'auth/argument-error' || error.code === 'auth/invalid-id-token') {
      return res.status(401).json({ message: 'Invalid token.' });
    }
    return res.status(500).json({ message: 'Failed to authenticate token.', error: error.message });
  }
};

const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (!req.customUser || !req.customUser.role) {
      console.log('[AuthMiddleware] Authorization failed: User not authenticated or role missing.');
      return res.status(403).json({ message: 'Access denied. User role not found.' });
    }

    if (roles.includes(req.customUser.role)) {
      console.log(`[AuthMiddleware] User role '${req.customUser.role}' authorized for route.`);
      next();
    } else {
      console.log(`[AuthMiddleware] Authorization failed: User role '${req.customUser.role}' not in allowed roles: ${roles.join(', ')}`);
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }
  };
};

module.exports = {
  verifyToken,
  authorizeRole,
};

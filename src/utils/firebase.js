// backend/src/utils/firebase.js
const admin = require('firebase-admin');

// Ensure you replace this with the path to your Firebase service account key JSON file
// This file should be kept secure and not committed to public repositories.
const serviceAccount = require('../config/serviceAccountKey.json'); // <-- UPDATE THIS PATH

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Get Firestore instance
const db = admin.firestore();

console.log('[Firebase Util] Firebase Admin SDK initialized.');
console.log('[Firebase Util] Firestore DB instance obtained.');

module.exports = {
  admin, // Export the admin SDK instance
  db     // Export the Firestore database instance
};

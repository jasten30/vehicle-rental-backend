const admin = require('firebase-admin');

// Ensure you replace this with the path to your Firebase service account key JSON file
const serviceAccount = require('../config/serviceAccountKey.json');

// --- THIS IS THE FIX ---
// The storageBucket URL from your Firebase project config is required here.
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "studied-jigsaw-463000-m8.firebasestorage.app" // Use the correct bucket name from your Firebase project settings
});

// Get Firestore and Storage instances
const db = admin.firestore();
const storageBucket = admin.storage().bucket(); // Initialize the storage bucket

console.log('[Firebase Util] Firebase Admin SDK initialized.');
console.log('[Firebase Util] Firestore DB instance obtained.');
console.log('[Firebase Util] Storage Bucket instance obtained.');

module.exports = {
  admin,
  db,
  storageBucket
};

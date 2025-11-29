const admin = require('firebase-admin');

// --- START OF REQUIRED FIX ---

// 1. Get the JSON content from the secure environment variable set on Railway.
// We expect the entire contents of the serviceAccountKey.json file to be
// stored as a single, long string in this environment variable.
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

if (!serviceAccountJson) {
    // If the variable is missing, log an error and halt deployment
    console.error("CRITICAL ERROR: FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set!");
    throw new Error("Missing Firebase service account key. Please set FIREBASE_SERVICE_ACCOUNT_KEY in Railway variables.");
}

// 2. Parse the JSON string back into a usable object.
const serviceAccount = JSON.parse(serviceAccountJson);

// --- END OF REQUIRED FIX ---

// The storageBucket URL from your Firebase project config is required here.
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // IMPORTANT: Ensure this bucket name is correct for your project
  storageBucket: "studied-jigsaw-463000-m8.firebasestorage.app"
});

// Get Firestore and Storage instances
const db = admin.firestore();
const storageBucket = admin.storage().bucket(); // Initialize the storage bucket

console.log('[Firebase Util] Firebase Admin SDK initialized successfully.');
console.log('[Firebase Util] Firestore DB instance obtained.');
console.log('[Firebase Util] Storage Bucket instance obtained.');

module.exports = {
  admin,
  db,
  storageBucket
};
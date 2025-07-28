// backend/generateCustomToken.js

require('dotenv').config(); // Load .env file for FIREBASE_PROJECT_ID
const admin = require('firebase-admin');

const serviceAccountJson = process.env.FIREBASE_ADMIN_SDK_KEY;
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;

let serviceAccount;

if (!serviceAccountJson) {
    console.error("DEBUG: FIREBASE_ADMIN_SDK_KEY environment variable is NOT set locally.");
    console.error("Please ensure you have a .env file with FIREBASE_ADMIN_SDK_KEY or set it in your environment.");
    process.exit(1);
}

try {
    serviceAccount = JSON.parse(serviceAccountJson);
    console.log("DEBUG: Successfully parsed service account JSON.");
} catch (e) {
    console.error("DEBUG: ERROR: Failed to parse FIREBASE_ADMIN_SDK_KEY JSON locally.");
    console.error("Parsing error:", e.message);
    process.exit(1);
}

if (!firebaseProjectId) {
    console.error("DEBUG: ERROR: FIREBASE_PROJECT_ID environment variable is NOT set locally.");
    console.error("Please add FIREBASE_PROJECT_ID=your-project-id to your .env file.");
    process.exit(1);
}

if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
        console.log("DEBUG: Firebase Admin SDK initialized successfully for custom token generation.");
    } catch (e) {
        console.error("DEBUG: CRITICAL ERROR: Failed to initialize Firebase Admin SDK for custom token generation.");
        console.error("Initialization error:", e.message);
        console.error("Ensure your service account key is valid and your project ID is correct in .env.");
        process.exit(1);
    }
}

// --- CRITICAL CHANGE HERE: ADD .trim() ---
let ownerTestUserUid = 'AT46JsG1LqUXTu7XWy2YMVvHNAr1'; // YOUR_OWNER_TEST_USER_UID_HERE (now directly using your pasted value)
ownerTestUserUid = ownerTestUserUid.trim(); // Remove any leading/trailing whitespace

// --- Refined check and logging ---
if (!ownerTestUserUid || ownerTestUserUid === 'YOUR_OWNER_TEST_USER_UID_HERE') { // Check for empty or still placeholder
    console.error(`DEBUG: ERROR: ownerTestUserUid is not correctly set. Current value: '${ownerTestUserUid}'`);
    console.error("Please replace 'YOUR_OWNER_TEST_USER_UID_HERE' with your actual user UID, ensuring no extra spaces.");
    process.exit(1);
} else {
    console.log("DEBUG: Attempting to create custom token for UID:", ownerTestUserUid);
}


admin.auth().createCustomToken(ownerTestUserUid)
    .then((customToken) => {
        console.log('Successfully created custom token:');
        console.log(customToken);
        console.log(`\nconst customTokenToPaste = '${customToken}';`);
        console.log('\n--- IMPORTANT ---');
        console.log('Copy the token ABOVE (or the "customTokenToPaste" line) and paste it into getToken.html.');
        console.log('-----------------');
        process.exit(0);
    })
    .catch((error) => {
        console.error('DEBUG: Error creating custom token:', error);
        process.exit(1);
    });

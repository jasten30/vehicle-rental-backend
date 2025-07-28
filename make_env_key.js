        // backend/make_env_key.js
        const fs = require('fs');
        // --- IMPORTANT: UPDATE THIS PATH TO YOUR ACTUAL DOWNLOADED KEY FILE ---
        const keyPath = 'C:\\Users\\Ian justine\\Downloads\\studied-jigsaw-463000-m8-firebase-adminsdk-fbsvc-1546549442.json'; // Ensure .json extension if it's missing from your copy/paste

        try {
            const keyContent = fs.readFileSync(keyPath, 'utf8');
            const parsedKey = JSON.parse(keyContent);

            // This will ensure the whole JSON is stringified onto one line.
            // JSON.stringify handles the \n characters correctly within string values.
            const singleLineJson = JSON.stringify(parsedKey);

            console.log("Copy this entire line into your .env file as FIREBASE_ADMIN_SDK_KEY='...'");
            console.log(`FIREBASE_ADMIN_SDK_KEY='${singleLineJson}'`);
        } catch (error) {
            console.error("Error processing key:");
            console.error(error); // Log the full error object for more detail
            process.exit(1);
        }
        
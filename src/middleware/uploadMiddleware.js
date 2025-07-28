// src/middleware/uploadMiddleware.js

const multer = require('multer');
const path = require('path');

// Configure multer for file storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Store images in the 'uploads' directory
    },
    filename: (req, file, cb) => {
        // Generate a unique filename (e.g., vehicle_123_timestamps.jpg)
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname);

        let prefix = file.fieldname;
        if (req.params && req.params.id) { // If it's an update, include vehicles ID
            prefix += '-' + req.params.id;
        } else if (req.user && req.user.id) { // For create, perhaps use owner ID or just a generic prefix
            prefix += '-' + req.user.id; // Using owner ID for newly created vehicle images
        } 

        // If neither, just use the fieldname or a generic "vehicle"
        if (prefix === file.fieldname) { // If no specific ID is available (e.g., firs upload)
            prefix = 'vehicle';
        }

        cb(null, file.filename + '-' + req.params.id + '-' + uniqueSuffix + fileExtension); // file.filename will be 'image'
    }
});

// File filter (optional, but good)
const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif']; // Allowed image types
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true); // Accept the file
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, and GIF are allowed.'), false); // Reject the file
    }
};

const upload = multer ({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // Limit file size to 5mb
    }
});

module.exports = upload;
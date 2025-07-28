// backend/src/config/db.config.js

const mysql = require('mysql2/promise'); // Ensure you're using the promise-based version

let pool; // Declare pool outside to be accessible

async function connectDB() {
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        // Test the connection
        await pool.getConnection();
        console.log('MySQL Database connected successfully!');
    } catch (error) {
        // IMPORTANT: Log the error but DO NOT re-throw or exit the process.
        // This allows the server to start even if the DB connection fails (e.g., on Cloud Run without Cloud SQL)
        console.error('Error connecting to MySQL Database:', error.message);
        // You might want to set a flag here, e.g., isDbConnected = false;
        // Or if you want a more robust solution for DB dependent routes:
        // Consider returning the error or throwing it if a specific route requires a DB connection,
        // but for app startup, just logging is fine.
    }
}

// Function to get the database connection pool
function getDBConnection() {
    if (!pool) {
        // If pool is not initialized, try to connect again or throw an error indicating DB is not ready.
        // For Cloud Run, this means the initial connectDB() failed.
        // Returning null or throwing an error here will propagate to routes.
        console.warn('Database pool not initialized. Attempting to connect or returning null.');
        // You might want to call connectDB() again here, but it could lead to multiple calls
        // if not carefully handled with a connection status flag.
        // For simplicity, let's just log and return null for now,
        // allowing routes that use it to handle the null.
        return null; // Or throw new Error('Database not connected');
    }
    return pool;
}

module.exports = {
    connectDB,
    getDBConnection
};

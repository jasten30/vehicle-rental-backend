// src/services/authService.js

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDBConnection } = require('../config/db.config'); // Get the database connection pool

const saltRounds = 10; // How many times to hash the password (higher = more secure, slower)
const jwtSecret = process.env.JWT_SECRET; // Get JWT secret from .env
const jwtExpiresIn = process.env.JWT_EXPIRES_IN; // Get JWT expiry from .env

exports.registerUser = async ({ first_name, last_name, email, password, phone_number }) => {
    const pool = getDBConnection();
    let connection; // Declare connection outside try to ensure it's accessible in finally block

    try {
        // Hash the password
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Get a connection from the pool
        connection = await pool.getConnection();

        // Insert user into the database
        const [result] = await connection.execute(
            `INSERT INTO Users (first_name, last_name, email, password_hash, phone_number, role)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [first_name, last_name, email, passwordHash, phone_number, 'customer']
        );

        // Return some relevant data or the insert result
        return {
            insertId: result.insertId, // The ID of the newly created user
            email: email,
            first_name: first_name
        };
    } catch (error) {
        console.error('Error in AuthService.registerUser:', error);
        throw error; // Re-throw to be caught by the controller
    } finally {
        if (connection) {
            connection.release(); // Release the connection back to the pool
        }
    }
};

exports.loginUser = async ({ email, password }) => {
    const pool = getDBConnection();
    let connection;

    try {
        connection = await pool.getConnection();

        // 1. Find user by email
        const [rows] = await connection.execute(
            `SELECT user_id, email, password_hash, first_name, last_name, role FROM Users WHERE email = ?`,
            [email]
        );

        const user = rows[0]; // Get the first (and hopefully only) row

        if (!user) {
            // User not found
            throw new Error('Invalid credentials'); // Use generic message for security
        }
        
        // 2. Compare provided password with hashed password
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            // Password do not match
            throw new Error('Invalid credentials'); // Use generic message for security
        }

        // 3. Generate JWT
        // Payload for the token (should contain non-sensitive, indentifying info)
        const payload = {
            id: user.user_id,
            email: user.email,
            role: user.role
        };

        const token = jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn });

        // Return user data (without password hash) and the token
        return {
            user: {
                user_id: user.user_id,
                first_name: user.first_name,
                last_name: user.last_name,
                email: user.email,
                role: user.role
            },
            token: token
        };
    } catch (error) {
        console.error('Error in authService.loginUser', error);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Get User by ID
exports.getUserById = async (userId) => {
    const pool = getDBConnection();
    let connection;

    try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute(
            `SELECT user_id, first_name, last_name, email, phone_number,
                    address_street, address_city, address_province, address_zip_code,
                    driving_license_number, id_proof_url, role, is_active, created_at
             FROM Users WHERE user_id = ?`,
             [userId]
        );
        return rows[0]; // Return the first user found (or undefined)
    } catch (error) {
        console.error('Error in authService.getUserById:', error);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Update User Profile
exports.updateUserProfile = async (userId, userData) => {
    const pool = getDBConnection();
    let connection;

    try {
        connection = await pool.getConnection();
        let query = 'UPDATE Users SET ';
        const queryParams = [];
        const updates = [];

        // Dynamically build the update query based on provided userData
        for (const key in userData) {
            // Prevent updating sensitive fields directly or with empty values
            if (['password_hash', 'user_id', 'email', 'role', 'created_at', 'updated_at', 'new_password'].includes(key)) {
                // Skip these fields or handle them specially (like email and password)
                continue;
            }
            if (userData[key] !== undefined) { // Only update if value is provided
                updates.push(`${key} = ?`);
                queryParams.push(userData[key]);
            }
        }

        // Handle password update separately (if new password is provided)
        if (userData.new_password) {
            const newPasswordHash = await bcrypt.hash(userData.new_password, saltRounds);
            updates.push('password_hash = ?');
            queryParams.push(newPasswordHash);
        }

        if (updates.length === 0) {
            // No valid fields to update
            return { message: 'No valid fields provided for update. '};
        }

        query += updates.join(', ') + ' WHERE user_id = ?';
        queryParams.push(userId);

        const [result] = await connection.execute(query, queryParams);

        if (result.affectedRows === 0) {
            throw new Error('User not found or no changes made.');
        }

        // Optionally, fetch and return the updated user details (excluding password hash)
        const updatedUser = await this.getUserById(userId);
        return updatedUser;
    } catch (error) {
        console.error('Error in authService.updatedUserProfile:', error);
    } finally {
        if (connection) {
            connection.release();
        }
    }
};
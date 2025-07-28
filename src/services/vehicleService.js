// src/services/vehicleService.js

const { getDBConnection } = require('../config/db.config');

// Helper to sanitize vehicle data for output
const sanitizeVehicle = (vehicle) => {
    if (!vehicle) return null;
    const { owner_id, created_at, updated_at, ...sanitized } = vehicle;
    return { ...sanitized, ownerId: owner_id, createdAt: created_at, updatedAt: updated_at };
};

// Get all vehicles
exports.getAllVehicles = async (filters = {}) => {
    const pool = getDBConnection();
    let connection;
    
    try {
        connection = await pool.getConnection();

        // Start with a base query for available/rented vehicles (public view)
        let sql = `SELECT v.*, u.first_name AS owner_first_name, u.last_name AS owner_last_name
                   FROM Vehicles v JOIN Users u ON v.owner_id = u.user_id
                   WHERE v.status IN ('available', 'rented')`;

        const queryParams = [];

        // Dynamically build the WHERE clause based on filters
        if (filters.make) {
            sql += ` AND v.make LIKE ?`;
            queryParams.push(`%${filters.make}%`); // Case-insensitive search
        }
        if (filters.model) {
            sql += ` AND v.model LIKE ?`;
            queryParams.push(`%${filters.model}%`); // Case-insensitive search
        }
        if (filters.minDailyRate) {
            sql += ` AND v.daily_rate >= ?`;
            queryParams.push(filters.minDailyRate);
        }
        if (filters.maxDailyRate) {
            sql += ` AND v.daily_rate <= ?`;
            queryParams.push(filters.maxDailyRate);
        }
        if (filters.minYear) {
            sql += ` AND v.year >= ?`;
            queryParams.push(filters.minYear);
        }
        if (filters.maxYear) {
            sql += ` AND v.year <= ?`;
            queryParams.push(filters.maxYear);
        }
        if (filters.color) {
            sql += ` AND v.color LIKE ?`;
            queryParams.push(`%${filters.color}%`);
        }
        if (filters.location_city) {
            sql += ` AND v.location_city LIKE ?`;
            queryParams.push(`%${filters.location_city}%`); // Search city
        }
        if (filters.location_province) {
            sql += ` AND v.location_province LIKE ?`;
            queryParams.push(`%${filters.location_province}%`); // Search province
        }

        // Add ordering (optional but good for search results)
        sql += ` ORDER BY v.created_at DESC`;

        const [rows] = await connection.execute(sql, queryParams);
        return rows.map(sanitizeVehicle);
    } catch (error) {
        console.error('Error in vehicleService.getAllVehicles (filtered):', error);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Get Vehicle by ID
exports.getVehicleById = async (vehicleId) => {
    const pool = getDBConnection();
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute(
            `SELECT v.*, u.first_name AS owner_first_name, u.last_name AS owner_last_name
             FROM Vehicles v JOIN Users u ON v.owner_id = u.user_id
             WHERE v.vehicle_id = ?`,
             [vehicleId]
        );
        return sanitizeVehicle(rows[0]);
    } catch (error) {
        console.error('Error in vehicleService.getVehicleById:', error);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Create vehicle
exports.createVehicle = async (vehicleData) => {
    const pool = getDBConnection();
    let connection;
    try {
        connection = await pool.getConnection();
        const {
            owner_id, make, model, year, license_plate, daily_rate,
            hourly_rate, color, status, location_lat, location_lng,
            location_city, location_province, description, image_url
        } = vehicleData;

        // Basic validation 
        if (!owner_id || !make || !model || !year || !license_plate || !daily_rate) {
            throw new Error('Missing required vehicle fields');
        }

        const [result] = await connection.execute(
            `INSERT INTO Vehicles (owner_id, make, model, year, license_plate, daily_rate,
                                   hourly_rate, color, status, location_lat, location_lng,
                                   location_city, location_province, description, image_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
             [owner_id, make, model, year, license_plate, daily_rate,
             hourly_rate || null, color || null, status || 'available',
             location_lat || null, location_lng || null,
             location_city || null, location_province || null,
             description || null, image_url || null]
        );
        return { vehicle_id: result.insertId, ...vehicleData };
    } catch (error) {
        console.error('Error in vehicleService.createVehicle:', error);
        if (error.message.includes('Duplicate entry') && error.message.includes('license_plate')) {
            throw new Error('Vehicle with this license plate already exists.');
        }
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

exports.updateVehicle = async (vehicleId, updateData) => {
    const pool = getDBConnection();
    let connection;
    try {
        connection = await pool.getConnection();
        let query = 'UPDATE Vehicles SET ';
        const queryParams = [];
        const updates = [];

        // Exclude primary key and timestamps from direct update
        const excludedFields = ['vehicle_id', 'owner_id', 'created_at', 'updated_at'];

        for (const key in updateData) {
            if (updateData[key] !== undefined && !excludedFields.includes(key)) {
                updates.push(`${key} = ?`);
                queryParams.push(updateData[key]);
            }
        }

        if (updates.length === 0) {
            return { message: 'No valid fields provided for update.' };
        }

        query += updates.join(', ') + ' WHERE vehicle_id = ?';
        queryParams.push(vehicleId);

        const [result] = await connection.execute(query, queryParams);

        if (result.affectedRows === 0) {
            throw new Error('Vehicle not found or no changes made.');
        }

        // Fetch and return the update vehicle details
        const updateVehicle = await this.getVehicleById(vehicleId);
        return updateData;
    } catch (error) {
        console.error('Error in vehicleService.updateVehicle:', error);
        if (error.message.includes('Duplicate entry') && error.message.includes('license_plate')) {
            throw new Error('Vehicle with this license plate already exists.');
        }
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Delete Vehicle
exports.deleteVehicle = async (vehicleId) => {
    const pool = getDBConnection();
    let connection;
    try {
        connection = await pool.getConnection();
        const [result] = await connection.execute(
            `DELETE FROM Vehicles WHERE vehicle_id = ?`,
            [vehicleId]
        );
        if (result.affectedRows === 0) {
            throw new Error('Vehicle not found.');
        }
        return { message: 'Vehicle deleted successfully.'};
    } catch (error) {
        console.error('Error in vehicleService.deleteVehicle', error);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};
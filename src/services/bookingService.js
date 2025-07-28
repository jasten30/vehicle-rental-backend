// src/services/bookingService.js

const { parse } = require('dotenv');
const { getDBConnection } = require('../config/db.config');
const vehicleService = require('./vehicleService');
const paymentService = require('./paymentService');

exports.checkVehicleAvailability = async (vehicleId, startDate, endDate) => {
    const pool = getDBConnection();
        let connection;

        try {
            connection = await pool.getConnection();

            // 1. Basic validation for dates
            const queryStartDate = new Date(startDate);
            const queryEndDate = new Date(endDate);


            if (isNaN(queryStartDate) || isNaN(queryEndDate) || queryStartDate >= queryEndDate) {
                throw new Error('Invalid date range. Start date must be before end date.');
            }

            // Convert dates to MySQL DATETIME format (YYYY-MM-DD HH:MM:SS)
            const mysqlStartDate = queryStartDate.toISOString().slice(0, 19).replace('T', ' ');
            const mysqlEndDate = queryEndDate.toISOString().slice(0, 19).replace('T', ' ');

            // 2. Check for overlapping confirmed or pending bookings
            // A vehicle is unavailable if any existing booking (confirmed or pending)
            // overlaps with the requested startDate and EndDate.
            // overlaps condition: (Start A < End B) AND (EndA > StartB)
            const [rows] = await connection.execute(
                 `SELECT booking_id
                  FROM Bookings
                  WHERE vehicle_id = ?
                  AND booking_status IN ('pending', 'confirmed')
                  AND (
                    (start_date < ?) AND (end_date > ?) -- Existing booking starts before requested end and ends after requested start
                )`,
                [vehicleId, mysqlEndDate, mysqlStartDate]
        );

        // If rows.length > 0, it means there's at least one overlapping booking
        return rows.length === 0; // true if available, false if unavailable
    } catch (error) {
        console.error('Error in bookingService.checkVehicleAvailability:', error);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// --- createBooking function ---
exports.createBooking = async (bookingData) => {
    const pool = getDBConnection();
    let connection;
    try {
        connection = await pool.getConnection();

        const { vehicle_id, user_id, start_date, end_date, payment_method_type } = bookingData;
        const currency = 'PHP';
        const successRedirectUrl = process.env.FRONTEND_URL + '/payment-success';
        const failureRedirectUrl = process.env.FRONTEND_URL + '/payment-failure';

        console.log('Debug: Received bookingData:', bookingData);

        // 1. Validate inputs
        if (!vehicle_id || !user_id || !start_date || !end_date || !payment_method_type) {
            throw new Error('Missing required booking fields: vehicle_id, user_id, start_date, end_date, payment_method_type.');
        }

        const parsedStartDate = new Date(start_date);
        const parsedEndDate = new Date(end_date);

        console.log('Debug: parsedStartDate:', parsedStartDate);
        console.log('Debug: parsedEndDate:', parsedEndDate);

        if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime()) || parsedStartDate >= parsedEndDate) {
            throw new Error('Invalid date range for booking. Start date must be before end date.');
        }
        if (parsedStartDate < new Date()) { // Prevent booking in the past
            throw new Error('Start date cannot be in the past.');
        }

        // 2. Check vehicle availability (race condition prevention)
        const isAvailable = await exports.checkVehicleAvailability(vehicle_id, start_date, end_date);
        if (!isAvailable) {
            throw new Error('Vehicle is not available for the selected dates.');
        }

        // 3. Get vehicle details for pricing
        const vehicle = await vehicleService.getVehicleById(vehicle_id);
        if (!vehicle) {
            throw new Error('Vehicle not found.');
        }
        if (!vehicle.daily_rate && !vehicle.hourly_rate) {
            throw new Error('Vehicle has no daily or hourly rate defined for booking calculation.');
        }

        // 4. Calculate total cost (simplified to daily rate, rounded up)
        const durationMs = parsedEndDate.getTime() - parsedStartDate.getTime();
        const durationDaysFloat = durationMs / (1000 * 60 * 60 * 24);

        let total_cost;
        if (vehicle.daily_rate) {
            total_cost = Math.ceil(durationDaysFloat) * parseFloat(vehicle.daily_rate);
        } else if (vehicle.hourly_rate) {
            const durationHoursFloat = durationMs / (1000 * 60 * 60);
            total_cost = Math.ceil(durationHoursFloat) * parseFloat(vehicle.hourly_rate);
        } else {
            throw new Error('Could not calculate booking cost: vehicle rates missing.');
        }

        console.log(`Debug: Values before transaction: parsedStartDate=${parsedStartDate}, parsedEndDate=${parsedEndDate}, total_cost=${total_cost}`);

        await connection.beginTransaction();

        let paymentIntentId = null;
        let paymentRedirectUrl = null;

        try {
            // 5. Create the booking record in your DB first (status 'pending')
            const mysqlStartDate = parsedStartDate.toISOString().slice(0, 19).replace('T', ' ');
            const mysqlEndDate = parsedEndDate.toISOString().slice(0, 19).replace('T', ' ');

            const [result] = await connection.execute(
                `INSERT INTO Bookings (vehicle_id, user_id, start_date, end_date, total_cost, booking_status, payment_status)
                 VALUES (?, ?, ?, ?, ?, 'pending', 'pending')`,
                [vehicle_id, user_id, mysqlStartDate, mysqlEndDate, total_cost]
            );

            const booking_id = result.insertId;

            // 6. Initiate Payment Intent with Paymongo
            const paymentIntent = await paymentService.createPaymentIntent(
                total_cost,
                currency,
                `RentCycle Booking for Vehicle ${vehicle.make} ${vehicle.model} (ID: ${vehicle_id})`,
                payment_method_type,
                { success: successRedirectUrl, failure: failureRedirectUrl },
                { booking_id: String(booking_id), user_id: String(user_id) }
            );

            // Access paymentIntent data safely using optional chaining
            paymentIntentId = paymentIntent.data?.id || null; // Use null as default if undefined
            paymentRedirectUrl = paymentIntent.data?.attributes?.next_action?.redirect?.url || null;

            console.log(`Debug: Extracted paymentIntentId: ${paymentIntentId}`);
            console.log(`Debug: Extracted paymentRedirectUrl: ${paymentRedirectUrl}`);

            if (!paymentRedirectUrl && payment_method_type !== 'card') {
                console.warn(`No redirect URL found for ${payment_method_type} payment intent (ID: ${paymentIntentId}). This is common for initial intent creation or if payment requires explicit client-side confirmation/attachment.`);
            }

            // 7. Update the booking record with the payment_intent_id and status
            await connection.execute(
                `UPDATE Bookings
                 SET payment_intent_id = ?, payment_status = ?
                 WHERE booking_id = ?`,
                [paymentIntentId, 'awaiting_payment', booking_id] // Set payment_status to 'awaiting_payment'
            );

            await connection.commit();

            return {
                booking_id: booking_id,
                vehicle_id,
                user_id,
                start_date: mysqlStartDate,
                end_date: mysqlEndDate,
                total_cost: total_cost.toFixed(2),
                booking_status: 'pending', // Booking is pending until payment is confirmed via webhook
                payment_status: 'awaiting_payment', // Specific to payment intent created
                payment_intent_id: paymentIntentId,
                payment_redirect_url: paymentRedirectUrl
            };

        } catch (paymentError) {
            await connection.rollback();
            console.error('Error during Paymongo Payment Intent creation or booking update, rolling back:', paymentError);
            throw paymentError;
        }

    } catch (error) {
        console.error('Error in bookingService.createBooking:', error);
        throw error;
    } finally {
        if (connection) connection.release();
    }
};

// ---- getBookingByUserId ---
exports.getBookingsByUserId = async (userId) =>  {
    const pool = getDBConnection();
    let connection;

    try {
        connection = await pool.getConnection();

        const [rows] = await connection.execute(
            `SELECT *
            FROM Bookings
            WHERE user_id = ?`,
            [userId]
        );

        return rows; // Return an array of booking objects
    } catch (error) {
        console.error('Error in bookingService.getBookingsByUserId', error);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// --- cancelBooking function ----
exports.cancelBooking = async (bookingId, userId) => {
    const pool = getDBConnection();
    let connection; // Declare connection outside try to ensure it's in scope for finally
    try {
        console.log("--- Inside bookingService.cancelBooking ---");
        console.log(`Attempting to get DB connection for bookingId: ${bookingId}, userId: ${userId}`);

        // --- IMPORTANT: Ensure pool exists before attempting to get a connection ---
        if (!pool) {
            console.error("CRITICAL ERROR: Database pool is not initialized. Please ensure connectDB() was called correctly on server startup.");
            throw new Error("Database system error: Pool not initialized.");
        }

        connection = await pool.getConnection(); // Attempt to get connection
        console.log("DB connection obtained successfully.");
        console.log("Type of connection.release:", typeof connection.release); // Should be 'function'

        // 1. Fetch the booking to check cancellation rules
        let rows; // Declare rows here to ensure it's always declared, even if execute throws
        try {
            [rows] = await connection.execute(
                `SELECT start_date, booking_status
                 FROM Bookings
                 WHERE booking_id = ? AND user_id = ?`,
                [bookingId, userId]
            );
            console.log("SQL query for fetching booking executed. Rows fetched:", rows); // Log the result
            console.log("Rows length:", rows ? rows.length : 'null/undefined');
        } catch (sqlFetchError) {
            console.error('SQL execution error when fetching booking for cancellation:', sqlFetchError);
            throw new Error(`Database query failed when finding booking: ${sqlFetchError.message}`);
        }

        if (!rows || rows.length === 0) {
            console.log("Booking not found or not authorized. Rows array was empty or null.");
            throw new Error('Booking not found or you are not authorized to cancel it.');
        }

        // Add check if booking is already cancelled or completed
        if (rows[0].booking_status === 'cancelled' || rows[0].booking_status === 'completed') {
            console.log(`Booking ${bookingId} is already ${rows[0].booking_status}.`);
            throw new Error(`Booking is already ${rows[0].booking_status} and cannot be cancelled.`);
        }

        const bookingStartDate = new Date(rows[0].start_date);
        const now = new Date();

        // Cancellation rule: Cannot cancel within 24 hours of the start date
        const timeDifferenceHours = (bookingStartDate.getTime() - now.getTime()) / (1000 * 60 * 60);
        console.log(`Time difference to start date for booking ${bookingId}: ${timeDifferenceHours} hours.`);

        if (timeDifferenceHours <= 24) {
            console.log("Cancellation denied: Within 24 hours of start date.");
            throw new Error('Bookings cannot be cancelled within 24 hours of the start date.');
        }

        // 2. Update the booking status to 'cancelled'
        let result;
        try {
            [result] = await connection.execute(
                `UPDATE Bookings
                 SET booking_status = 'cancelled'
                 WHERE booking_id = ? AND user_id = ?`,
                [bookingId, userId]
            );
            console.log("SQL query for updating booking executed. Result:", result);
        } catch (sqlUpdateError) {
            console.error('SQL execution error when updating booking status:', sqlUpdateError);
            throw new Error(`Database query failed when updating booking: ${sqlUpdateError.message}`);
        }

        if (result.affectedRows === 0) {
            console.log("Failed to update booking status, 0 affected rows.");
            throw new Error('Failed to cancel booking. It may have already been cancelled or completed concurrently.');
        }

        console.log(`Booking ${bookingId} successfully cancelled.`);
        return { message: 'Booking cancelled successfully.' };

    } catch (error) {
        console.error('Final Error Caught in bookingService.cancelBooking:', error);
        throw error; // Re-throw the specific error message
    } finally {
        // This 'finally' block is where 'connection.release' is often called, and where it fails if connection is bad.
        if (connection && typeof connection.release === 'function') {
            console.log("Releasing DB connection in finally block.");
            connection.release();
        } else if (connection) {
            console.error("Connection object exists but does not have a 'release' method in finally block. This indicates an issue with the connection object itself.");
        } else {
            console.log("No DB connection to release in finally block (was not obtained).");
        }
        console.log("--- Exiting bookingService.cancelBooking ---");
    }
};

// --- getOwnerVehicleBookings ---
exports.getOwnerVehicleBookings = async (ownerId) => {
    const pool = getDBConnection();
    let connection;

    try {
        connection = await pool.getConnection();
            // SQL query to join Bookings with Vehicles and filter by owner_id
        const [rows] = await connection.execute(
            `SELECT
                b.booking_id,
                b.vehicle_id,
                b.user_id,
                b.start_date,
                b.end_date,
                b.total_cost,
                b.booking_status,
                b.payment_status,
                b.created_at,
                b.updated_at,
                v.make AS vehicle_make,
                v.model AS vehicle_model,
                v.year AS vehicle_year,
                v.daily_rate,
                v.hourly_rate
             FROM
                Bookings b
             JOIN
                Vehicles v ON b.vehicle_id = v.vehicle_id
             WHERE
                v.owner_id = ?
             ORDER BY b.start_date DESC`, // Order by start date, newest first
            [ownerId]
        );

        return rows; // Returns an array of booking objects for the owner's vehicles
    } catch (error) {
        console.error('Error in bookingService.getOwnerVehicleBookings:', error);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};
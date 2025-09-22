const express = require('express');
const cors = require('cors');
// The 'body-parser' library is no longer needed
// const bodyParser = require('body-parser');

// Import route modules
const authRoutes = require('./routes/authRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const userRoutes = require('./routes/userRoutes');
const chatRoutes = require('./routes/chatRoutes');
const adminRoutes = require('./routes/adminRoutes'); // Assuming you have this from previous steps

const app = express();
const PORT = process.env.PORT || 5001; 

// Middleware
app.use(cors()); // Enable CORS for all origins

// --- THIS IS THE FIX ---
// Use the modern, built-in Express middleware for parsing JSON.
// This replaces the deprecated 'body-parser'.
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Route Middlewares
app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/admin', adminRoutes); // Assuming you have this from previous steps

// Basic route for testing
app.get('/', (req, res) => {
  res.send('RentCycle Backend API is running!');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

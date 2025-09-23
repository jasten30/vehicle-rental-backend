const express = require('express');
const cors = require('cors');

// Import route modules
const authRoutes = require('./routes/authRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const userRoutes = require('./routes/userRoutes');
const chatRoutes = require('./routes/chatRoutes');
const adminRoutes = require('./routes/adminRoutes');
const reviewsRoutes = require('./routes/reviewsRoutes');

const app = express();
const PORT = process.env.PORT || 5001;

// --- START: NEW DEBUGGING MIDDLEWARE ---
// This will run for EVERY request that comes into your server.
// It will help us see if the frontend is communicating with the backend at all.
app.use((req, res, next) => {
  console.log(`[Request Logger] Method: ${req.method}, URL: ${req.originalUrl}, Time: ${new Date().toISOString()}`);
  next(); // Pass control to the next middleware
});
// --- END: NEW DEBUGGING MIDDLEWARE ---


app.use(cors({
  origin: ['http://localhost:8080', 'http://localhost:5000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));


app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Route Middlewares
app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reviews', reviewsRoutes);

// Basic route for testing
app.get('/', (req, res) => {
  res.send('RentCycle Backend API is running!');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


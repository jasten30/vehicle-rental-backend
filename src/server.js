const express = require('express');
const cors = require('cors');

// 👇 ADDED IMPORTS
const cron = require('node-cron');
// Make sure these paths are correct relative to server.js in your 'src' folder
const { admin, db } = require('./utils/firebase');
const { createNotification } = require('./utils/notificationHelper');

// Import route modules
const authRoutes = require('./routes/authRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const userRoutes = require('./routes/userRoutes');
const chatRoutes = require('./routes/chatRoutes');
const adminRoutes = require('./routes/adminRoutes');
const reviewsRoutes = require('./routes/reviewsRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const app = express();
const PORT = process.env.PORT || 5001;

// Request Logger Middleware
app.use((req, res, next) => {
  console.log(`[Request Logger] Method: ${req.method}, URL: ${req.originalUrl}, Time: ${new Date().toISOString()}`);
  next();
});

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
app.use('/api/notifications', notificationRoutes);

// Basic route for testing
app.get('/', (req, res) => {
  res.send('RentCycle Backend API is running!');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// --- 👇 ADDED CRON JOB FOR BOOKING REMINDERS ---
console.log("Setting up hourly cron job for booking reminders (runs at 0 minutes past the hour).");
// This cron string '0 * * * *' means "at minute 0 of every hour"
cron.schedule('0 * * * *', async () => {
  console.log('--- Cron Job: Running sendBookingReminders ---');
  try {
    const now = admin.firestore.Timestamp.now();
    
    // Find bookings with a startDate between 24 and 25 hours from now
    const reminderStart = admin.firestore.Timestamp.fromMillis(now.toMillis() + (24 * 60 * 60 * 1000));
    const reminderEnd = admin.firestore.Timestamp.fromMillis(now.toMillis() + (25 * 60 * 60 * 1000)); // 1-hour window

    const bookingsRef = db.collection('bookings');
    
    // Query for bookings that are confirmed, not yet reminded, and in the window
    const snapshot = await bookingsRef
      .where('paymentStatus', '==', 'confirmed')
      .where('isReminderSent', '==', false)
      .where('startDate', '>=', reminderStart)
      .where('startDate', '<', reminderEnd)
      .get();

    if (snapshot.empty) {
      console.log('Cron Job: No upcoming bookings found needing reminders.');
      return;
    }

    const reminderPromises = [];
    snapshot.forEach(doc => {
      const booking = doc.data();
      const bookingId = doc.id;
      
      console.log(`Cron Job: Sending reminder for booking ${bookingId}`);

      // 1. Notify Renter
      reminderPromises.push(
        createNotification(
          booking.renterId,
          `Reminder: Your booking (#${bookingId.substring(0,5)}) is in 24 hours.`,
          `/booking/${bookingId}`
        )
      );
      
      // 2. Notify Owner
      reminderPromises.push(
        createNotification(
          booking.ownerId,
          `Reminder: Your vehicle is scheduled for pickup in 24 hours (Booking #${bookingId.substring(0,5)}).`,
          `/booking/${bookingId}`
        )
      );

      // 3. Mark as sent
      reminderPromises.push(
        doc.ref.update({ isReminderSent: true })
      );
    });

    await Promise.all(reminderPromises);
    console.log(`Cron Job: Sent ${snapshot.size} booking reminders.`);

  } catch (error) {
    // This query *will fail* if you haven't created the Firestore index.
    if (error.code === 9) { // FAILED_PRECONDITION
       console.error('Cron Job Error: Firestore composite index is missing for this query. Please create it in the Firebase console.');
       console.error('The index required is on collection `bookings`: `paymentStatus` (ASC), `isReminderSent` (ASC), `startDate` (ASC)');
    } else {
       console.error('Cron Job: Error sending booking reminders:', error);
    }
  }
});



app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

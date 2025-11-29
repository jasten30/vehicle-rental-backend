// backend/src/server.js

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

// --- 1. IMPORT YOUR ROUTE FILES ---
const authRoutes = require("./routes/authRoutes");
const vehicleRoutes = require("./routes/vehicleRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const userRoutes = require("./routes/userRoutes");
const adminRoutes = require("./routes/adminRoutes");
const chatRoutes = require("./routes/chatRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const webhookRoutes = require("./routes/webhookRoutes");

// *Note: In your screenshot, this file is named 'reviewsRoutes.js' (plural)*
const reviewsRoutes = require("./routes/reviewsRoutes");
// ----------------------------------

const app = express();
const PORT = process.env.PORT || 5001;

// --- 2. CONFIGURE CORS (Security) ---
app.use(cors({
  origin: [
    "http://localhost:8080",       // Local Vue
    "http://localhost:5173",       // Local Vite
    "https://rentcycle.site",      // Your Hostinger Domain
    "https://www.rentcycle.site"   // Your Hostinger Domain (www)
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Payload limits (for uploading vehicle images)
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

// --- 3. REGISTER THE ROUTES (The Wiring) ---
// This tells the server: "When someone asks for /api/admin, look in adminRoutes.js"
app.use("/api/auth", authRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/reviews", reviewsRoutes);
app.use("/api/webhooks", webhookRoutes);

// Basic Test Route
app.get("/", (req, res) => {
  res.send("RentCycle Backend API is running!");
});

// Error Handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
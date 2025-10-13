const express = require('express');
const router = express.Router();
const { getNotifications, markNotificationAsRead, markAllNotificationsAsRead } = require('../controllers/notificationController');
const { verifyToken } = require('../middleware/authMiddleware');

router.use(verifyToken);

// GET /api/notifications
router.get('/', getNotifications);

// POST /api/notifications/:notificationId/mark-read
router.post('/:notificationId/mark-read', markNotificationAsRead);

// POST /api/notifications/mark-all-read
router.post('/mark-all-read', markAllNotificationsAsRead);

module.exports = router;
const { db } = require('../utils/firebase');

/**
 * Fetches all notifications for the authenticated user, sorted by most recent.
 */
const getNotifications = async (req, res) => {
    try {
        const userId = req.customUser.uid;
        const notificationsRef = db.collection('notifications');
        const snapshot = await notificationsRef
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(50) // Limit to the 50 most recent notifications
            .get();

        if (snapshot.empty) {
            return res.status(200).json([]);
        }

        const notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(notifications);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ message: 'Server error fetching notifications.' });
    }
};

/**
 * Marks a single notification as read.
 */
const markNotificationAsRead = async (req, res) => {
    try {
        const userId = req.customUser.uid;
        const { notificationId } = req.params;

        const notificationRef = db.collection('notifications').doc(notificationId);
        const doc = await notificationRef.get();

        if (!doc.exists) {
            return res.status(404).json({ message: 'Notification not found.' });
        }

        // Security check: ensure the notification belongs to the user trying to mark it as read
        if (doc.data().userId !== userId) {
            return res.status(403).json({ message: 'You are not authorized to update this notification.' });
        }

        await notificationRef.update({ isRead: true });
        res.status(200).json({ message: 'Notification marked as read.' });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ message: 'Server error marking notification as read.' });
    }
};

/**
 * Marks all unread notifications for a user as read.
 */
const markAllNotificationsAsRead = async (req, res) => {
    try {
        const userId = req.customUser.uid;
        const notificationsRef = db.collection('notifications');
        const snapshot = await notificationsRef
            .where('userId', '==', userId)
            .where('isRead', '==', false)
            .get();

        if (snapshot.empty) {
            return res.status(200).json({ message: 'No unread notifications to mark.' });
        }

        // Use a batch write to update all documents efficiently
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.update(doc.ref, { isRead: true });
        });

        await batch.commit();
        res.status(200).json({ message: 'All notifications marked as read.' });

    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ message: 'Server error marking all notifications as read.' });
    }
};

module.exports = {
    getNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
};

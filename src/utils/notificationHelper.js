// backend/src/utils/notificationHelper.js
const { db } = require('./firebase'); // Or your firebaseUtil path

/**
 * Creates a new notification document in Firestore.
 * @param {string} userId The ID of the user who will receive the notification.
 * @param {string} message The notification message.
 * @param {string|null} link An optional link for navigation.
 */
const createNotification = async (userId, message, link = null) => {
  try {
    if (!userId || !message) {
      throw new Error('User ID and message are required to create a notification.');
    }

    await db.collection('notifications').add({
      userId,
      message,
      link,
      isRead: false,
      createdAt: new Date(),
    });

  } catch (error) {
    console.error(`Failed to create notification for user ${userId}:`, error);
  }
};

module.exports = { createNotification };
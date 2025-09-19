const { admin, db } = require('../utils/firebase');

const log = (message, data = '') => {
  console.log(`[ChatController] ${message}`, data);
};

const getUserChats = async (req, res) => {
  try {
    const userId = req.customUser.uid;
    log(`Fetching chats for user: ${userId}`);
    
    const chatsRef = db.collection('chats');
    const snapshot = await chatsRef.where('participants', 'array-contains', userId).get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    const chatPromises = snapshot.docs.map(async (doc) => {
      const chatData = doc.data();
      const otherUserId = chatData.participants.find(id => id !== userId);
      
      let otherUserDetails = { name: 'Unknown User', profilePhotoUrl: null };
      if (otherUserId) {
        const userDoc = await db.collection('users').doc(otherUserId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          otherUserDetails = {
            name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'User',
            profilePhotoUrl: userData.profilePhotoUrl || null
          };
        }
      }

      // This logic ensures a default lastMessage object always exists
      const lastMessage = chatData.lastMessage || { text: 'No messages yet.', senderId: 'system' };

      return {
        id: doc.id,
        ...chatData,
        lastMessage, // Use the safe, defaulted lastMessage
        otherUserDetails,
      };
    });

    const enrichedChats = await Promise.all(chatPromises);
    res.status(200).json(enrichedChats);
  } catch (error) {
    console.error('Error fetching user chats:', error);
    res.status(500).json({ message: 'Failed to fetch user chats.' });
  }
};

const sendMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { text } = req.body;
    const senderId = req.customUser.uid;

    if (!text) {
      return res.status(400).json({ message: 'Message text is required.' });
    }

    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();
    if (!chatDoc.exists || !chatDoc.data().participants.includes(senderId)) {
        return res.status(403).json({ message: 'Not authorized to send messages in this chat.' });
    }

    const message = {
      senderId,
      text,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    await chatRef.collection('messages').add(message);
    
    await chatRef.update({ lastMessage: { text, senderId, timestamp: message.timestamp, readBy: [senderId], } });

    res.status(201).json({ message: 'Message sent successfully.' });
  } catch (error) {
    console.error(`Error sending message to chat ${chatId}:`, error);
    res.status(500).json({ message: 'Failed to send message.' });
  }
};

/**
 * Marks a chat as read by the current user.
 */
const markChatAsRead = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = req.customUser.uid;

        const chatRef = db.collection('chats').doc(chatId);
        
        // Use arrayUnion to safely add the user's ID to the readBy array
        await chatRef.update({
            'lastMessage.readBy': admin.firestore.FieldValue.arrayUnion(userId)
        });

        res.status(200).json({ message: 'Chat marked as read.' });
    } catch (error) {
        console.error(`Error marking chat ${req.params.chatId} as read:`, error);
        res.status(500).json({ message: 'Failed to mark chat as read.' });
    }
};

module.exports = {
  getUserChats,
  sendMessage,
  markChatAsRead,
};
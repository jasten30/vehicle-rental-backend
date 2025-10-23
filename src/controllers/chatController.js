const { admin, db, storageBucket } = require('../utils/firebase'); // 👈 THIS LINE IS FIXED
const { createNotification } = require('../utils/notificationHelper');

const log = (message, data = '') => {
  console.log(`[ChatController] ${message}`, data);
};

// 👇 This function uses storageBucket, which is now imported
const uploadBase64Image = async (base64String, folderName) => {
  if (!base64String || !base64String.startsWith('data:image/')) return null;
  const matches = base64String.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) throw new Error('Invalid Base64 string.');

  const contentType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const fileName = `${folderName}/${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const file = storageBucket.file(fileName);

  await file.save(buffer, { metadata: { contentType }, public: true });
  // Return the public URL
  return `https://storage.googleapis.com/${storageBucket.name}/${fileName}`;
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

      const lastMessage = chatData.lastMessage || { text: 'No messages yet.', senderId: 'system' };

      return {
        id: doc.id,
        ...chatData,
        lastMessage,
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
    const { text, imageBase64 } = req.body;
    const senderId = req.customUser.uid;

    if (!text && !imageBase64) {
      return res.status(400).json({ message: 'Message text or image is required.' });
    }

    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();
    if (!chatDoc.exists || !chatDoc.data().participants.includes(senderId)) {
        return res.status(403).json({ message: 'Not authorized to send messages in this chat.' });
    }

    let imageUrl = null;
    let messageType = 'text';
    let lastMessageText = text;

    // 1. Upload image if it exists
    if (imageBase64) {
        try {
            imageUrl = await uploadBase64Image(imageBase64, 'chat_messages');
            if (!imageUrl) {
                throw new Error('Image upload returned null URL.');
            }
            messageType = text ? 'text_with_image' : 'image';
            lastMessageText = text ? text : 'Sent an image'; // Summary for last message
        } catch (uploadError) {
             console.error(`Error uploading chat image for chat ${chatId}:`, uploadError);
             return res.status(500).json({ message: 'Failed to upload image.' });
        }
    }

    // 2. Prepare message data
    const message = {
      senderId,
      text: text || null, // Store null if no text
      imageUrl: imageUrl, // Store null if no image
      type: messageType,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    // 3. Save message and update lastMessage
    await chatRef.collection('messages').add(message);
    
    await chatRef.update({ 
        lastMessage: { 
            text: lastMessageText,
            senderId, 
            timestamp: message.timestamp, 
            readBy: [senderId], 
        } 
    });

    // 4. Send notification
    const participants = chatDoc.data().participants || [];
    const recipientId = participants.find(id => id !== senderId);

    if (recipientId) {
      const senderDoc = await db.collection('users').doc(senderId).get();
      const senderName = senderDoc.exists ? senderDoc.data().firstName : 'Someone';

      await createNotification(
        recipientId,
        `${senderName}: ${lastMessageText}`, // Use summary text in notification
        `/chat/${chatId}` // Assumes /chat/:id route exists
      );
    }

    res.status(201).json({ message: 'Message sent successfully.' });
  } catch (error) {
    console.error(`Error sending message to chat ${chatId}:`, error);
    res.status(500).json({ message: 'Failed to send message.' });
  }
};

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

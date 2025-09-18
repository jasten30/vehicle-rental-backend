const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');

// GET /api/chats - Get all chats for the logged-in user
router.get('/', authMiddleware.verifyToken, chatController.getUserChats);

// POST /api/chats/:chatId/messages - Send a new message
router.post('/:chatId/messages', authMiddleware.verifyToken, chatController.sendMessage);

module.exports = router;
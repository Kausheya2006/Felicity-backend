const express = require("express");
const router = express.Router();
const messageController = require("../controllers/messageController");
const authMiddleware = require("../middleware/authMiddleware");

// All routes require authentication
router.use(authMiddleware);

// Get messages for an event (with pagination)
router.get("/event/:eventId", messageController.getMessages);

// Post a new message to an event
router.post("/event/:eventId", messageController.postMessage);

// Get unread message count for an event
router.get("/event/:eventId/unread", messageController.getUnreadCount);

// Edit a message
router.patch("/:messageId", messageController.editMessage);

// Delete a message
router.delete("/:messageId", messageController.deleteMessage);

// Toggle pin on a message (organizer only)
router.post("/:messageId/pin", messageController.togglePin);

// React to a message
router.post("/:messageId/react", messageController.reactToMessage);

// Get replies for a message
router.get("/:messageId/replies", messageController.getReplies);

module.exports = router;

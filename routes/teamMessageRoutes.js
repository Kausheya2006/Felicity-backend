const express = require("express");
const router = express.Router();
const teamMessageController = require("../controllers/teamMessageController");
const authMiddleware = require("../middleware/authMiddleware");

// All routes require authentication
router.use(authMiddleware);

// Get messages for a team
router.get("/team/:teamId", teamMessageController.getMessages);

// Send a message to a team
router.post("/team/:teamId", teamMessageController.sendMessage);

// Mark messages as read
router.post("/team/:teamId/read", teamMessageController.markAsRead);

// Get unread count for a team
router.get("/team/:teamId/unread", teamMessageController.getUnreadCount);

// Edit a message
router.patch("/:messageId", teamMessageController.editMessage);

// Delete a message
router.delete("/:messageId", teamMessageController.deleteMessage);

module.exports = router;

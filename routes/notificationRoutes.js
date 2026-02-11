const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const authMiddleware = require("../middleware/authMiddleware");

// All routes require authentication
router.use(authMiddleware);

// Get notifications
router.get("/", notificationController.getNotifications);

// Get unread count
router.get("/unread-count", notificationController.getUnreadCount);

// Mark single notification as read
router.patch("/:notificationId/read", notificationController.markAsRead);

// Mark all as read
router.patch("/read-all", notificationController.markAllAsRead);

// Delete single notification
router.delete("/:notificationId", notificationController.deleteNotification);

// Clear all notifications
router.delete("/", notificationController.clearAll);

module.exports = router;

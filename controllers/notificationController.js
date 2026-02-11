const Notification = require("../models/Notification");

// Get the io instance (will be set from server.js)
let io;
exports.setSocketIO = (socketIO) => {
  io = socketIO;
};

// Helper: Create and emit notification
exports.createNotification = async (notificationData) => {
  try {
    const notification = await Notification.create(notificationData);
    
    // Emit to user's personal notification room
    if (io) {
      io.to(`user_${notificationData.userId}`).emit("newNotification", notification);
    }
    
    return notification;
  } catch (error) {
    console.error("Error creating notification:", error);
    return null;
  }
};

// Get user's notifications
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    
    const query = { userId };
    if (unreadOnly === 'true') {
      query.isRead = false;
    }
    
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate("eventId", "title")
      .populate("teamId", "teamName");
    
    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({ userId, isRead: false });
    
    res.json({
      notifications,
      total,
      unreadCount,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("getNotifications error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get unread count
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;
    const count = await Notification.countDocuments({ userId, isRead: false });
    res.json({ count });
  } catch (error) {
    console.error("getUnreadCount error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;
    
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
    
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    
    res.json({ notification });
  } catch (error) {
    console.error("markAsRead error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Mark all as read
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    
    await Notification.updateMany(
      { userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );
    
    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("markAllAsRead error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete notification
exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;
    
    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      userId,
    });
    
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    
    res.json({ message: "Notification deleted" });
  } catch (error) {
    console.error("deleteNotification error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Clear all notifications
exports.clearAll = async (req, res) => {
  try {
    const userId = req.user.id;
    await Notification.deleteMany({ userId });
    res.json({ message: "All notifications cleared" });
  } catch (error) {
    console.error("clearAll error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

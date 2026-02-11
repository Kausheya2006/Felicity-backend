const Message = require("../models/Message");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const { createNotification } = require("./notificationController");

// Get the io instance (will be set from server.js)
let io;
exports.setSocketIO = (socketIO) => {
  io = socketIO;
};

// Helper: Check if user is registered for event or is the organizer
const canAccessForum = async (userId, eventId, userRole) => {
  const event = await Event.findById(eventId);
  if (!event) return { allowed: false, isOrganizer: false };
  
  // Check if user is the event's organizer
  const isEventOrganizer = event.organizerId.toString() === userId.toString();
  
  if (isEventOrganizer) return { allowed: true, isOrganizer: true };
  
  // Check if participant is registered
  const registration = await Registration.findOne({
    eventId,
    participantId: userId,
    status: { $in: ['CONFIRMED', 'PENDING'] }
  });
  
  return { allowed: !!registration, isOrganizer: false };
};

// Get messages for an event
exports.getMessages = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { parentId, page = 1, limit = 50 } = req.query;
    const userId = req.user.id;
    
    // Check access
    const { allowed } = await canAccessForum(userId, eventId, req.user.role);
    if (!allowed) {
      return res.status(403).json({ message: "You must be registered to view discussions" });
    }
    
    const query = { 
      eventId, 
      isDeleted: false,
    };
    
    // If parentId is provided, get replies; otherwise get top-level messages
    if (parentId) {
      query.parentId = parentId;
    } else {
      query.parentId = null;
    }
    
    const skip = (page - 1) * limit;
    
    const messages = await Message.find(query)
      .populate("authorId", "email participantProfile organizerProfile role")
      .sort({ isPinned: -1, isAnnouncement: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Message.countDocuments(query);
    
    // Get pinned/announcement messages separately if getting top-level
    let pinnedMessages = [];
    let announcements = [];
    if (!parentId) {
      pinnedMessages = await Message.find({ 
        eventId, 
        isDeleted: false, 
        isPinned: true,
        parentId: null 
      })
        .populate("authorId", "email participantProfile organizerProfile role")
        .sort({ createdAt: -1 });
      
      announcements = await Message.find({ 
        eventId, 
        isDeleted: false, 
        isAnnouncement: true,
        parentId: null 
      })
        .populate("authorId", "email participantProfile organizerProfile role")
        .sort({ createdAt: -1 });
    }
    
    res.json({
      messages,
      pinnedMessages,
      announcements,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("getMessages error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Post a new message
exports.postMessage = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { content, parentId, isAnnouncement } = req.body;
    const userId = req.user.id;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: "Message content is required" });
    }
    
    // Check access
    const { allowed, isOrganizer } = await canAccessForum(userId, eventId, req.user.role);
    if (!allowed) {
      return res.status(403).json({ message: "You must be registered to post messages" });
    }
    
    // Only organizers can post announcements
    if (isAnnouncement && !isOrganizer) {
      return res.status(403).json({ message: "Only organizers can post announcements" });
    }
    
    // If replying, verify parent message exists
    if (parentId) {
      const parentMessage = await Message.findById(parentId);
      if (!parentMessage || parentMessage.eventId.toString() !== eventId) {
        return res.status(404).json({ message: "Parent message not found" });
      }
    }
    
    const message = await Message.create({
      eventId,
      authorId: userId,
      content: content.trim(),
      parentId: parentId || null,
      isAnnouncement: isAnnouncement && isOrganizer ? true : false,
    });
    
    // Update parent's reply count
    if (parentId) {
      await Message.findByIdAndUpdate(parentId, { $inc: { replyCount: 1 } });
    }
    
    // Populate author info
    await message.populate("authorId", "email participantProfile organizerProfile role");
    
    // Emit real-time event
    if (io) {
      io.to(`event_${eventId}`).emit("newMessage", {
        message,
        parentId
      });
    }
    
    // Create notifications
    const event = await Event.findById(eventId);
    const eventName = event?.title || "Event";
    
    if (isAnnouncement && isOrganizer) {
      // Notify all registered participants about announcement
      const registrations = await Registration.find({ 
        eventId, 
        status: { $in: ["registered", "confirmed"] }
      });
      
      for (const reg of registrations) {
        if (reg.userId.toString() !== userId) {
          await createNotification(
            reg.userId,
            "ANNOUNCEMENT",
            `New Announcement in ${eventName}`,
            content.substring(0, 100) + (content.length > 100 ? "..." : ""),
            eventId,
            null,
            message._id,
            `/events/${eventId}#forum`
          );
        }
      }
    } else if (parentId) {
      // Notify parent message author about reply
      const parentMessage = await Message.findById(parentId);
      if (parentMessage && parentMessage.authorId.toString() !== userId) {
        await createNotification(
          parentMessage.authorId,
          "FORUM_REPLY",
          `New reply in ${eventName}`,
          content.substring(0, 100) + (content.length > 100 ? "..." : ""),
          eventId,
          null,
          message._id,
          `/events/${eventId}#forum`
        );
      }
    }
    
    res.status(201).json({ message: "Message posted", data: message });
  } catch (error) {
    console.error("postMessage error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Edit a message
exports.editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: "Message content is required" });
    }
    
    const message = await Message.findById(messageId);
    if (!message || message.isDeleted) {
      return res.status(404).json({ message: "Message not found" });
    }
    
    // Only author can edit
    if (message.authorId.toString() !== userId) {
      return res.status(403).json({ message: "You can only edit your own messages" });
    }
    
    message.content = content.trim();
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();
    
    await message.populate("authorId", "email participantProfile organizerProfile role");
    
    // Emit real-time event
    if (io) {
      io.to(`event_${message.eventId}`).emit("messageEdited", { message });
    }
    
    res.json({ message: "Message updated", data: message });
  } catch (error) {
    console.error("editMessage error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete a message (soft delete)
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    
    const message = await Message.findById(messageId);
    if (!message || message.isDeleted) {
      return res.status(404).json({ message: "Message not found" });
    }
    
    // Check if user is author or organizer
    const event = await Event.findById(message.eventId);
    const isOrganizer = event.organizerId.toString() === userId || req.user.role === 'organizer';
    const isAuthor = message.authorId.toString() === userId;
    
    if (!isAuthor && !isOrganizer) {
      return res.status(403).json({ message: "Not authorized to delete this message" });
    }
    
    message.isDeleted = true;
    message.deletedBy = userId;
    message.deletedAt = new Date();
    await message.save();
    
    // Decrease parent's reply count if this is a reply
    if (message.parentId) {
      await Message.findByIdAndUpdate(message.parentId, { $inc: { replyCount: -1 } });
    }
    
    // Emit real-time event
    if (io) {
      io.to(`event_${message.eventId}`).emit("messageDeleted", { 
        messageId, 
        parentId: message.parentId 
      });
    }
    
    res.json({ message: "Message deleted" });
  } catch (error) {
    console.error("deleteMessage error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Toggle pin message (organizer only)
exports.togglePin = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    
    const message = await Message.findById(messageId);
    if (!message || message.isDeleted) {
      return res.status(404).json({ message: "Message not found" });
    }
    
    // Check if user is organizer
    const event = await Event.findById(message.eventId);
    if (event.organizerId.toString() !== userId && req.user.role !== 'organizer') {
      return res.status(403).json({ message: "Only organizers can pin messages" });
    }
    
    message.isPinned = !message.isPinned;
    await message.save();
    
    await message.populate("authorId", "email participantProfile organizerProfile role");
    
    // Emit real-time event
    if (io) {
      io.to(`event_${message.eventId}`).emit("messagePinToggled", { message });
    }
    
    res.json({ message: `Message ${message.isPinned ? 'pinned' : 'unpinned'}`, data: message });
  } catch (error) {
    console.error("togglePin error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// React to a message
exports.reactToMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user.id;
    
    const validEmojis = ["👍", "❤️", "😂", "😮", "😢", "🎉"];
    if (!validEmojis.includes(emoji)) {
      return res.status(400).json({ message: "Invalid emoji" });
    }
    
    const message = await Message.findById(messageId);
    if (!message || message.isDeleted) {
      return res.status(404).json({ message: "Message not found" });
    }
    
    // Check access
    const { allowed } = await canAccessForum(userId, message.eventId, req.user.role);
    if (!allowed) {
      return res.status(403).json({ message: "You must be registered to react" });
    }
    
    // Check if user already reacted with this emoji
    const existingReactionIndex = message.reactions.findIndex(
      r => r.userId.toString() === userId && r.emoji === emoji
    );
    
    if (existingReactionIndex > -1) {
      // Remove reaction (toggle off)
      message.reactions.splice(existingReactionIndex, 1);
    } else {
      // Remove any existing reaction from this user and add new one
      message.reactions = message.reactions.filter(
        r => r.userId.toString() !== userId
      );
      message.reactions.push({ userId, emoji });
    }
    
    await message.save();
    await message.populate("authorId", "email participantProfile organizerProfile role");
    
    // Emit real-time event
    if (io) {
      io.to(`event_${message.eventId}`).emit("messageReaction", { message });
    }
    
    res.json({ message: "Reaction updated", data: message });
  } catch (error) {
    console.error("reactToMessage error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get replies for a message
exports.getReplies = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    
    const parentMessage = await Message.findById(messageId);
    if (!parentMessage || parentMessage.isDeleted) {
      return res.status(404).json({ message: "Message not found" });
    }
    
    // Check access
    const { allowed } = await canAccessForum(userId, parentMessage.eventId, req.user.role);
    if (!allowed) {
      return res.status(403).json({ message: "You must be registered to view discussions" });
    }
    
    const replies = await Message.find({ 
      parentId: messageId, 
      isDeleted: false 
    })
      .populate("authorId", "email participantProfile organizerProfile role")
      .sort({ createdAt: 1 });
    
    res.json({ replies });
  } catch (error) {
    console.error("getReplies error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get unread count (for notifications) - based on messages after user's last visit
exports.getUnreadCount = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { lastVisit } = req.query;
    const userId = req.user.id;
    
    // Check access
    const { allowed } = await canAccessForum(userId, eventId, req.user.role);
    if (!allowed) {
      return res.status(403).json({ message: "Access denied" });
    }
    
    const query = { 
      eventId, 
      isDeleted: false,
      authorId: { $ne: userId }, // Exclude own messages
    };
    
    if (lastVisit) {
      query.createdAt = { $gt: new Date(lastVisit) };
    }
    
    const count = await Message.countDocuments(query);
    
    res.json({ unreadCount: count });
  } catch (error) {
    console.error("getUnreadCount error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

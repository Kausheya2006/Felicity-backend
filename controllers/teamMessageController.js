const TeamMessage = require("../models/TeamMessage");
const Team = require("../models/Team");
const Notification = require("../models/Notification");
const { createNotification } = require("./notificationController");

// Get the io instance (will be set from server.js)
let io;
exports.setSocketIO = (socketIO) => {
  io = socketIO;
};

// Track online users and typing status per team
const teamOnlineUsers = new Map(); // teamId -> Set of userIds
const teamTypingUsers = new Map(); // teamId -> Set of userIds

// Helper: Check if user is a member of the team
const isTeamMember = async (userId, teamId) => {
  const team = await Team.findById(teamId);
  if (!team) return false;
  
  // Check if leader
  if (team.teamLeader.toString() === userId.toString()) return true;
  
  // Check if accepted member
  return team.members.some(m => 
    m.userId.toString() === userId.toString() && m.status === "ACCEPTED"
  );
};

// Get all team members for notifications
const getTeamMemberIds = async (teamId, excludeUserId) => {
  const team = await Team.findById(teamId);
  if (!team) return [];
  
  const memberIds = [team.teamLeader.toString()];
  team.members.forEach(m => {
    if (m.status === "ACCEPTED") {
      memberIds.push(m.userId.toString());
    }
  });
  
  return memberIds.filter(id => id !== excludeUserId.toString());
};

// Get messages for a team
exports.getMessages = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { page = 1, limit = 50, before } = req.query;
    const userId = req.user.id;
    
    // Check membership
    if (!(await isTeamMember(userId, teamId))) {
      return res.status(403).json({ message: "You are not a member of this team" });
    }
    
    const query = { teamId, isDeleted: false };
    
    // If 'before' timestamp is provided, get messages before that time (for infinite scroll)
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }
    
    const messages = await TeamMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate("authorId", "email participantProfile organizerProfile role");
    
    // Return in chronological order
    messages.reverse();
    
    res.json({ messages });
  } catch (error) {
    console.error("getMessages error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Send a message
exports.sendMessage = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { content, messageType = "TEXT", attachment, linkPreview } = req.body;
    const userId = req.user.id;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: "Message content is required" });
    }
    
    // Check membership
    if (!(await isTeamMember(userId, teamId))) {
      return res.status(403).json({ message: "You are not a member of this team" });
    }
    
    const team = await Team.findById(teamId).populate("eventId", "title");
    
    const message = await TeamMessage.create({
      teamId,
      authorId: userId,
      content: content.trim(),
      messageType,
      attachment,
      linkPreview,
      readBy: [{ userId, readAt: new Date() }],
    });
    
    // Populate author info
    await message.populate("authorId", "email participantProfile organizerProfile role");
    
    // Emit to team room
    if (io) {
      io.to(`team_${teamId}`).emit("newTeamMessage", { message });
    }
    
    // Create notifications for other team members
    const otherMembers = await getTeamMemberIds(teamId, userId);
    for (const memberId of otherMembers) {
      await createNotification({
        userId: memberId,
        type: "TEAM_MESSAGE",
        title: `New message in ${team.teamName}`,
        message: `${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`,
        teamId,
        eventId: team.eventId?._id,
        link: `/teams?chat=${teamId}`,
      });
    }
    
    res.status(201).json({ message });
  } catch (error) {
    console.error("sendMessage error:", error);
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
    
    const message = await TeamMessage.findById(messageId);
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
    
    // Emit update
    if (io) {
      io.to(`team_${message.teamId}`).emit("teamMessageEdited", { message });
    }
    
    res.json({ message });
  } catch (error) {
    console.error("editMessage error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete a message
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    
    const message = await TeamMessage.findById(messageId);
    if (!message || message.isDeleted) {
      return res.status(404).json({ message: "Message not found" });
    }
    
    // Only author can delete
    if (message.authorId.toString() !== userId) {
      return res.status(403).json({ message: "You can only delete your own messages" });
    }
    
    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();
    
    // Emit delete
    if (io) {
      io.to(`team_${message.teamId}`).emit("teamMessageDeleted", { messageId });
    }
    
    res.json({ message: "Message deleted" });
  } catch (error) {
    console.error("deleteMessage error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Mark messages as read
exports.markAsRead = async (req, res) => {
  try {
    const { teamId } = req.params;
    const userId = req.user.id;
    
    // Check membership
    if (!(await isTeamMember(userId, teamId))) {
      return res.status(403).json({ message: "You are not a member of this team" });
    }
    
    // Mark all unread messages as read
    await TeamMessage.updateMany(
      {
        teamId,
        isDeleted: false,
        "readBy.userId": { $ne: userId },
      },
      {
        $push: { readBy: { userId, readAt: new Date() } },
      }
    );
    
    // Emit read receipt
    if (io) {
      io.to(`team_${teamId}`).emit("messagesRead", { teamId, userId });
    }
    
    res.json({ message: "Messages marked as read" });
  } catch (error) {
    console.error("markAsRead error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get unread count for a team
exports.getUnreadCount = async (req, res) => {
  try {
    const { teamId } = req.params;
    const userId = req.user.id;
    
    // Check membership
    if (!(await isTeamMember(userId, teamId))) {
      return res.status(403).json({ message: "You are not a member of this team" });
    }
    
    const count = await TeamMessage.countDocuments({
      teamId,
      isDeleted: false,
      "readBy.userId": { $ne: userId },
    });
    
    res.json({ count });
  } catch (error) {
    console.error("getUnreadCount error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Handle user joining team chat room
exports.handleJoinTeamRoom = (socket, teamId, userId) => {
  socket.join(`team_${teamId}`);
  
  // Track online user
  if (!teamOnlineUsers.has(teamId)) {
    teamOnlineUsers.set(teamId, new Set());
  }
  teamOnlineUsers.get(teamId).add(userId);
  
  // Emit online users update
  io.to(`team_${teamId}`).emit("teamOnlineUsers", {
    teamId,
    onlineUsers: Array.from(teamOnlineUsers.get(teamId)),
  });
};

// Handle user leaving team chat room
exports.handleLeaveTeamRoom = (socket, teamId, userId) => {
  socket.leave(`team_${teamId}`);
  
  // Remove from online users
  if (teamOnlineUsers.has(teamId)) {
    teamOnlineUsers.get(teamId).delete(userId);
    
    // Emit online users update
    io.to(`team_${teamId}`).emit("teamOnlineUsers", {
      teamId,
      onlineUsers: Array.from(teamOnlineUsers.get(teamId)),
    });
  }
  
  // Remove from typing
  if (teamTypingUsers.has(teamId)) {
    teamTypingUsers.get(teamId).delete(userId);
    io.to(`team_${teamId}`).emit("teamTypingUsers", {
      teamId,
      typingUsers: Array.from(teamTypingUsers.get(teamId)),
    });
  }
};

// Handle typing indicator
exports.handleTyping = (socket, teamId, userId, isTyping) => {
  if (!teamTypingUsers.has(teamId)) {
    teamTypingUsers.set(teamId, new Set());
  }
  
  if (isTyping) {
    teamTypingUsers.get(teamId).add(userId);
  } else {
    teamTypingUsers.get(teamId).delete(userId);
  }
  
  // Emit typing users update (exclude sender)
  socket.to(`team_${teamId}`).emit("teamTypingUsers", {
    teamId,
    typingUsers: Array.from(teamTypingUsers.get(teamId)),
  });
};

// Handle disconnect - remove from all teams
exports.handleDisconnect = (userId) => {
  for (const [teamId, users] of teamOnlineUsers.entries()) {
    if (users.has(userId)) {
      users.delete(userId);
      io.to(`team_${teamId}`).emit("teamOnlineUsers", {
        teamId,
        onlineUsers: Array.from(users),
      });
    }
  }
  
  for (const [teamId, users] of teamTypingUsers.entries()) {
    if (users.has(userId)) {
      users.delete(userId);
      io.to(`team_${teamId}`).emit("teamTypingUsers", {
        teamId,
        typingUsers: Array.from(users),
      });
    }
  }
};

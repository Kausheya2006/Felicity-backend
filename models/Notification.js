const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "FORUM_MESSAGE",      // New message in event forum
        "FORUM_REPLY",        // Reply to user's message
        "FORUM_MENTION",      // User mentioned in forum
        "TEAM_MESSAGE",       // New team chat message
        "TEAM_INVITE",        // Invited to join team
        "TEAM_JOIN",          // Someone joined your team
        "TEAM_LEAVE",         // Someone left team
        "REGISTRATION",       // Registration confirmed
        "EVENT_UPDATE",       // Event details updated
        "ANNOUNCEMENT",       // Organizer announcement
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    // Reference to related entities
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    // Read status
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: Date,
    // Link to navigate when clicked
    link: String,
  },
  { timestamps: true }
);

// Indexes for efficient queries
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);

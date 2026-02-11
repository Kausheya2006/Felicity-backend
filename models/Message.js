const mongoose = require("mongoose");

const reactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  emoji: {
    type: String,
    required: true,
    enum: ["👍", "❤️", "😂", "😮", "😢", "🎉"],
  },
}, { _id: false });

const messageSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    // For threading - null means it's a top-level message
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    // Moderation fields
    isPinned: {
      type: Boolean,
      default: false,
    },
    isAnnouncement: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    deletedAt: Date,
    // Reactions
    reactions: [reactionSchema],
    // Reply count (for threaded messages)
    replyCount: {
      type: Number,
      default: 0,
    },
    // Edit tracking
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: Date,
  },
  { timestamps: true }
);

// Index for efficient querying
messageSchema.index({ eventId: 1, createdAt: -1 });
messageSchema.index({ eventId: 1, isPinned: -1, createdAt: -1 });
messageSchema.index({ parentId: 1, createdAt: 1 });

// Virtual for checking if user is the author
messageSchema.methods.isAuthor = function(userId) {
  return this.authorId.toString() === userId.toString();
};

// Get reaction count by emoji
messageSchema.methods.getReactionCounts = function() {
  const counts = {};
  this.reactions.forEach(r => {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
  });
  return counts;
};

module.exports = mongoose.model("Message", messageSchema);

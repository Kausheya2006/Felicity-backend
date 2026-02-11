const mongoose = require("mongoose");

const teamMessageSchema = new mongoose.Schema(
  {
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
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
      maxLength: 2000,
    },
    // Message type
    messageType: {
      type: String,
      enum: ["TEXT", "FILE", "LINK", "SYSTEM"],
      default: "TEXT",
    },
    // File attachment info
    attachment: {
      fileName: String,
      fileUrl: String,
      fileType: String,
      fileSize: Number,
    },
    // Link preview info
    linkPreview: {
      url: String,
      title: String,
      description: String,
    },
    // Edit tracking
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: Date,
    // Soft delete
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: Date,
    // Read receipts
    readBy: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      readAt: {
        type: Date,
        default: Date.now,
      },
    }],
  },
  { timestamps: true }
);

// Indexes
teamMessageSchema.index({ teamId: 1, createdAt: -1 });
teamMessageSchema.index({ teamId: 1, isDeleted: 1, createdAt: -1 });

module.exports = mongoose.model("TeamMessage", teamMessageSchema);

const mongoose = require("mongoose");
const crypto = require("crypto");

const teamMemberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "DECLINED"],
      default: "PENDING",
    },
    joinedAt: Date,
  },
  { _id: false }
);

const teamSchema = new mongoose.Schema(
  {
    teamName: {
      type: String,
      required: true,
      trim: true,
    },

    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },

    teamLeader: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    teamSize: {
      type: Number,
      required: true,
      min: 2,
    },

    members: [teamMemberSchema],

    inviteCode: {
      type: String,
      unique: true,
      required: true,
    },

    status: {
      type: String,
      enum: ["FORMING", "COMPLETE", "REGISTERED", "CANCELLED"],
      default: "FORMING",
    },

    formResponse: mongoose.Schema.Types.Mixed, // Team leader's form response

    completedAt: Date,
    registeredAt: Date,
  },
  { timestamps: true }
);

// Generate unique invite code before saving
teamSchema.pre("save", function (next) {
  if (!this.inviteCode) {
    this.inviteCode = crypto.randomBytes(4).toString("hex").toUpperCase();
  }
  next();
});

// Check if team is complete
teamSchema.methods.isComplete = function () {
  const acceptedMembers = this.members.filter(m => m.status === "ACCEPTED");
  return acceptedMembers.length === this.teamSize;
};

// Get accepted members including leader
teamSchema.methods.getAcceptedMembers = function () {
  return this.members
    .filter(m => m.status === "ACCEPTED")
    .map(m => m.userId);
};

// Indexes
teamSchema.index({ eventId: 1 });
teamSchema.index({ teamLeader: 1 });
// inviteCode already indexed via unique: true
teamSchema.index({ "members.userId": 1 });

module.exports = mongoose.model("Team", teamSchema);

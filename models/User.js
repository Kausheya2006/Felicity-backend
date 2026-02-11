const mongoose = require("mongoose");

const participantProfileSchema = new mongoose.Schema(
  {
    firstname: String,
    lastname: String,
    contactNumber: String,

    participantType: {type: String, enum: ["IIIT", "NON_IIIT"],},

    college: String,

    interests: [String],

    followedClubs: [{type: mongoose.Schema.Types.ObjectId, ref: "User",},],
  },
  
  { _id: false }
);

const organizerProfileSchema = new mongoose.Schema(
  {
    name: String,
    category: String,
    description: String,
    contactEmail: String,
    contactNumber: String,
    discordWebhook: String,
    approved: {type: Boolean, default: false},
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {type: String, required: true,},

    role: {type: String, enum: ["participant", "organizer", "admin"], default: "participant",},

    isVerified: {type: Boolean, default: false,},

    participantProfile: participantProfileSchema,

    organizerProfile: organizerProfileSchema,
  },
  { timestamps: true }
);

// role-based validation
userSchema.pre("validate", function (next) {

  if (this.role === "participant") {
    if (
      !this.participantProfile ||
      !this.participantProfile.participantType ||
      !this.participantProfile.college
    ) {
      return next(
        new Error("Participant must have participantType and college")
      );
    }
  }

  if (this.role === "organizer") {
    if (
      !this.organizerProfile ||
      !this.organizerProfile.name ||
      !this.organizerProfile.category ||
      !this.organizerProfile.contactEmail
    ) {
      return next(
        new Error("Organizer must have name, category, and contactEmail")
      );
    }
  }

  next();
});

// indexes
userSchema.index({ "organizerProfile.name": "text" });

module.exports = mongoose.model("User", userSchema);

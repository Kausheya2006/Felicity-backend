const mongoose = require("mongoose");

const formFieldSchema = new mongoose.Schema(
  {
    fieldId: String,
    label: String,
    type: {
      type: String,
      enum: ["text", "number", "select", "checkbox"],
    },
    required: Boolean,
    options: [String],
    order: Number,
  },
  { _id: false }
);

const merchVariantSchema = new mongoose.Schema(
  {
    size: String,
    color: String,
    stock: Number,
  },
  { _id: false }
);

const merchItemSchema = new mongoose.Schema(
  {
    sku: String,
    name: String,
    variants: [merchVariantSchema],
    purchaseLimitPerUser: Number,
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    organizerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: {
      type: String,
      required: true,
    },

    description: String,

    type: {
      type: String,
      enum: ["NORMAL", "MERCH"],
      default: "NORMAL",
    },

    eligibility: {
      type: [String],
      enum: ["IIIT", "NON_IIIT"],
      default: [],
    },

    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED", "ONGOING", "CLOSED", "COMPLETED", "CANCELLED"],
      default: "DRAFT",
    },

    registrationDeadline: Date,
    eventStartDate: Date,
    eventEndDate: Date,
    venue: String,

    maxParticipants: Number,
    fee: {
      type: Number,
      default: 0
    },

    tags: [String],

    // Team-based registration support
    allowTeams: {
      type: Boolean,
      default: false,
    },
    minTeamSize: {
      type: Number,
      min: 2,
    },
    maxTeamSize: {
      type: Number,
      min: 2,
    },

    // NORMAL event
    formSchema: [formFieldSchema],
    formLocked: {
      type: Boolean,
      default: false,
    },

    // MERCH event
    items: [merchItemSchema],
  },
  { timestamps: true }
);

// Indexes
eventSchema.index({ organizerId: 1 });
eventSchema.index({ status: 1 });
eventSchema.index({ tags: 1 });
eventSchema.index({ title: "text" });

module.exports = mongoose.model("Event", eventSchema);

const mongoose = require("mongoose");

const merchOrderSchema = new mongoose.Schema(
  {
    sku: String,
    name: String,
    variant: {
      size: String,
      color: String,
    },
    quantity: Number,
    price: Number,
    amountPaid: Number,
    paymentStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
    paymentProof: String, // File path to uploaded image
    rejectionReason: String,
  },
  { _id: false }
);

const registrationSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },

    participantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
    },

    type: {
      type: String,
      enum: ["NORMAL", "MERCH"],
      default: "NORMAL",
    },

    status: {
      type: String,
      enum: ["PENDING", "CONFIRMED", "REJECTED", "CANCELLED"],
      default: "CONFIRMED",
    },

    ticketId: {
      type: String,
      unique: true,
      required: true,
    },

    qrPayload: String,
    qrCodeUrl: String, // Path to QR code image file

    attended: { type : Boolean, default: false },
    attendedAt : Date,

    // NORMAL events
    formResponse: mongoose.Schema.Types.Mixed,

    // MERCH events
    order: merchOrderSchema,
  },
  { timestamps: true }
);

// Indexes
registrationSchema.index({ participantId: 1 });
registrationSchema.index({ eventId: 1 });
registrationSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Registration", registrationSchema);

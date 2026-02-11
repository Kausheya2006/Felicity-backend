const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true,
    index: true
  },
  participantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    trim: true,
    maxlength: 2000
  },
  isAnonymous: {
    type: Boolean,
    default: true
  },
  attendedEvent: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Compound index to ensure one feedback per participant per event
feedbackSchema.index({ eventId: 1, participantId: 1 }, { unique: true });

// Index for queries
feedbackSchema.index({ eventId: 1, rating: 1 });
feedbackSchema.index({ eventId: 1, createdAt: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);

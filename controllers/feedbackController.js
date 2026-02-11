const Feedback = require("../models/Feedback");
const Event = require("../models/Event");
const Registration = require("../models/Registration");

// Submit feedback for an event
exports.submitFeedback = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { rating, comment, isAnonymous } = req.body;
    const participantId = req.user.id;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Check if user attended the event
    const registration = await Registration.findOne({
      eventId,
      participantId,
      status: { $in: ["CONFIRMED", "CHECKED_IN"] }
    });

    if (!registration) {
      return res.status(403).json({ 
        message: "You must be registered for this event to submit feedback" 
      });
    }

    // Check if feedback already exists
    const existingFeedback = await Feedback.findOne({ eventId, participantId });
    if (existingFeedback) {
      return res.status(400).json({ 
        message: "You have already submitted feedback for this event" 
      });
    }

    // Create feedback
    const feedback = await Feedback.create({
      eventId,
      participantId,
      rating,
      comment: comment?.trim() || "",
      isAnonymous: isAnonymous !== false, // Default to true
      attendedEvent: registration.status === "CHECKED_IN"
    });

    res.status(201).json({ 
      message: "Feedback submitted successfully",
      feedback: {
        _id: feedback._id,
        rating: feedback.rating,
        comment: feedback.comment,
        createdAt: feedback.createdAt
      }
    });
  } catch (error) {
    console.error("Submit feedback error:", error);
    res.status(500).json({ message: "Failed to submit feedback", error: error.message });
  }
};

// Get feedback for an event (organizer only)
exports.getEventFeedback = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { rating, sortBy = "createdAt", order = "desc" } = req.query;
    const userId = req.user.id;

    // Check if event exists and user is the organizer
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (event.organizerId.toString() !== userId && req.user.role !== "admin") {
      return res.status(403).json({ message: "Unauthorized to view feedback" });
    }

    // Build query
    const query = { eventId };
    if (rating) {
      query.rating = parseInt(rating);
    }

    // Get feedback
    const sortOrder = order === "asc" ? 1 : -1;
    const sortOptions = { [sortBy]: sortOrder };

    const feedbackList = await Feedback.find(query)
      .populate("participantId", "email participantProfile.name")
      .sort(sortOptions)
      .lean();

    // Anonymize if needed
    const anonymizedFeedback = feedbackList.map(fb => ({
      _id: fb._id,
      rating: fb.rating,
      comment: fb.comment,
      attendedEvent: fb.attendedEvent,
      createdAt: fb.createdAt,
      participant: fb.isAnonymous ? null : {
        name: fb.participantId?.participantProfile?.name || "Unknown",
        email: fb.participantId?.email
      }
    }));

    res.json({ 
      count: anonymizedFeedback.length,
      feedback: anonymizedFeedback 
    });
  } catch (error) {
    console.error("Get feedback error:", error);
    res.status(500).json({ message: "Failed to retrieve feedback", error: error.message });
  }
};

// Get feedback statistics for an event
exports.getFeedbackStats = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    // Check if event exists and user is the organizer
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (event.organizerId.toString() !== userId && req.user.role !== "admin") {
      return res.status(403).json({ message: "Unauthorized to view statistics" });
    }

    // Aggregate statistics
    const stats = await Feedback.aggregate([
      { $match: { eventId: event._id } },
      {
        $group: {
          _id: null,
          totalFeedback: { $sum: 1 },
          averageRating: { $avg: "$rating" },
          rating1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
          rating2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
          rating3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
          rating4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
          rating5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } }
        }
      }
    ]);

    if (stats.length === 0) {
      return res.json({
        totalFeedback: 0,
        averageRating: 0,
        ratingDistribution: {
          1: 0,
          2: 0,
          3: 0,
          4: 0,
          5: 0
        }
      });
    }

    const result = stats[0];
    res.json({
      totalFeedback: result.totalFeedback,
      averageRating: parseFloat(result.averageRating.toFixed(2)),
      ratingDistribution: {
        1: result.rating1,
        2: result.rating2,
        3: result.rating3,
        4: result.rating4,
        5: result.rating5
      }
    });
  } catch (error) {
    console.error("Get feedback stats error:", error);
    res.status(500).json({ message: "Failed to retrieve statistics", error: error.message });
  }
};

// Export feedback data (CSV format)
exports.exportFeedback = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    // Check if event exists and user is the organizer
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (event.organizerId.toString() !== userId && req.user.role !== "admin") {
      return res.status(403).json({ message: "Unauthorized to export feedback" });
    }

    // Get all feedback
    const feedbackList = await Feedback.find({ eventId })
      .populate("participantId", "email participantProfile.name")
      .sort({ createdAt: -1 })
      .lean();

    // Generate CSV
    const csvRows = [];
    csvRows.push("Date,Rating,Comment,Participant,Attended");

    feedbackList.forEach(fb => {
      const date = new Date(fb.createdAt).toISOString().split('T')[0];
      const participantName = fb.isAnonymous 
        ? "Anonymous" 
        : (fb.participantId?.participantProfile?.name || fb.participantId?.email || "Unknown");
      const comment = (fb.comment || "").replace(/"/g, '""'); // Escape quotes
      const attended = fb.attendedEvent ? "Yes" : "No";
      
      csvRows.push(`"${date}",${fb.rating},"${comment}","${participantName}","${attended}"`);
    });

    const csv = csvRows.join('\n');

    // Set headers for download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="feedback-${eventId}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error("Export feedback error:", error);
    res.status(500).json({ message: "Failed to export feedback", error: error.message });
  }
};

// Check if participant has submitted feedback
exports.checkFeedbackStatus = async (req, res) => {
  try {
    const { eventId } = req.params;
    const participantId = req.user.id;

    const feedback = await Feedback.findOne({ eventId, participantId });
    
    res.json({ 
      hasSubmitted: !!feedback,
      feedback: feedback ? {
        rating: feedback.rating,
        comment: feedback.comment,
        createdAt: feedback.createdAt
      } : null
    });
  } catch (error) {
    console.error("Check feedback status error:", error);
    res.status(500).json({ message: "Failed to check feedback status", error: error.message });
  }
};

// Update feedback (within 24 hours)
exports.updateFeedback = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { rating, comment } = req.body;
    const participantId = req.user.id;

    const feedback = await Feedback.findOne({ eventId, participantId });
    
    if (!feedback) {
      return res.status(404).json({ message: "Feedback not found" });
    }

    // Check if feedback is within 24 hours
    const hoursSinceCreation = (Date.now() - feedback.createdAt) / (1000 * 60 * 60);
    if (hoursSinceCreation > 24) {
      return res.status(403).json({ 
        message: "Feedback can only be updated within 24 hours of submission" 
      });
    }

    // Update feedback
    if (rating) {
      if (rating < 1 || rating > 5) {
        return res.status(400).json({ message: "Rating must be between 1 and 5" });
      }
      feedback.rating = rating;
    }
    
    if (comment !== undefined) {
      feedback.comment = comment.trim();
    }

    await feedback.save();

    res.json({ 
      message: "Feedback updated successfully",
      feedback: {
        _id: feedback._id,
        rating: feedback.rating,
        comment: feedback.comment,
        updatedAt: feedback.updatedAt
      }
    });
  } catch (error) {
    console.error("Update feedback error:", error);
    res.status(500).json({ message: "Failed to update feedback", error: error.message });
  }
};

const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');
const authMiddleware = require('../middleware/authMiddleware');
const allowRoles = require('../middleware/roleMiddleware');

// Participant routes
router.post(
  '/event/:eventId',
  authMiddleware,
  allowRoles('participant'),
  feedbackController.submitFeedback
);

router.get(
  '/event/:eventId/status',
  authMiddleware,
  allowRoles('participant'),
  feedbackController.checkFeedbackStatus
);

router.put(
  '/event/:eventId',
  authMiddleware,
  allowRoles('participant'),
  feedbackController.updateFeedback
);

// Organizer routes
router.get(
  '/event/:eventId',
  authMiddleware,
  allowRoles('organizer', 'admin'),
  feedbackController.getEventFeedback
);

router.get(
  '/event/:eventId/stats',
  authMiddleware,
  allowRoles('organizer', 'admin'),
  feedbackController.getFeedbackStats
);

router.get(
  '/event/:eventId/export',
  authMiddleware,
  allowRoles('organizer', 'admin'),
  feedbackController.exportFeedback
);

module.exports = router;

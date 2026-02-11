const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const allowRoles = require('../middleware/roleMiddleware');
const participantController = require('../controllers/participantController');
const { uploadPaymentProof } = require('../config/multer');

router.use(authMiddleware, allowRoles('participant'));

// Registrations
router.get('/registrations', participantController.getMyRegistrations);
router.delete('/registrations/:id', participantController.cancelRegistration);
router.post('/registrations/:id/payment-proof', uploadPaymentProof.single('paymentProof'), participantController.uploadPaymentProof);

// Profile
router.get('/profile', participantController.getProfile);
router.put('/profile', participantController.updateProfile);
router.put('/change-password', participantController.changePassword);

// Organizers
router.get('/organizers', participantController.getAllOrganizers);
router.get('/organizers/:id', participantController.getOrganizerById);
router.get('/organizers/:id/events', participantController.getOrganizerEvents);
router.post('/organizers/:id/follow', participantController.followOrganizer);
router.delete('/organizers/:id/follow', participantController.unfollowOrganizer);
router.get('/followed-organizers', participantController.getFollowedOrganizers);

module.exports = router;
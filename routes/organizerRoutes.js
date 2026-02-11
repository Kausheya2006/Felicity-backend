const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const allowRoles = require('../middleware/roleMiddleware');
const organizerController = require('../controllers/organizerController');


router.use(authMiddleware, allowRoles('organizer'));

router.post('/events', organizerController.createEvent);
router.get('/events', organizerController.getMyEvents);
router.patch('/events/:id', organizerController.editEvent); // patch : partial update
router.post('/events/:id/publish', organizerController.publishEvent);
router.get('/events/:id/registrations', organizerController.getEventRegistrations);
router.post('/events/:id/checkin', organizerController.checkIn);

router.patch('/events/:id/status', organizerController.changeEventStatus);
router.patch('/events/:id/published-edit', organizerController.editPublishedEvent);

router.get('/events/:id/analytics', organizerController.getEventAnalytics);
router.get('/events/:id/export', organizerController.exportRegistrations);

router.get('/events/:id/attendance', organizerController.getAttendanceList);

// Payment approvals for merchandise events
router.get('/events/:id/payment-approvals', organizerController.getPaymentApprovals);
router.post('/registrations/:id/approve-payment', organizerController.approvePayment);
router.post('/registrations/:id/reject-payment', organizerController.rejectPayment);

module.exports = router;
const express = require('express');
const router = express.Router();

const adminController = require('../controllers/adminController');
const allowRoles = require('../middleware/roleMiddleware');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware, allowRoles('admin'));

router.post('/create-organizer', adminController.createOrganizer);

router.get('/organizers', adminController.getAllOrganizers);
router.delete('/organizers/:id', adminController.removeOrganizer);

router.post('/organizers/:id/reset-password', adminController.resetOrganizerPassword);

///// more routes (for frontend) ////
router.get('/pending-organizers', adminController.getPendingOrganizers);
router.put('/approve-organizer/:id', adminController.approveOrganizer);
router.delete('/reject-organizer/:id', adminController.rejectOrganizer);
router.get('/statistics', adminController.getStatistics);

module.exports = router;
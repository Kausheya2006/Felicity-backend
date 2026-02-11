const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const allowRoles = require('../middleware/roleMiddleware');
const eventController = require('../controllers/eventController');

router.get('/', eventController.getAllEvents);
router.get('/trending', eventController.getTrendingEvents);
router.get('/:id', eventController.getEventById);

// only participants can register for events
router.post('/:id/register', authMiddleware, allowRoles('participant'), eventController.registerForEvent);
router.post('/:id/register-merch', authMiddleware, allowRoles('participant'), eventController.registerForMerchEvent);
module.exports = router;
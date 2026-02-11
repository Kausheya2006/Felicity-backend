const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/register-participant', authController.registerParticipant);
router.post('/login', authController.login);

// me : get user details using jwt token
router.get('/me', authMiddleware, authController.me);

module.exports = router;

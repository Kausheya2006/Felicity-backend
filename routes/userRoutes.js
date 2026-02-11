const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const userController = require('../controllers/userController');

router.use(authMiddleware);

router.get('/profile', userController.getProfile);
router.patch('/profile', userController.updateProfile);

router.post('/follow/:organizerId', userController.followClub);
router.delete('/unfollow/:organizerId', userController.unfollowClub);
router.get('/followed-clubs', userController.getFollowedClubs);

module.exports = router;
const User = require('../models/User');
const bcrypt = require('bcryptjs');

exports.getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');  // Exclude password
        
        if (!user) 
            return res.status(404).json({ message: 'User not found' });

        res.status(200).json({ user });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const updates = req.body;

        const user = await User.findById(userId);
        if (!user) 
            return res.status(404).json({ message: 'User not found' });

        delete updates.role;  // Prevent role update
        delete updates.email;
        delete updates.password;

        if (user.role === 'participant' && updates.participantProfile) {
            Object.keys(updates.participantProfile).forEach(key => {
                if (key !== 'participantType' && key !== 'collegeOrOrgName') { // dont allow these to change
                    user.participantProfile[key] = updates.participantProfile[key];
                }
            });
        }

        if (user.role === 'organizer' && updates.organizerProfile) {
            Object.keys(updates.organizerProfile).forEach(key => {
                user.organizerProfile[key] = updates.organizerProfile[key];
            });
        }

        await user.save();

        res.status(200).json({ message: 'Profile updated successfully', user});

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Follow an organizer (club)
exports.followClub = async (req, res) => {
    try {
        const userId = req.user.id;
        const { organizerId } = req.params;

        const user = await User.findById(userId);
        if (!user || user.role !== 'participant') 
            return res.status(403).json({ message: 'Only participants can follow clubs' });

        const organizer = await User.findById(organizerId);
        if (!organizer || organizer.role !== 'organizer') 
            return res.status(404).json({ message: 'Organizer not found' });
        
        // Initialize followedClubs if it doesn't exist
        if (!user.participantProfile.followedClubs) {
            user.participantProfile.followedClubs = [];
        }
        
        // Check if already following (convert to string for comparison)
        const alreadyFollowing = user.participantProfile.followedClubs.some(
            clubId => clubId.toString() === organizerId
        );
        
        if (alreadyFollowing) 
            return res.status(400).json({ message: 'Already following this club' });
        

        user.participantProfile.followedClubs.push(organizerId);
        await user.save();

        res.status(200).json({ message: 'Successfully followed club' });

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.unfollowClub = async (req, res) => {
    try {
        const userId = req.user.id;
        const { organizerId } = req.params;

        const user = await User.findById(userId);
        if (!user || user.role !== 'participant') 
            return res.status(403).json({ message: 'Only participants can unfollow clubs' });

        // Initialize followedClubs if it doesn't exist
        if (!user.participantProfile.followedClubs) {
            user.participantProfile.followedClubs = [];
        }

        user.participantProfile.followedClubs = user.participantProfile.followedClubs.filter(
            id => id.toString() !== organizerId
        );
        await user.save();

        res.status(200).json({ message: 'Successfully unfollowed club' });

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getFollowedClubs = async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findById(userId).populate({
            path: 'participantProfile.followedClubs',
            select: 'organizerProfile.name organizerProfile.category organizerProfile.description'
        });

        if (!user || user.role !== 'participant') 
            return res.status(403).json({ message: 'Only participants have followed clubs' });

        // Initialize followedClubs if it doesn't exist
        if (!user.participantProfile.followedClubs) {
            user.participantProfile.followedClubs = [];
        }

        res.status(200).json({ 
            followedClubs: user.participantProfile.followedClubs 
        });

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
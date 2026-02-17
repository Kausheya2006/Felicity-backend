const Registration = require('../models/Registration');
const Event = require('../models/Event');
const User = require('../models/User');


exports.getMyRegistrations = async (req, res) => {
    try {
        const userId = req.user.id;

        const registraions = await Registration.find({ participantId: userId })
                                .populate({
                                    path : 'eventId',
                                    select : 'title description eventStartDate eventEndDate venue maxParticipants type',
                                    populate : {
                                        path : 'organizerId',
                                        select : 'organizerProfile.name organizerProfile.contactEmail'
                                    }
                                })
                                .sort({ createdAt : -1 }); // Most recent first

        res.status(200).json(registraions);

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
                   
exports.cancelRegistration = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params; // registration id

        const registration = await Registration.findById(id);
        if (!registration)
            return res.status(404).json({ message: 'Registration not found' });
        
        if (registration.participantId.toString() !== userId)
            return res.status(403).json({ message: 'Forbidden: You can only cancel your own registrations' });

        if (registration.status === 'CANCELLED')
            return res.status(400).json({ message: 'Registration is already cancelled' });

        // For merchandise orders with approved payment, prevent cancellation after approval
        if (registration.type === 'MERCH' && registration.order?.paymentStatus === 'APPROVED') {
            return res.status(400).json({ message: 'Cannot cancel approved merchandise orders. Please contact the organizer.' });
        }

        registration.status = 'CANCELLED';
        await registration.save();

        // Only restore stock for MERCH orders that had APPROVED payment (stock was decremented)
        if (registration.type === 'MERCH' && registration.order?.paymentStatus === 'APPROVED') {
            const event = await Event.findById(registration.eventId);
            if (event) {
                const item = event.items.find(i => i.sku === registration.order.sku);

                if (item) {
                    const variant = item.variants.find(v => 
                        v.size === registration.order.variant.size && 
                        v.color === registration.order.variant.color
                    );
                    if (variant) {
                        variant.stock += registration.order.quantity;
                        await event.save();
                    }
                }
            }
        }

        res.status(200).json({ message: 'Registration cancelled successfully', registration });

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message })
    };
};

exports.getProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId).select('-password');
        
        if (!user)
            return res.status(404).json({ message: 'User not found' });

        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { firstname, lastname, contactNumber, college, interests, followedClubs } = req.body;

        const user = await User.findById(userId);
        if (!user)
            return res.status(404).json({ message: 'User not found' });

        // Update participant profile fields
        if (firstname !== undefined) user.participantProfile.firstname = firstname;
        if (lastname !== undefined) user.participantProfile.lastname = lastname;
        if (contactNumber !== undefined) user.participantProfile.contactNumber = contactNumber;
        if (college !== undefined) user.participantProfile.college = college;
        if (interests !== undefined) user.participantProfile.interests = interests;
        if (followedClubs !== undefined) user.participantProfile.followedClubs = followedClubs;

        await user.save();

        res.status(200).json({ message: 'Profile updated successfully', user: user });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword)
            return res.status(400).json({ message: 'Current and new passwords are required' });

        const user = await User.findById(userId);
        if (!user)
            return res.status(404).json({ message: 'User not found' });

        // Verify current password using bcrypt
        const bcrypt = require('bcryptjs');
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch)
            return res.status(400).json({ message: 'Current password is incorrect' });

        // Hash and set new password
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        res.status(200).json({ message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getAllOrganizers = async (req, res) => {
    try {
        const organizers = await User.find({ 
            role: 'organizer',
            isVerified: true,
        }).select('email organizerProfile');

        res.status(200).json({ organizers });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getOrganizerById = async (req, res) => {
    try {
        const { id } = req.params;

        const organizer = await User.findOne({ 
            _id: id,
            role: 'organizer',
            isVerified: true,
        }).select('email organizerProfile');

        if (!organizer)
            return res.status(404).json({ message: 'Organizer not found' });

        res.status(200).json(organizer);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getOrganizerEvents = async (req, res) => {
    try {
        const { id } = req.params;
        const now = new Date();

        const upcoming = await Event.find({ 
            organizerId: id,
            status: 'PUBLISHED',
            eventStartDate: { $gte: now }
        }).sort({ eventStartDate: 1 });

        const past = await Event.find({ 
            organizerId: id,
            status: 'PUBLISHED',
            eventStartDate: { $lt: now }
        }).sort({ eventStartDate: -1 });

        res.status(200).json({ upcoming, past });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.followOrganizer = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params; // organizer id

        console.log('Follow request - User:', userId, 'Organizer:', id);

        const user = await User.findById(userId);
        if (!user)
            return res.status(404).json({ message: 'User not found' });

        console.log('User found:', user.email);

        // Check if user is a participant
        if (!user.participantProfile) {
            return res.status(400).json({ message: 'User is not a participant' });
        }

        const organizer = await User.findOne({ 
            _id: id,
            role: 'organizer',
            isVerified: true,
        });
        if (!organizer)
            return res.status(404).json({ message: 'Organizer not found' });

        console.log('Organizer found:', organizer.organizerProfile?.name);

        // Initialize followedClubs if it doesn't exist
        if (!user.participantProfile.followedClubs) {
            user.participantProfile.followedClubs = [];
        }

        console.log('Current followed clubs:', user.participantProfile.followedClubs);

        // Check if already following (convert to string for comparison)
        const alreadyFollowing = user.participantProfile.followedClubs.some(
            clubId => clubId.toString() === id
        );

        if (!alreadyFollowing) {
            user.participantProfile.followedClubs.push(id);
            await user.save();
            console.log('Successfully followed. New list:', user.participantProfile.followedClubs);
        } else {
            console.log('Already following this organizer');
        }

        res.status(200).json({ message: 'Followed successfully' });
    } catch (error) {
        console.error('Follow error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.unfollowOrganizer = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params; // organizer id

        const user = await User.findById(userId);
        if (!user)
            return res.status(404).json({ message: 'User not found' });

        // Initialize followedClubs if it doesn't exist
        if (!user.participantProfile.followedClubs) {
            user.participantProfile.followedClubs = [];
        }

        user.participantProfile.followedClubs = user.participantProfile.followedClubs.filter(
            clubId => clubId.toString() !== id
        );
        await user.save();

        res.status(200).json({ message: 'Unfollowed successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getFollowedOrganizers = async (req, res) => {
    try {
        const userId = req.user.id;

        let user = await User.findById(userId);

        if (!user)
            return res.status(404).json({ message: 'User not found' });

        // Initialize followedClubs if it doesn't exist
        if (!user.participantProfile.followedClubs) {
            user.participantProfile.followedClubs = [];
            await user.save();
        }

        // Now populate the followedClubs
        user = await User.findById(userId).populate({
            path: 'participantProfile.followedClubs',
            select: 'email organizerProfile'
        });

        // Filter out any null values (in case some organizers were deleted)
        const followedOrganizers = (user.participantProfile.followedClubs || []).filter(club => club !== null);

        res.status(200).json({ followedOrganizers });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Upload payment proof for merchandise order
exports.uploadPaymentProof = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params; // registration ID

        if (!req.file) {
            return res.status(400).json({ message: 'Payment proof image is required' });
        }

        const registration = await Registration.findById(id);
        if (!registration) {
            return res.status(404).json({ message: 'Registration not found' });
        }

        if (registration.participantId.toString() !== userId) {
            return res.status(403).json({ message: 'Forbidden: You can only upload payment proof for your own orders' });
        }

        if (registration.type !== 'MERCH') {
            return res.status(400).json({ message: 'Payment proof is only required for merchandise orders' });
        }

        if (registration.order.paymentStatus === 'APPROVED') {
            return res.status(400).json({ message: 'Payment has already been approved' });
        }

        // Store file path instead of base64
        const filePath = `/uploads/payments/${req.file.filename}`;
        registration.order.paymentProof = filePath;
        registration.order.paymentStatus = 'PENDING';
        await registration.save();

        res.status(200).json({ 
            message: 'Payment proof uploaded successfully. Your order is now pending approval.', 
            registration 
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
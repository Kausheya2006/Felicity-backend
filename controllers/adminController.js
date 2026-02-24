const User = require('../models/User');
const Event = require('../models/Event');
const Registration = require('../models/Registration');
const bcrypt = require('bcryptjs');

exports.createOrganizer = async (req, res) => {
    try {
        const { email, password, name, category, description, contactEmail, contactNumber} = req.body;

        console.log('=== createOrganizer called ===');
        console.log('Request body:', { email, name, category, contactEmail });

        if (!email || !password || !name || !contactEmail || !category)
            return res.status(400).json({ message: 'Email, Password, Name, Category and Contact Email are required' });

        const existingUser = await User.findOne({ email });
        if (existingUser)
            return res.status(400).json({ message: 'User with this email already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const organizer = await User.create({
            email,
            password: hashedPassword,
            role: 'organizer',
            isVerified: true,
            organizerProfile: {
                name,
                category,
                description: description || '',
                contactEmail,
                contactNumber: contactNumber || '',
            }
        });

        console.log('Organizer created successfully:', {
            id: organizer._id,
            email: organizer.email,
            role: organizer.role,
            name: organizer.organizerProfile?.name
        });

        res.status(201).json({ message: 'Organizer account created successfully', organizer });
    } catch (error) {
        console.error('Error in createOrganizer:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.removeOrganizer = async (req, res) => {
    try {
        const { id } = req.params;
        const { permanent } = req.query; // if permanent=true, delete permanently

        const organizer = await User.findById(id);
        if (!organizer || organizer.role !== 'organizer')
            return res.status(404).json({ message: 'Organizer not found' });

        if (permanent === 'true') {
            await User.findByIdAndDelete(id);
            return res.json({ message: 'Organizer deleted permanently' });
        } else {
            organizer.isActive = false;
            await organizer.save();
            return res.json({ message: 'Organizer deactivated successfully' });
        }
    
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getAllOrganizers = async (req, res) => {
    try {
        console.log('=== getAllOrganizers called ===');
        console.log('Request user:', req.user);
        
        // Check total users in DB
        const totalUsers = await User.countDocuments();
        console.log('Total users in DB:', totalUsers);
        
        // Check users by role
        const roleCount = await User.aggregate([
            { $group: { _id: '$role', count: { $sum: 1 } } }
        ]);
        console.log('Users by role:', roleCount);
        
        const organizers = await User.find({ role: 'organizer' })
                                .select('-password')
                                .sort({createdAt : -1}); // Most recent first
        
        console.log('Found organizers:', organizers.length);
        if (organizers.length > 0) {
            console.log('First organizer:', {
                email: organizers[0].email,
                role: organizers[0].role,
                name: organizers[0].organizerProfile?.name
            });
        }
        
        res.status(200).json({ count: organizers.length, organizers });
    } catch (error) {
        console.error('Error in getAllOrganizers:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.resetOrganizerPassword = async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;
        
        if (!newPassword)
            return res.status(400).json({ message: 'New password is required' });

        const organizer = await User.findById(id);
        if (!organizer || organizer.role !== 'organizer')
            return res.status(404).json({ message: 'Organizer not found' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        organizer.password = hashedPassword;
        await organizer.save();

        res.status(200).json({ message: 'Password reset successfully' });

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};


//// extra routes (for frontend) ////

exports.getPendingOrganizers = async (req, res) => {
    try {
        const pendingOrganizers = await User.find({ role: 'organizer', isVerified: false })
                                        .select('-password')

        res.status(200).json(pendingOrganizers);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.approveOrganizer = async (req, res) => {    
    try {
        const { id } = req.params;

        const organizer = await User.findByIdAndUpdate(
            id, 
            { 
                isVerified: true
            }, 
            { new: true }
        ); // new : return updated doc

        if (!organizer || organizer.role !== 'organizer')
            return res.status(404).json({ message: 'Organizer not found' });

        res.status(200).json({ message: 'Organizer approved successfully', organizer });
     } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.rejectOrganizer = async (req, res) => {    
    try {
        const { id } = req.params;

        const organizer = await User.findByIdAndDelete(id);

        if (!organizer || organizer.role !== 'organizer')
            return res.status(404).json({ message: 'Organizer not found' });

        res.status(200).json({ message: 'Organizer rejected and deleted successfully' });
     } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getStatistics = async (req, res) => {
    try {
        const totalOrganizers = await User.countDocuments({ role: 'organizer' });
        const verifiedOrganizers = await User.countDocuments({ role: 'organizer', isVerified: true });
        const pendingOrganizers = await User.countDocuments({ role: 'organizer', isVerified: false });
        const totalEvents = await Event.countDocuments();
        const totalParticipants = await User.countDocuments({ role: 'participant' });
        const totalRegistrations = await Registration.countDocuments();

        res.status(200).json({
            totalOrganizers,
            verifiedOrganizers,
            pendingOrganizers,
            totalEvents,
            totalParticipants,
            totalRegistrations
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.reactivateOrganizer = async (req, res) => {
    try {
        const { organizerId } = req.params;

        const organizer = await User.findById(organizerId);
        if (!organizer || organizer.role !== 'organizer') {
            return res.status(404).json({ message: 'Organizer not found' });
        }

        if (organizer.isActive) {
            return res.status(400).json({ message: 'Organizer is already active' });
        }

        organizer.isActive = true;
        await organizer.save();

        res.status(200).json({ message: 'Organizer reactivated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
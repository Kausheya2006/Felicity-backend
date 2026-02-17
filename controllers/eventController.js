const Event = require('../models/Event');
const Registration = require('../models/Registration');
const User = require('../models/User');
const crypto = require('crypto');
const { createNotification } = require('./notificationController');
const { sendTicketEmail } = require('../config/mailer');

exports.getAllEvents = async (req, res) => {
    try {
        // Extract query parameters for filtering
        const { category, eligibility, tags, search, type } = req.query;
        
        // Build filter object
        const filter = { status: 'PUBLISHED' };
        
        if (type) {
            filter.type = type;
        }
        
        if (eligibility) {
            filter.eligibility = { $in: eligibility.split(',') };
        }
        
        if (tags) {
            filter.tags = { $in: tags.split(',') };
        }
        
        // Text search on title
        if (search) {
            filter.$text = { $search: search };
        }
        
        let query = Event.find(filter)
            .populate('organizerId', 'organizerProfile.name organizerProfile.category organizerProfile.contactEmail');
        
        // If category filter, match on organizer's category
        if (category) {
            query = query.where('organizerId').exists(true);
        }
        
        const events = await query.sort({ eventStartDate: 1 });
        
        // Filter by organizer category if needed (post-query filter)
        let filteredEvents = events;
        if (category) {
            filteredEvents = events.filter(event => 
                event.organizerId && event.organizerId.organizerProfile.category === category
            );
        }

        res.json({ count: filteredEvents.length, events: filteredEvents });

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getEventById = async (req, res) => {
    try {
        const {id} = req.params;

        const event = await Event.findById(id)
            .populate('organizerId', 'organizerProfile.name organizerProfile.contactEmail');

        if (!event)
            return res.status(404).json({ message: 'Event not found' });

        if (event.status !== 'PUBLISHED')
            return res.status(403).json({ message: 'Forbidden: Event is not published' });

        res.json(event);

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.registerForEvent = async (req, res) => {
    try {
        const {id} = req.params; // event ID
        const userId = req.user.id;
        const {formData} = req.body; // Additional form data if any

        const event = await Event.findById(id);
        if (!event)
            return res.status(404).json({ message: 'Event not found' });

        if (event.status !== 'PUBLISHED')
            return res.status(403).json({ message: 'Forbidden: Event is not published' });

        // Check if event requires team registration
        if (event.allowTeams) {
            return res.status(400).json({ 
                message: 'This event requires team registration. Please create or join a team first.' 
            });
        }

        // Check registration deadline or event start date
        if (event.registrationDeadline && new Date() > new Date(event.registrationDeadline))
            return res.status(400).json({ message: 'Registration deadline has passed' });
        
        // If no deadline set, registrations close when event starts
        if (!event.registrationDeadline && event.eventStartDate && new Date() > new Date(event.eventStartDate))
            return res.status(400).json({ message: 'Event has already started - registrations closed' });

        const existingRegistration = await Registration.findOne({ eventId: id, participantId: userId });

        if (existingRegistration)
            return res.status(400).json({ message: 'You have already registered for this event' });

        const registrationCount = await Registration.countDocuments({ eventId: id , status : {$ne : 'CANCELLED'} }); // Count only non-cancelled registrations

        if (event.maxParticipants && registrationCount >= event.maxParticipants)
            return res.status(400).json({ message: 'Event has reached maximum participant limit' });

        if (event.eligibility && event.eligibility.length > 0) { 
            const participant = await User.findById(userId);

            if (!event.eligibility.includes(participant.participantProfile.participantType)) 
                return res.status(403).json({ message: 'You do not meet the eligibility criteria for this event' });
        }

        const ticketId = crypto.randomUUID(); // Generate unique ticket ID

        const qrPayload = JSON.stringify({
            registrationId: ticketId,
            eventId: id,
            participantId: userId,
            timestamp : new Date().toISOString(),
        });

        const registration = new Registration({
            eventId: id,
            participantId: userId,
            type: event.type, // 'NORMAL' or 'MERCH'
            ticketId,
            qrPayload,
            formResponse: formData || {},
            status : 'CONFIRMED',
        });

        await registration.save();

        const regCount = await Registration.countDocuments({ eventId: id });
        if (regCount === 1 && !event.formLocked){
            event.formLocked = true;
            await event.save();
        }

        // Send notification to participant
        await createNotification(
            userId,
            "REGISTRATION",
            `Registration Confirmed`,
            `You've successfully registered for ${event.title}`,
            id,
            null,
            null,
            `/events/${id}`
        );

        // Notify organizer of new registration
        await createNotification(
            event.organizerId,
            "REGISTRATION",
            `New Registration`,
            `Someone registered for ${event.title}`,
            id,
            null,
            null,
            `/organizer/events/${id}`
        );

        // Send ticket email to participant (non-blocking)
        const participant = await User.findById(userId);
        if (participant) {
            const participantName = participant.participantProfile
                ? `${participant.participantProfile.firstname || ''} ${participant.participantProfile.lastname || ''}`.trim()
                : '';
            sendTicketEmail({
                to: participant.email,
                participantName,
                eventTitle: event.title,
                eventDate: event.eventStartDate,
                venue: event.venue,
                ticketId,
                qrPayload,
            });
        }

        res.status(201).json({ message: 'Registered successfully', registration });

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.registerForMerchEvent = async (req, res) => {
    try {
        const {id} = req.params; // event ID
        const userId = req.user.id;
        const {order} = req.body; // Additional form data if any

        const event = await Event.findById(id);
        if (!event)
            return res.status(404).json({ message: 'Event not found' });

        if (event.status !== 'PUBLISHED')
            return res.status(403).json({ message: 'Forbidden: Event is not published' });

        if (event.type !== 'MERCH')
            return res.status(400).json({ message: 'This event is not a merchandise event' });

        // Check if registration is closed (deadline OR event start date)
        const now = new Date();
        const effectiveDeadline = event.registrationDeadline || event.eventStartDate;
        if (effectiveDeadline && now > new Date(effectiveDeadline))
            return res.status(400).json({ message: 'Registration deadline has passed' });

        const existingRegistration = await Registration.findOne({ eventId: id, participantId: userId });
        if (existingRegistration)
            return res.status(400).json({ message: 'You have already registered for this event' });

        // If no order provided, allow registration without merchandise purchase
        if (!order || !order.sku) {
            return res.status(400).json({ message: 'Order details are required for merchandise events' });
        }

        const item = event.items.find(i => i.sku === order.sku);  // Validate selected item by SKU
        if (!item)
            return res.status(400).json({ message: 'Invalid item selected' });

        const variant = item.variants.find(v => 
            v.size === order.variant.size && 
            v.color === order.variant.color
        );
        if (!variant)
            return res.status(400).json({ message: 'Invalid variant selected' });

        if (variant.stock < order.quantity)
            return res.status(400).json({ message: 'Selected quantity exceeds available stock' });

        if (item.purchaseLimitPerUser && order.quantity > item.purchaseLimitPerUser)
            return res.status(400).json({ message: `You can only purchase up to ${item.purchaseLimitPerUser} units of this item` });

        // Don't decrement stock yet - will happen on payment approval
        // variant.stock -= order.quantity;
        // await event.save();

        // create registration
        const ticketId = crypto.randomUUID(); // Generate unique ticket ID
        
        // Don't generate QR yet - will happen on payment approval
        const qrPayload = null;

        const amountPaid = event.fee ? event.fee * order.quantity : 0; // total amount

        const registration = await Registration.create({
            eventId : id,
            participantId : userId,
            type : 'MERCH',
            ticketId,
            qrPayload,
            status : 'PENDING', // Pending until payment approved
            order : {
                sku: item.sku,
                name: order.name || item.name,
                variant: {
                    size: order.variant.size,
                    color: order.variant.color
                },
                quantity: order.quantity,
                price: order.price || event.fee || 0,
                amountPaid,
                paymentStatus: 'PENDING' // Changed to PENDING
            }
        })
        res.status(201).json({ 
            message: 'Merchandise order placed successfully. Please upload payment proof to complete your order.', 
            registration 
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getTrendingEvents = async (req, res) => {
    try {
        const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const trending = await Registration.aggregate([
            { $match: { createdAt: {$gte: last24h}}},
            { $group: { _id : '$eventId', count: { $sum: 1 } }},
            { $sort: { count: -1 }},
            { $limit: 5 },
        ]); // Top 5 events in last 24 hours

        const eventIds = trending.map(t => t._id);

        const events = await Event.find({ _id: { $in: eventIds }, status: 'PUBLISHED' })
                            .populate('organizerId', 'organizerProfile.name');

        const eventsWithCount = events.map(event => {
            const trendData = trending.find(t => t._id.toString() === event._id.toString());
            return {
                ...event.toObject(),  // convert mongoose doc to plain object
                registrationCount : trendData ? trendData.count : 0
            };
        });

        res.status(200).json({ events: eventsWithCount });

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message })     
    };
};

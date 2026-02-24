const Event = require('../models/Event');
const Registration = require('../models/Registration');
const User = require('../models/User');
const { createNotification } = require('./notificationController');
const { sendTicketEmail } = require('../config/mailer');

exports.createEvent = async (req, res) => {
    try {
        const { 
            title, 
            description, 
            type, 
            eventStartDate, 
            eventEndDate, 
            venue, 
            maxParticipants, 
            registrationDeadline, 
            eligibility, 
            fee,
            merchandiseFee,
            tags,
            formSchema,
            items,
            allowTeams,
            minTeamSize,
            maxTeamSize
        } = req.body;

        if (!title || !eventStartDate)
            return res.status(400).json({ message: 'Title and Event Start Date are required' });

        if (eventEndDate && new Date(eventEndDate) < new Date(eventStartDate))
            return res.status(400).json({ message: 'Event End Date must be after Event Start Date' });

        if (registrationDeadline && eventEndDate && new Date(registrationDeadline) > new Date(eventEndDate))
            return res.status(400).json({ message: 'Registration Deadline must be before or on the Event End Date' });

        const eventData = {
            title,
            description,
            type: type || 'NORMAL',
            eventStartDate,
            eventEndDate,
            venue,
            maxParticipants,
            eligibility: eligibility || [],
            fee: fee || 0,
            merchandiseFee: merchandiseFee || 0,
            tags: tags || [],
            organizerId: req.user.id,   
            status: 'DRAFT',
        };

        // Only add registrationDeadline if it's provided and not empty
        if (registrationDeadline) {
            eventData.registrationDeadline = registrationDeadline;
        }

        // Add team registration fields
        if (allowTeams) {
            eventData.allowTeams = true;
            eventData.minTeamSize = parseInt(minTeamSize) || 2;
            eventData.maxTeamSize = parseInt(maxTeamSize) || 4;
        }

        // Add type-specific fields
        if (type === 'NORMAL') {
            eventData.formSchema = formSchema || [];
        } else if (type === 'MERCH') {
            eventData.items = items || [];
        }

        const event = await Event.create(eventData);

        res.status(201).json({ message: 'Event created successfully', event });

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.editEvent = async (req, res) => {
    try {
        const {id} = req.params;
        const updates = req.body;

        const event = await Event.findById(id);
        if (!event)
            return res.status(404).json({ message: 'Event not found' });

        if (event.organizerId.toString() !== req.user.id)
            return res.status(403).json({ message: 'Forbidden: You are not the organizer of this event' });

        // Define allowed fields based on event status
        let allowedFields = [];
        
        if (event.status === 'DRAFT') {
            // Draft events: full edit access (except status and organizer)
            allowedFields = ['title', 'description', 'type', 'eventStartDate', 'eventEndDate', 
                           'venue', 'maxParticipants', 'registrationDeadline', 'eligibility', 
                           'fee', 'merchandiseFee', 'tags', 'formSchema', 'items', 'allowTeams', 'minTeamSize', 'maxTeamSize'];
        } else if (event.status === 'PUBLISHED') {
            // Published events: limited edit (description, extend deadline, increase limit)
            allowedFields = ['description', 'registrationDeadline', 'maxParticipants'];
            
            // Validate maxParticipants can only increase
            if (updates.maxParticipants && event.maxParticipants && 
                parseInt(updates.maxParticipants) < event.maxParticipants) {
                return res.status(400).json({ message: 'Cannot decrease participant limit for published events' });
            }
        }

        // Validate registrationDeadline against event end date (applies to all statuses)
        if (updates.registrationDeadline) {
            const deadlineDate = new Date(updates.registrationDeadline);
            const endDate = updates.eventEndDate ? new Date(updates.eventEndDate) : event.eventEndDate;
            if (endDate && deadlineDate > endDate) {
                return res.status(400).json({ message: 'Registration Deadline must be before or on the Event End Date' });
            }
        } else if (['ONGOING', 'COMPLETED', 'CLOSED'].includes(event.status)) {
            // Ongoing/Completed/Closed: no edits allowed
            return res.status(400).json({ message: `Cannot edit ${event.status.toLowerCase()} events` });
        } else if (event.status === 'CANCELLED') {
            return res.status(400).json({ message: 'Cannot edit cancelled events' });
        }

        if (event.formLocked && updates.formSchema)
            return res.status(400).json({ message: 'Form schema is locked and cannot be edited' });
        
        // Clean up empty strings and undefined values from updates, filter by allowed fields
        const cleanedUpdates = {};
        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key) && updates[key] !== '' && updates[key] !== undefined) {
                cleanedUpdates[key] = updates[key];
            }
        });
        
        // Apply cleaned updates to event
        Object.assign(event, cleanedUpdates);

        await event.save();
        
        res.json({ message: 'Event updated successfully', event });

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }};

exports.publishEvent = async (req, res) => {
    try {
        const {id} = req.params;

        const event = await Event.findById(id);
        if (!event)
            return res.status(404).json({ message: 'Event not found' });

        if (event.organizerId.toString() !== req.user.id)
            return res.status(403).json({ message: 'Forbidden: You are not the organizer of this event' });

        if (event.status == 'PUBLISHED')
            return res.status(400).json({ message: 'Event is already published' });

        if (!event.title || !event.eventStartDate)
            return res.status(400).json({ message: 'Title and Event Start Date are required to publish the event' });

        // Additional validation for MERCH events
        if (event.type === 'MERCH' && (!event.items || event.items.length === 0))
            return res.status(400).json({ message: 'Merchandise events must have at least one item' });

        event.status = 'PUBLISHED';
        await event.save();

        // Post to Discord webhook if configured
        try {
            const organizer = await User.findById(req.user.id);
            if (organizer && organizer.organizerProfile && organizer.organizerProfile.discordWebhook) {
                const webhookUrl = organizer.organizerProfile.discordWebhook;
                
                // Format the Discord message
                const discordMessage = {
                    embeds: [{
                        title: `🎉 New Event: ${event.title}`,
                        description: event.description || 'No description provided',
                        color: 0x5865F2, // Discord blurple color
                        fields: [
                            {
                                name: '📅 Start Date',
                                value: new Date(event.eventStartDate).toLocaleString('en-US', { 
                                    dateStyle: 'medium', 
                                    timeStyle: 'short' 
                                }),
                                inline: true
                            },
                            {
                                name: '📍 Venue',
                                value: event.venue || 'TBA',
                                inline: true
                            },
                            {
                                name: '🎫 Type',
                                value: event.type,
                                inline: true
                            },
                            {
                                name: 'Max Participants',
                                value: event.maxParticipants ? event.maxParticipants.toString() : 'Unlimited',
                                inline: true
                            },
                            {
                                name: '💰 Fee',
                                value: event.fee ? `₹${event.fee}` : 'Free',
                                inline: true
                            },
                            {
                                name: '🏷️ Tags',
                                value: event.tags && event.tags.length > 0 ? event.tags.join(', ') : 'None',
                                inline: true
                            }
                        ],
                        footer: {
                            text: `Organized by ${organizer.organizerProfile.name}`
                        },
                        timestamp: new Date().toISOString()
                    }]
                };

                // Send to Discord webhook
                const https = require('https');
                const url = new URL(webhookUrl);
                const postData = JSON.stringify(discordMessage);
                
                const options = {
                    hostname: url.hostname,
                    path: url.pathname + url.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                const req = https.request(options);
                req.write(postData);
                req.end();
            }
        } catch (discordError) {
            // Log Discord error but don't fail the publish operation
            console.error('Failed to post to Discord webhook:', discordError.message);
        }

        res.json({ message: 'Event published successfully', event });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getMyEvents = async (req, res) => {
    try {
        const events = await Event.find({ organizerId: req.user.id }).sort({createdAt : -1}); // Most recent first
        res.status(200).json(events);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getEventRegistrations = async (req, res) => {
    try {
        const {id} = req.params;

        const event = await Event.findById(id);
        if (!event)
            return res.status(404).json({ message: 'Event not found' });

        if (event.organizerId.toString() !== req.user.id)
            return res.status(403).json({ message: 'Forbidden: You are not the organizer of this event' });
        
        const registrations = await Registration.find({ eventId: id })
                                    .populate('participantId', 'email participantProfile')
                                    .sort({ createdAt : -1 }); // Most recent first

        res.status(200).json({ registrations, event });
        
    } catch (error) {     
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Check-in participant using QR code
exports.checkIn = async (req, res) => {
    try {
        const { id } = req.params; // event ID
        const { qrPayload } = req.body;

        if (!qrPayload) 
            return res.status(400).json({ message: 'QR payload is required' });

        const event = await Event.findById(id);
        if (!event) 
            return res.status(404).json({ message: 'Event not found' });

        if (event.organizerId.toString() !== req.user.id)
            return res.status(403).json({ message: 'Not your event' });

        // Parse and verify QR payload
        let payload;
        try {
            payload = JSON.parse(qrPayload);
        } catch (error) {
            return res.status(400).json({ message: 'Invalid QR payload format' });
        }

        // Find registration by ticketId
        const registration = await Registration.findOne({ 
            ticketId: payload.registrationId,
            eventId: id
        }).populate('participantId', 'email participantProfile');

        if (!registration) 
            return res.status(404).json({ message: 'Registration not found or invalid ticket' });
        

        if (registration.status === 'CANCELLED') 
            return res.status(400).json({ message: 'Registration has been cancelled' });

        if (!registration.attended) {
            registration.attended = true;
            registration.attendedAt = new Date();
            await registration.save();
        }

        res.status(200).json({
            message: registration.attended ? 'Already checked in' : 'Check-in successful',
            participant: {
                name: `${registration.participantId.participantProfile.firstname} ${registration.participantId.participantProfile.lastname}`,
                email: registration.participantId.email,
                ticketId: registration.ticketId,
                registeredAt: registration.createdAt,
                attended: registration.attended,
                attendedAt: registration.attendedAt
            }
        });

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.changeEventStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        console.log('changeEventStatus called:', { id, status, body: req.body });

        const event = await Event.findById(id);
        if (!event)
            return res.status(404).json({ message: 'Event not found' });

        if (event.organizerId.toString() !== req.user.id)
            return res.status(403).json({ message: 'Forbidden: You are not the organizer of this event' });
        
        const validStatus = ['ONGOING', 'CLOSED', 'COMPLETED', 'CANCELLED'];
        if (!validStatus.includes(status))
            return res.status(400).json({ message: 'Invalid status value' });

        event.status = status;
        await event.save();

        res.status(200).json({ message: `Event status changed to ${status}`, event });
    } catch (error) {
        console.error('changeEventStatus error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.editPublishedEvent = async (req, res) => {
    try {
        const {id} = req.params;
        const {description, registrationDeadline, maxParticipants} = req.body;

        const event = await Event.findById(id);
        if (!event)
            return res.status(404).json({ message: 'Event not found' });

        if (event.organizerId.toString() !== req.user.id)
            return res.status(403).json({ message: 'Forbidden: You are not the organizer of this event' });

        if (event.status === 'PUBLISHED') {
            if (description)
                event.description = description;
            if (registrationDeadline)
                event.registrationDeadline = registrationDeadline;
            if (maxParticipants && maxParticipants >= event.maxParticipants)
                event.maxParticipants = maxParticipants;
        } else if (event.status === 'ONGOING' || event.status === 'COMPLETED') 
            return res.status(400).json({ message: 'Cannot edit ONGOING or COMPLETED events' });
        
        await event.save();

        res.status(200).json({ message: 'Event updated successfully', event });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getEventAnalytics = async (req, res) => {
    try {
        const { id } = req.params;

        const event = await Event.findById(id);
        if (!event || event.organizerId.toString() !== req.user.id)
            return res.status(404).json({ message: 'Event not found' });

        const registrations = await Registration.find({ eventId: id });

        // Calculate total revenue from all registration types
        // Include: NORMAL events (event.fee), MERCH with merch (reg fee + merch fee), MERCH without merch (reg fee only)
        const totalRevenue = registrations
            .filter(r => r.status !== 'CANCELLED' && r.status !== 'REJECTED')
            .reduce((sum, r) => {
                if (r.order?.amountPaid && r.order?.paymentStatus === 'APPROVED') {
                    // MERCH type registrations with payment orders (includes both merch and registration-only)
                    return sum + r.order.amountPaid;
                } else if (r.type === 'NORMAL' && r.status === 'CONFIRMED') {
                    // NORMAL type confirmed registrations (event.fee)
                    return sum + (event.fee || 0);
                }
                return sum;
            }, 0);

        const analytics = {
            totalRegistrations: registrations.length,
            confirmedRegistrations: registrations.filter(r => r.status === 'CONFIRMED').length,
            cancelledRegistrations: registrations.filter(r => r.status === 'CANCELLED').length,
            pendingPayments: registrations.filter(r => r.status === 'PENDING').length,
            attended : registrations.filter(r => r.attended === true).length,
            attendanceRate : registrations.length > 0 ?
                ((registrations.filter(r => r.attended === true).length / registrations.length) * 100).toFixed(2) + '%' : '0%', // in percentage
            revenue : totalRevenue,
        };

        res.status(200).json({ eventId: id, analytics });

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.exportRegistrations = async (req, res) => {
    try {
        const { id } = req.params;

        const event = await Event.findById(id);
        if (!event || event.organizerId.toString() !== req.user.id)
            return res.status(404).json({ message: 'Event not found' });

        const registrations = await Registration.find({ eventId: id })
                                    .populate('participantId', 'email participantProfile')

        // Get custom form fields from event
        const customFields = event.formSchema || [];
        const customFieldIds = customFields.map(f => f.fieldId);
        const customFieldLabels = customFields.map(f => f.label);

        // Prepare CSV data with custom fields
        let csvHeaders = ['Name', 'Email', 'Registration Date', 'Status', 'Type', 'Attended', 'Attended At'];
        if (customFieldLabels.length > 0) {
            csvHeaders = csvHeaders.concat(customFieldLabels);
        }
        let csv = csvHeaders.map(h => `"${h}"`).join(',') + '\n';
        
        registrations.forEach(reg => {
            const name = `${reg.participantId.participantProfile.firstname} ${reg.participantId.participantProfile.lastname}`;
            const email = reg.participantId.email;
            const date = reg.createdAt.toISOString();
            const status = reg.status;
            const type = reg.type;
            const attended = reg.attended ? 'Yes' : 'No';
            const attendedAt = reg.attendedAt ? reg.attendedAt.toISOString() : 'N/A';
            
            let row = [name, email, date, status, type, attended, attendedAt];
            
            // Add custom field values
            if (customFieldIds.length > 0 && reg.formResponse) {
                customFieldIds.forEach(fieldId => {
                    const value = reg.formResponse[fieldId];
                    row.push(value !== undefined && value !== null ? String(value) : 'N/A');
                });
            } else if (customFieldIds.length > 0) {
                // Add N/A for each custom field if no formResponse
                customFieldIds.forEach(() => row.push('N/A'));
            }
            
            csv += row.map(r => `"${r}"`).join(',') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="event_${id}_registrations.csv"`);
        
        res.status(200).send(csv);  
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getAttendanceList = async (req, res) => {
    try {
        const { id } = req.params;

        const event = await Event.findById(id);
        if (!event || event.organizerId.toString() !== req.user.id)
            return res.status(404).json({ message: 'Event not found' });

        const attendees = await Registration.find({ eventId: id, attended: true })
                                    .populate('participantId', 'email participantProfile')
                                    .select('ticketId attendedAt participantId')
                                    .sort({ attendedAt : -1 }); // Most recent first

        res.status(200).json({ count: attendees.length, attendees });
    } catch (error) {          
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get payment approvals for an event
exports.getPaymentApprovals = async (req, res) => {
    try {
        const { id } = req.params; // event ID
        const { status } = req.query; // optional filter: PENDING, APPROVED, REJECTED

        const event = await Event.findById(id);
        if (!event)
            return res.status(404).json({ message: 'Event not found' });

        if (event.organizerId.toString() !== req.user.id)
            return res.status(403).json({ message: 'Forbidden: You are not the organizer of this event' });

        // Show payment approvals for any registration that has an order (both merch and registration-fee)
        const filter = { eventId: id, 'order': { $exists: true, $ne: null } };
        if (status) {
            filter['order.paymentStatus'] = status;
        }

        const registrations = await Registration.find(filter)
                                    .populate('participantId', 'email participantProfile')
                                    .sort({ createdAt: -1 }); // Most recent first

        res.status(200).json({ count: registrations.length, registrations });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Approve payment for merchandise order
exports.approvePayment = async (req, res) => {
    try {
        const { id } = req.params; // registration ID

        const registration = await Registration.findById(id);
        if (!registration)
            return res.status(404).json({ message: 'Registration not found' });

        const event = await Event.findById(registration.eventId);
        if (!event)
            return res.status(404).json({ message: 'Event not found' });

        if (event.organizerId.toString() !== req.user.id)
            return res.status(403).json({ message: 'Forbidden: You are not the organizer of this event' });

        if (!registration.order)
            return res.status(400).json({ message: 'This registration does not have a payment order' });

        if (registration.order.paymentStatus === 'APPROVED')
            return res.status(400).json({ message: 'Payment has already been approved' });

        if (!registration.order.paymentProof)
            return res.status(400).json({ message: 'No payment proof has been uploaded yet' });

        // Only decrement stock for actual merchandise orders (not registration-fee-only orders)
        const isRegistrationFeeOnly = registration.order.sku === 'REGISTRATION_FEE';
        if (!isRegistrationFeeOnly) {
            const item = event.items.find(i => i.sku === registration.order.sku);
            if (!item)
                return res.status(404).json({ message: 'Item not found in event' });

            const variant = item.variants.find(v =>
                v.size === registration.order.variant.size &&
                v.color === registration.order.variant.color
            );
            if (!variant)
                return res.status(404).json({ message: 'Variant not found' });

            if (variant.stock < registration.order.quantity)
                return res.status(400).json({ message: 'Insufficient stock available' });

            variant.stock -= registration.order.quantity;
            await event.save();
        }

        // Generate QR code payload
        const qrPayload = JSON.stringify({
            registrationId: registration.ticketId,
            eventId: registration.eventId,
            participantId: registration.participantId,
            timestamp: new Date().toISOString(),
        });

        // Update registration
        registration.order.paymentStatus = 'APPROVED';
        registration.status = 'CONFIRMED';
        registration.qrPayload = qrPayload;
        await registration.save();

        // Send notification and ticket email to participant
        await createNotification(
            registration.participantId,
            'REGISTRATION',
            'Payment Approved – Ticket Ready',
            `Your payment for ${event.title} has been approved. Your ticket is ready!`,
            event._id,
            null,
            null,
            `/events/${event._id}`
        );

        const participant = await User.findById(registration.participantId);
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
                ticketId: registration.ticketId,
                qrPayload,
            });
        }

        res.status(200).json({
            message: 'Payment approved. Ticket generated and emailed to participant.',
            registration
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Reject payment for merchandise order
exports.rejectPayment = async (req, res) => {
    try {
        const { id } = req.params; // registration ID
        const { reason } = req.body;

        const registration = await Registration.findById(id);
        if (!registration)
            return res.status(404).json({ message: 'Registration not found' });

        const event = await Event.findById(registration.eventId);
        if (!event)
            return res.status(404).json({ message: 'Event not found' });

        if (event.organizerId.toString() !== req.user.id)
            return res.status(403).json({ message: 'Forbidden: You are not the organizer of this event' });

        if (!registration.order)
            return res.status(400).json({ message: 'This registration does not have a payment order' });

        if (registration.order.paymentStatus === 'APPROVED')
            return res.status(400).json({ message: 'Cannot reject an approved payment' });

        // Update registration
        registration.order.paymentStatus = 'REJECTED';
        registration.order.rejectionReason = reason || 'Payment proof rejected by organizer';
        registration.status = 'REJECTED';
        await registration.save();

        // Notify participant of rejection
        await createNotification(
            registration.participantId,
            'REGISTRATION',
            'Payment Rejected',
            `Your payment for ${event.title} was rejected. Reason: ${reason || 'Please re-upload a valid payment proof'}. Re-upload from your dashboard.`,
            event._id,
            null,
            null,
            `/dashboard`
        );

        res.status(200).json({
            message: 'Payment rejected. Participant notified.',
            registration
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
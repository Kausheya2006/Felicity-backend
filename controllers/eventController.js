const Event = require('../models/Event');
const Registration = require('../models/Registration');
const User = require('../models/User');
const crypto = require('crypto');
const { createNotification } = require('./notificationController');
const { sendTicketEmail } = require('../config/mailer');

exports.getAllEvents = async (req, res) => {
    try {
        // Extract query parameters for filtering
        const { category, eligibility, tags, search, type, organizerIds, startDate, endDate } = req.query;
        
        // Build filter object
        const filter = { status: { $in: ['PUBLISHED', 'ONGOING', 'CLOSED', 'COMPLETED'] } };
        
        if (type) {
            filter.type = type;
        }
        
        if (eligibility) {
            filter.eligibility = { $in: eligibility.split(',') };
        }
        
        if (tags) {
            filter.tags = { $in: tags.split(',') };
        }
        
        // Filter by specific organizer IDs (for followed clubs)
        if (organizerIds) {
            const orgIdArray = organizerIds.split(',').filter(id => id.trim());
            if (orgIdArray.length > 0) {
                filter.organizerId = { $in: orgIdArray };
            }
        }
        
        // Date range filtering
        if (startDate || endDate) {
            filter.eventStartDate = {};
            if (startDate) {
                filter.eventStartDate.$gte = new Date(startDate);
            }
            if (endDate) {
                filter.eventStartDate.$lte = new Date(endDate);
            }
        }
        
        // Text search on title - use regex for partial matching
        if (search) {
            // Use regex for partial, case-insensitive search on title and description
            const searchRegex = new RegExp(search.split('').join('.*'), 'i');
            filter.$or = [
                { title: { $regex: searchRegex } },
                { description: { $regex: searchRegex } },
                { tags: { $regex: searchRegex } }
            ];
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

        // Attach currentRegistrations to events that have a maxParticipants cap
        const eventsWithCounts = await Promise.all(
            filteredEvents.map(async (ev) => {
                if (!ev.maxParticipants) return ev.toObject ? { ...ev.toObject(), currentRegistrations: null } : ev;
                const count = await Registration.countDocuments({ eventId: ev._id, status: { $ne: 'CANCELLED' } });
                return { ...(ev.toObject ? ev.toObject() : ev), currentRegistrations: count };
            })
        );

        res.json({ count: eventsWithCounts.length, events: eventsWithCounts });

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

        if (event.status === 'DRAFT' || event.status === 'CANCELLED')
            return res.status(403).json({ message: 'Forbidden: Event is not available' });

        res.json(event);

    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.registerForEvent = async (req, res) => {
  try {
    const { id } = req.params; // event ID
    const userId = req.user.id;
    const { formData } = req.body;

    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    if (event.status !== 'PUBLISHED')
      return res.status(403).json({ message: 'Forbidden: Event is not published' });

    // IMPORTANT: keep merch registration logic in ONE place
    if (event.type === 'MERCH') {
      return res.status(400).json({
        message: 'This is a merchandise event. Please use the merchandise registration endpoint.',
      });
    }

    // Check if event requires team registration
    if (event.allowTeams) {
      return res.status(400).json({
        message: 'This event requires team registration. Please create or join a team first.',
      });
    }

    // Check registration deadline OR event start date
    const now = new Date();
    if (event.registrationDeadline && now > new Date(event.registrationDeadline))
      return res.status(400).json({ message: 'Registration deadline has passed' });

    if (!event.registrationDeadline && event.eventStartDate && now > new Date(event.eventStartDate))
      return res.status(400).json({ message: 'Event has already started - registrations closed' });

    // Prevent duplicate registration (allow re-registration if previous was REJECTED or CANCELLED)
    const existing = await Registration.findOne({ eventId: id, participantId: userId });
    if (existing) {
      if (existing.status === 'REJECTED' || existing.status === 'CANCELLED') {
        await Registration.deleteOne({ _id: existing._id });
      } else {
        return res.status(400).json({ message: 'You have already registered for this event' });
      }
    }

    // Capacity check (count only non-cancelled)
    const registrationCount = await Registration.countDocuments({
      eventId: id,
      status: { $ne: 'CANCELLED' },
    });

    if (event.maxParticipants && registrationCount >= event.maxParticipants)
      return res.status(400).json({ message: 'Event has reached maximum participant limit' });

    // Eligibility check
    if (event.eligibility && event.eligibility.length > 0) {
      const participant = await User.findById(userId);
      const pType = participant?.participantProfile?.participantType;

      if (!pType || !event.eligibility.includes(pType)) {
        return res.status(403).json({ message: 'You do not meet the eligibility criteria for this event' });
      }
    }

    const ticketId = crypto.randomUUID();

    // YOUR SYSTEM RULE:
    // If reg fee > 0 => PENDING (no QR/email)
    // If reg fee == 0 => CONFIRMED immediately + QR/email
    const regFee = Number(event.fee || 0);
    const needsPayment = regFee > 0;

    const qrPayload = needsPayment
      ? null
      : JSON.stringify({
          registrationId: ticketId,
          eventId: id,
          participantId: userId,
          timestamp: new Date().toISOString(),
        });

    const registration = new Registration({
      eventId: id,
      participantId: userId,
      type: 'NORMAL',
      ticketId,
      qrPayload,
      formResponse: formData || {},
      status: needsPayment ? 'PENDING' : 'CONFIRMED',
      ...(needsPayment && {
        order: {
          sku: 'REGISTRATION_FEE',
          name: 'Event Registration',
          variant: { size: '-', color: '-' },
          quantity: 1,
          price: regFee,
          amountPaid: regFee,
          paymentStatus: 'PENDING',
        },
      }),
    });

    await registration.save();

    // Lock form after first registration (keeping your existing behavior)
    const regCount = await Registration.countDocuments({ eventId: id });
    if (regCount === 1 && !event.formLocked) {
      event.formLocked = true;
      await event.save();
    }

    if (needsPayment) {
      await createNotification(
        userId,
        'REGISTRATION',
        'Payment Required',
        `You've registered for ${event.title}. Please upload payment proof of ₹${regFee} to confirm your spot.`,
        id,
        null,
        null,
        `/dashboard`
      );

      return res.status(201).json({
        message: `Registration submitted. Please upload payment proof of ₹${regFee} to confirm your spot.`,
        registration,
        requiresPayment: true,
        amountDue: regFee,
      });
    }

    // Free => Confirmed => notify + email ticket now
    await createNotification(
      userId,
      'REGISTRATION',
      'Registration Confirmed',
      `You've successfully registered for ${event.title}`,
      id,
      null,
      null,
      `/events/${id}`
    );

    await createNotification(
      event.organizerId,
      'REGISTRATION',
      'New Registration',
      `Someone registered for ${event.title}`,
      id,
      null,
      null,
      `/organizer/events/${id}`
    );

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

    return res.status(201).json({ message: 'Registered successfully', registration });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};



exports.registerForMerchEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { order, formData } = req.body; // (optional) keep compatible if you later add formData

    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    if (event.status !== 'PUBLISHED')
      return res.status(403).json({ message: 'Forbidden: Event is not published' });

    if (event.type !== 'MERCH')
      return res.status(400).json({ message: 'This event is not a merchandise event' });

    // Check if event requires team registration (optional consistency)
    if (event.allowTeams) {
      return res.status(400).json({
        message: 'This event requires team registration. Please create or join a team first.',
      });
    }

    // Check registration deadline OR event start date
    const now = new Date();
    const effectiveDeadline = event.registrationDeadline || event.eventStartDate;
    if (effectiveDeadline && now > new Date(effectiveDeadline))
      return res.status(400).json({ message: 'Registration deadline has passed' });

    // Prevent duplicate registration (allow re-registration if previous was REJECTED or CANCELLED)
    const existing = await Registration.findOne({ eventId: id, participantId: userId });
    if (existing) {
      if (existing.status === 'REJECTED' || existing.status === 'CANCELLED') {
        await Registration.deleteOne({ _id: existing._id });
      } else {
        return res.status(400).json({ message: 'You have already registered for this event' });
      }
    }

    // Capacity check (count only non-cancelled)
    const registrationCount = await Registration.countDocuments({
      eventId: id,
      status: { $ne: 'CANCELLED' },
    });

    if (event.maxParticipants && registrationCount >= event.maxParticipants)
      return res.status(400).json({ message: 'Event has reached maximum participant limit' });

    // Eligibility check (optional consistency)
    if (event.eligibility && event.eligibility.length > 0) {
      const participant = await User.findById(userId);
      const pType = participant?.participantProfile?.participantType;

      if (!pType || !event.eligibility.includes(pType)) {
        return res.status(403).json({ message: 'You do not meet the eligibility criteria for this event' });
      }
    }

    const ticketId = crypto.randomUUID();

    const registrationFee = Number(event.fee || 0);
    const merchandiseFee = Number(event.merchandiseFee || 0);

    const isRegOnly = !order || !order.sku;

    // ---------- CASE A: Registration only (no merch) ----------
    if (isRegOnly) {
      const total = registrationFee; // only reg fee
      const needsPayment = total > 0;

      const qrPayload = needsPayment
        ? null
        : JSON.stringify({
            registrationId: ticketId,
            eventId: id,
            participantId: userId,
            timestamp: new Date().toISOString(),
          });

      const registration = await Registration.create({
        eventId: id,
        participantId: userId,
        type: 'MERCH',
        ticketId,
        qrPayload,
        formResponse: formData || {},
        status: needsPayment ? 'PENDING' : 'CONFIRMED',
        order: {
          sku: 'REGISTRATION_FEE',
          name: 'Event Registration',
          variant: { size: '-', color: '-' },
          quantity: 1,
          price: registrationFee,
          amountPaid: total,
          paymentStatus: needsPayment ? 'PENDING' : 'PAID',
        },
      });

      if (needsPayment) {
        await createNotification(
          userId,
          'REGISTRATION',
          'Payment Required',
          `Registered for ${event.title}. Please upload payment proof of ₹${registrationFee} to confirm.`,
          id,
          null,
          null,
          `/dashboard`
        );

        return res.status(201).json({
          message: `Registration submitted. Please upload payment proof of ₹${registrationFee} to confirm your spot.`,
          registration,
          amountDue: total,
          breakdown: { registrationFee, merchandiseFee: 0, quantity: 0 },
        });
      }

      // Free => send ticket immediately
      await createNotification(
        userId,
        'REGISTRATION',
        'Registration Confirmed',
        `You've successfully registered for ${event.title}`,
        id,
        null,
        null,
        `/events/${id}`
      );

      await createNotification(
        event.organizerId,
        'REGISTRATION',
        'New Registration',
        `Someone registered for ${event.title}`,
        id,
        null,
        null,
        `/organizer/events/${id}`
      );

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

      return res.status(201).json({
        message: 'Registered successfully (no payment required)',
        registration,
        amountDue: 0,
      });
    }

    // ---------- CASE B: Registration + merch purchase ----------
    if (!order.variant || typeof order.quantity !== 'number')
      return res.status(400).json({ message: 'Order details (sku, variant, quantity) are required' });

    const item = event.items?.find((i) => i.sku === order.sku);
    if (!item) return res.status(400).json({ message: 'Invalid item selected' });

    const variant = item.variants?.find(
      (v) => v.size === order.variant.size && v.color === order.variant.color
    );
    if (!variant) return res.status(400).json({ message: 'Invalid variant selected' });

    if (variant.stock < order.quantity)
      return res.status(400).json({ message: 'Selected quantity exceeds available stock' });

    if (item.purchaseLimitPerUser && order.quantity > item.purchaseLimitPerUser)
      return res.status(400).json({ message: `You can only purchase up to ${item.purchaseLimitPerUser} units of this item` });

    const total = registrationFee + merchandiseFee * order.quantity;
    const needsPayment = total > 0;

    const qrPayload = needsPayment
      ? null
      : JSON.stringify({
          registrationId: ticketId,
          eventId: id,
          participantId: userId,
          timestamp: new Date().toISOString(),
        });

    const registration = await Registration.create({
      eventId: id,
      participantId: userId,
      type: 'MERCH',
      ticketId,
      qrPayload,
      formResponse: formData || {},
      status: needsPayment ? 'PENDING' : 'CONFIRMED',
      order: {
        sku: item.sku,
        name: item.name,
        variant: { size: order.variant.size, color: order.variant.color },
        quantity: order.quantity,
        price: merchandiseFee,
        amountPaid: total,
        paymentStatus: needsPayment ? 'PENDING' : 'PAID',
      },
    });

    if (needsPayment) {
      await createNotification(
        userId,
        'REGISTRATION',
        'Payment Required',
        `Order placed for ${event.title}. Please upload payment proof of ₹${total} to confirm.`,
        id,
        null,
        null,
        `/dashboard`
      );

      return res.status(201).json({
        message: `Order placed. Please upload payment proof of ₹${total} (₹${registrationFee} registration + ₹${merchandiseFee}×${order.quantity} merchandise).`,
        registration,
        amountDue: total,
        breakdown: { registrationFee, merchandiseFee, quantity: order.quantity },
      });
    }

    // total == 0 (rare, but your rule says instant ticket)
    await createNotification(
      userId,
      'REGISTRATION',
      'Registration Confirmed',
      `You've successfully registered for ${event.title}`,
      id,
      null,
      null,
      `/events/${id}`
    );

    await createNotification(
      event.organizerId,
      'REGISTRATION',
      'New Registration',
      `Someone registered for ${event.title}`,
      id,
      null,
      null,
      `/organizer/events/${id}`
    );

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

    return res.status(201).json({
      message: 'Registered successfully (no payment required)',
      registration,
      amountDue: 0,
      breakdown: { registrationFee, merchandiseFee, quantity: order.quantity },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
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

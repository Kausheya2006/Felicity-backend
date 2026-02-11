const Team = require("../models/Team");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const crypto = require("crypto");
const { createNotification } = require("./notificationController");

// Create a new team
exports.createTeam = async (req, res) => {
  try {
    const { eventId, teamName, teamSize, formResponse } = req.body;
    const teamLeader = req.user.id;

    // Validate event exists and allows teams
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (!event.allowTeams) {
      return res.status(400).json({ message: "This event does not support team registration" });
    }

    // Validate team size
    if (teamSize < event.minTeamSize || teamSize > event.maxTeamSize) {
      return res.status(400).json({ 
        message: `Team size must be between ${event.minTeamSize} and ${event.maxTeamSize}` 
      });
    }

    // Check if user is already in a team for this event
    const existingTeam = await Team.findOne({
      eventId,
      $or: [
        { teamLeader },
        { "members.userId": teamLeader }
      ],
      status: { $in: ["FORMING", "COMPLETE", "REGISTERED"] }
    });

    if (existingTeam) {
      return res.status(400).json({ 
        message: "You are already part of a team for this event" 
      });
    }

    // Check if user already has individual registration
    const existingRegistration = await Registration.findOne({
      eventId,
      participantId: teamLeader,
      status: { $in: ["PENDING", "CONFIRMED"] }
    });

    if (existingRegistration) {
      return res.status(400).json({ 
        message: "You already have an individual registration for this event" 
      });
    }

    // Generate unique invite code
    let inviteCode;
    let isUnique = false;
    while (!isUnique) {
      inviteCode = crypto.randomBytes(4).toString("hex").toUpperCase();
      const existing = await Team.findOne({ inviteCode });
      if (!existing) isUnique = true;
    }

    // Create team with leader as first accepted member
    const team = new Team({
      teamName,
      eventId,
      teamLeader,
      teamSize,
      inviteCode,
      formResponse,
      members: [
        {
          userId: teamLeader,
          status: "ACCEPTED",
          joinedAt: new Date()
        }
      ],
      status: teamSize === 1 ? "COMPLETE" : "FORMING"
    });

    await team.save();

    // If team size is 1, register immediately
    if (teamSize === 1) {
      await registerTeam(team);
    }

    res.status(201).json({
      message: "Team created successfully",
      team: await team.populate("teamLeader", "name email")
    });
  } catch (error) {
    console.error("Create team error:", error);
    res.status(500).json({ message: "Failed to create team", error: error.message });
  }
};

// Join team via invite code
exports.joinTeam = async (req, res) => {
  try {
    const { inviteCode } = req.body;
    const userId = req.user.id;

    // Find team by invite code
    const team = await Team.findOne({ inviteCode })
      .populate("eventId")
      .populate("teamLeader", "name email");

    if (!team) {
      return res.status(404).json({ message: "Invalid invite code" });
    }

    if (team.status !== "FORMING") {
      return res.status(400).json({ message: "This team is no longer accepting members" });
    }

    // Check if user is already in the team
    const alreadyMember = team.members.find(m => m.userId.toString() === userId);
    if (alreadyMember) {
      if (alreadyMember.status === "ACCEPTED") {
        return res.status(400).json({ message: "You are already part of this team" });
      } else if (alreadyMember.status === "PENDING") {
        return res.status(400).json({ message: "You already have a pending invite for this team" });
      }
    }

    // Check if team is full
    const acceptedCount = team.members.filter(m => m.status === "ACCEPTED").length;
    if (acceptedCount >= team.teamSize) {
      return res.status(400).json({ message: "This team is already full" });
    }

    // Check if user is in another team for same event
    const otherTeam = await Team.findOne({
      eventId: team.eventId._id,
      _id: { $ne: team._id },
      $or: [
        { teamLeader: userId },
        { "members.userId": userId }
      ],
      status: { $in: ["FORMING", "COMPLETE", "REGISTERED"] }
    });

    if (otherTeam) {
      return res.status(400).json({ 
        message: "You are already part of another team for this event" 
      });
    }

    // Check if user has individual registration
    const existingRegistration = await Registration.findOne({
      eventId: team.eventId._id,
      participantId: userId,
      status: { $in: ["PENDING", "CONFIRMED"] }
    });

    if (existingRegistration) {
      return res.status(400).json({ 
        message: "You already have an individual registration for this event" 
      });
    }

    // Add member to team
    team.members.push({
      userId,
      status: "ACCEPTED",
      joinedAt: new Date()
    });

    // Check if team is now complete
    const newAcceptedCount = team.members.filter(m => m.status === "ACCEPTED").length;
    if (newAcceptedCount === team.teamSize) {
      team.status = "COMPLETE";
      team.completedAt = new Date();
      
      // Register the team
      await team.save();
      await registerTeam(team);
    } else {
      await team.save();
    }

    // Notify team leader about new member
    const User = require("../models/User");
    const joiningUser = await User.findById(userId);
    const joiningUserName = joiningUser?.participantProfile?.name || joiningUser?.email || "Someone";
    
    await createNotification(
      team.teamLeader._id || team.teamLeader,
      "TEAM_JOIN",
      `${joiningUserName} joined your team`,
      `${joiningUserName} has joined team "${team.teamName}"`,
      team.eventId._id || team.eventId,
      team._id,
      null,
      `/teams?team=${team._id}`
    );

    // Notify other team members
    for (const member of team.members) {
      if (member.userId.toString() !== userId && 
          member.userId.toString() !== (team.teamLeader._id || team.teamLeader).toString() &&
          member.status === "ACCEPTED") {
        await createNotification(
          member.userId,
          "TEAM_JOIN",
          `${joiningUserName} joined the team`,
          `${joiningUserName} has joined team "${team.teamName}"`,
          team.eventId._id || team.eventId,
          team._id,
          null,
          `/teams?team=${team._id}`
        );
      }
    }

    res.json({
      message: "Successfully joined team",
      team: await team.populate("members.userId", "name email")
    });
  } catch (error) {
    console.error("Join team error:", error);
    res.status(500).json({ message: "Failed to join team", error: error.message });
  }
};

// Leave team
exports.leaveTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    const userId = req.user.id;

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    // Cannot leave if team is already registered
    if (team.status === "REGISTERED") {
      return res.status(400).json({ 
        message: "Cannot leave team after registration is complete" 
      });
    }

    // Team leader cannot leave, must cancel team instead
    if (team.teamLeader.toString() === userId) {
      return res.status(400).json({ 
        message: "Team leader cannot leave. Please cancel the team instead." 
      });
    }

    // Remove member
    team.members = team.members.filter(m => m.userId.toString() !== userId);
    
    // Update status back to FORMING if it was COMPLETE
    if (team.status === "COMPLETE") {
      team.status = "FORMING";
      team.completedAt = null;
    }

    await team.save();

    res.json({ message: "Successfully left team" });
  } catch (error) {
    console.error("Leave team error:", error);
    res.status(500).json({ message: "Failed to leave team", error: error.message });
  }
};

// Cancel team (leader only)
exports.cancelTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    const userId = req.user.id;

    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    // Only team leader can cancel
    if (team.teamLeader.toString() !== userId) {
      return res.status(403).json({ message: "Only team leader can cancel the team" });
    }

    // Cannot cancel if already registered
    if (team.status === "REGISTERED") {
      return res.status(400).json({ 
        message: "Cannot cancel team after registration. Please cancel individual registrations instead." 
      });
    }

    team.status = "CANCELLED";
    await team.save();

    res.json({ message: "Team cancelled successfully" });
  } catch (error) {
    console.error("Cancel team error:", error);
    res.status(500).json({ message: "Failed to cancel team", error: error.message });
  }
};

// Get my teams
exports.getMyTeams = async (req, res) => {
  try {
    const userId = req.user.id;

    const teams = await Team.find({
      $or: [
        { teamLeader: userId },
        { "members.userId": userId }
      ],
      status: { $ne: "CANCELLED" }
    })
      .populate("eventId", "title eventStartDate venue allowTeams minTeamSize maxTeamSize")
      .populate("teamLeader", "name email")
      .populate("members.userId", "name email")
      .sort({ createdAt: -1 });

    res.json(teams);
  } catch (error) {
    console.error("Get my teams error:", error);
    res.status(500).json({ message: "Failed to fetch teams", error: error.message });
  }
};

// Get team by ID
exports.getTeamById = async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await Team.findById(teamId)
      .populate("eventId")
      .populate("teamLeader", "name email")
      .populate("members.userId", "name email");

    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    res.json(team);
  } catch (error) {
    console.error("Get team error:", error);
    res.status(500).json({ message: "Failed to fetch team", error: error.message });
  }
};

// Get team by invite code (for preview before joining)
exports.getTeamByInviteCode = async (req, res) => {
  try {
    const { inviteCode } = req.params;

    const team = await Team.findOne({ inviteCode })
      .populate("eventId", "title eventStartDate venue allowTeams minTeamSize maxTeamSize")
      .populate("teamLeader", "name email")
      .populate("members.userId", "name email");

    if (!team) {
      return res.status(404).json({ message: "Invalid invite code" });
    }

    res.json(team);
  } catch (error) {
    console.error("Get team by invite code error:", error);
    res.status(500).json({ message: "Failed to fetch team", error: error.message });
  }
};

// Helper function to register team and create tickets for all members
async function registerTeam(team) {
  try {
    const event = await Event.findById(team.eventId);
    if (!event) throw new Error("Event not found");

    const acceptedMembers = team.members.filter(m => m.status === "ACCEPTED");
    
    // Create registrations for all team members
    const registrations = [];
    for (const member of acceptedMembers) {
      const ticketId = `${event.title.substring(0, 3).toUpperCase()}-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      
      const qrPayload = JSON.stringify({
        ticketId,
        eventId: event._id,
        participantId: member.userId,
        teamId: team._id,
        teamName: team.teamName,
        eventTitle: event.title,
        eventDate: event.eventStartDate,
        registeredAt: new Date().toISOString(),
      });

      const registration = new Registration({
        eventId: team.eventId,
        participantId: member.userId,
        teamId: team._id,
        type: event.type || "NORMAL",
        status: "CONFIRMED",
        ticketId,
        qrPayload,
        formResponse: team.formResponse // Use team leader's form response for all
      });

      registrations.push(registration);
    }

    await Registration.insertMany(registrations);

    // Update team status
    team.status = "REGISTERED";
    team.registeredAt = new Date();
    await team.save();

    return registrations;
  } catch (error) {
    console.error("Register team error:", error);
    throw error;
  }
}

module.exports = {
  createTeam: exports.createTeam,
  joinTeam: exports.joinTeam,
  leaveTeam: exports.leaveTeam,
  cancelTeam: exports.cancelTeam,
  getMyTeams: exports.getMyTeams,
  getTeamById: exports.getTeamById,
  getTeamByInviteCode: exports.getTeamByInviteCode,
};

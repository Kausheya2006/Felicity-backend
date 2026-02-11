const express = require("express");
const router = express.Router();
const teamController = require("../controllers/teamController");
const authMiddleware = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

// All routes require authentication
router.use(authMiddleware);

// Create a new team (participants only)
router.post("/create", allowRoles('participant'), teamController.createTeam);

// Join team via invite code
router.post("/join", allowRoles('participant'), teamController.joinTeam);

// Leave team
router.post("/:teamId/leave", allowRoles('participant'), teamController.leaveTeam);

// Cancel team (leader only)
router.delete("/:teamId/cancel", allowRoles('participant'), teamController.cancelTeam);

// Get my teams
router.get("/my-teams", allowRoles('participant'), teamController.getMyTeams);

// Get team by invite code (for preview)
router.get("/invite/:inviteCode", allowRoles('participant'), teamController.getTeamByInviteCode);

// Get team by ID
router.get("/:teamId", allowRoles('participant'), teamController.getTeamById);

module.exports = router;

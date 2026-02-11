const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

exports.registerParticipant = async (req, res) => {
  try {
    const { email, password, firstname, lastname, participantType, college, interests} = req.body;

    if (participantType == 'IIIT' && !(email.endsWith('@students.iiit.ac.in') || email.endsWith('@research.iiit.ac.in')))
        return res.status(400).json({ message: "IIIT participants must use their IIIT email." });

    const existingUser = await User.findOne({ email });
    if (existingUser) 
      return res.status(400).json({ message: "Email already registered" });

    // hash password
    const hashedPassword = await bcrypt.hash(password, 10); // 10 salt rounds

    const user = await User.create({
        email,
        password: hashedPassword,
        role: "participant",
        participantProfile: {
            firstname,
            lastname,
            participantType,
            college,
            interests : interests || [],
        }
    });

    res.status(201).json({ message: "Participant registered successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // validate
        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        const user = await User.findOne({ email });
        if (!user) 
            return res.status(400).json({ message: "Invalid credentials" });

        if (user.role === 'organizer' && !user.isVerified)
            return res.status(403).json({ message: "Account not verified. Please verify your email." });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) 
            return res.status(400).json({ message: "Invalid credentials" });

        // sign jwt
        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token, 
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
            } 
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

exports.me = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// exports.<name> same as module.exports = { <name> }
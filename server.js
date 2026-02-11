require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./config/db');

connectDB();

const app = express();
const server = http.createServer(app);

// Socket.IO setup
const io = new Server(server, {
    cors: {
        origin: [process.env.FRONTEND_URL || 'http://localhost:5173', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176'],
        credentials: true
    }
});

// Pass io to message controller
const messageController = require('./controllers/messageController');
messageController.setSocketIO(io);

// Pass io to notification controller
const notificationController = require('./controllers/notificationController');
notificationController.setSocketIO(io);

// Pass io to team message controller
const teamMessageController = require('./controllers/teamMessageController');
teamMessageController.setSocketIO(io);

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Store userId on socket for disconnect handling
    let currentUserId = null;
    
    // Join user's personal notification room
    socket.on('joinUserRoom', (userId) => {
        currentUserId = userId;
        socket.join(`user_${userId}`);
        console.log(`Socket ${socket.id} joined user_${userId}`);
    });
    
    // Leave user room
    socket.on('leaveUserRoom', (userId) => {
        socket.leave(`user_${userId}`);
        console.log(`Socket ${socket.id} left user_${userId}`);
    });
    
    // Join event room for real-time updates
    socket.on('joinEventRoom', (eventId) => {
        socket.join(`event_${eventId}`);
        console.log(`Socket ${socket.id} joined event_${eventId}`);
    });
    
    // Leave event room
    socket.on('leaveEventRoom', (eventId) => {
        socket.leave(`event_${eventId}`);
        console.log(`Socket ${socket.id} left event_${eventId}`);
    });
    
    // Join team chat room
    socket.on('joinTeamRoom', ({ teamId, userId }) => {
        currentUserId = userId;
        teamMessageController.handleJoinTeamRoom(socket, teamId, userId);
        console.log(`Socket ${socket.id} joined team_${teamId}`);
    });
    
    // Leave team chat room
    socket.on('leaveTeamRoom', ({ teamId, userId }) => {
        teamMessageController.handleLeaveTeamRoom(socket, teamId, userId);
        console.log(`Socket ${socket.id} left team_${teamId}`);
    });
    
    // Typing indicator
    socket.on('teamTyping', ({ teamId, userId, isTyping }) => {
        teamMessageController.handleTyping(socket, teamId, userId, isTyping);
    });
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (currentUserId) {
            teamMessageController.handleDisconnect(currentUserId);
        }
    });
});

// middleware
app.use(cors({
    origin: [process.env.FRONTEND_URL || 'http://localhost:5173', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// routes
const authRoutes = require('./routes/authRoutes');
app.use('/auth', authRoutes)

const organizerRoutes = require('./routes/organizerRoutes');
app.use('/organizer', organizerRoutes);

const eventRoutes = require('./routes/eventRoutes');
app.use('/events', eventRoutes);

const adminRoutes = require('./routes/adminRoutes');
app.use('/admin', adminRoutes);

const participantRoutes = require('./routes/participantRoutes');
app.use('/participant', participantRoutes);

const teamRoutes = require('./routes/teamRoutes');
app.use('/teams', teamRoutes);

const userRoutes = require('./routes/userRoutes');
app.use('/user', userRoutes);

const messageRoutes = require('./routes/messageRoutes');
app.use('/messages', messageRoutes);

const notificationRoutes = require('./routes/notificationRoutes');
app.use('/notifications', notificationRoutes);

const teamMessageRoutes = require('./routes/teamMessageRoutes');
app.use('/team-messages', teamMessageRoutes);

const feedbackRoutes = require('./routes/feedbackRoutes');
app.use('/feedback', feedbackRoutes);

app.get('/', (req, res) => {
    res.send('API is running...');
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log('Server is running on port', PORT);
});
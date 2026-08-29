const { Server } = require('socket.io');

let io;
const connectedUsers = new Map(); // Map<userId, socketId>

const initializeSocket = (server) => {
  if (io) {
    console.log('ℹ️ Socket.IO already initialized, skipping.');
    return io;
  }

  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // User authentication - client sends userId after connecting
    socket.on('authenticate', (userId) => {
      connectedUsers.set(userId.toString(), socket.id);
      socket.userId = userId;
      console.log(`✅ User ${userId} authenticated with socket ${socket.id}`);
      
      // Join user-specific room
      socket.join(`user_${userId}`);
    });

    socket.on('disconnect', () => {
      if (socket.userId) {
        connectedUsers.delete(socket.userId.toString());
        console.log(`❌ User ${socket.userId} disconnected`);
      }
    });
  });

  console.log('✅ Socket.IO initialized');
  return io;
};

// Send notification to specific user
const sendNotificationToUser = (userId, event, data) => {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return false;
  }

  io.to(`user_${userId}`).emit(event, data);
  console.log(`📤 Sent ${event} to user ${userId}:`, data);
  return true;
};

// Send notification to multiple users
const sendNotificationToUsers = (userIds, event, data) => {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return false;
  }

  userIds.forEach((userId) => {
    io.to(`user_${userId}`).emit(event, data);
  });
  console.log(`📤 Sent ${event} to ${userIds.length} users`);
  return true;
};

// Broadcast to all connected clients
const broadcastNotification = (event, data) => {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return false;
  }

  io.emit(event, data);
  console.log(`📡 Broadcast ${event}:`, data);
  return true;
};

// Get connected users count
const getConnectedUsersCount = () => {
  return connectedUsers.size;
};

// Check if user is online
const isUserOnline = (userId) => {
  return connectedUsers.has(userId.toString());
};

module.exports = {
  initializeSocket,
  sendNotificationToUser,
  sendNotificationToUsers,
  broadcastNotification,
  getConnectedUsersCount,
  isUserOnline,
};

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { getConnection } = require('./config/database');
const { initializeSocket } = require('./services/socketService');
const { startMedicineScheduler } = require('./jobs/medicineScheduler');
const { startHeartbeatMonitor } = require('./jobs/heartbeatMonitor');
const { startKeepAliveJob } = require('./jobs/keepAlive');
const { initializeFirebase } = require('./config/firebase');

// Load environment variables
dotenv.config();

// Import routes
const authRoutes = require('./routes/authRoutes');
const medicineRoutes = require('./routes/medicineRoutes');
const userRoutes = require('./routes/userRoutes');
const heartbeatRoutes = require('./routes/heartbeatRoutes');
const alertRoutes = require('./routes/alertRoutes');
const sosRoutes = require('./routes/sosRoutes');
const activityRoutes = require('./routes/activityRoutes');
const batteryRoutes = require('./routes/batteryRoutes');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Medicine Reminder API is running',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/users', userRoutes);
app.use('/api/heartbeat', heartbeatRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/sos', sosRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/battery', batteryRoutes);

// Debug endpoint
app.get('/api/debug/db', (req, res) => {
  res.status(200).json(global._mockDB || {});
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Initialize database connection and start server
const startServer = async () => {
  try {
    // Test database connection
    await getConnection();
    console.log('✅ Database connected');
    
    // Initialize Firebase (optional - will warn if not configured)
    initializeFirebase();
    
    // Initialize Socket.IO
    initializeSocket(server);
    console.log('✅ Socket.IO initialized');
    
    // Start background jobs
    startMedicineScheduler();
    startHeartbeatMonitor();
    startKeepAliveJob();
    console.log('✅ Background jobs started');
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${PORT} is already in use.`);
        console.error(`   Run this to free it:  npx kill-port ${PORT}`);
        console.error(`   Or on Windows:        netstat -ano | findstr :${PORT}  then  taskkill /PID <pid> /F\n`);
      } else {
        console.error('Server error:', err);
      }
      process.exit(1);
    });

    server.listen(PORT, () => {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🚀 Medicine Reminder & Safety Monitoring API`);
      console.log(`${'='.repeat(60)}`);
      console.log(`📍 Server: http://localhost:${PORT}`);
      console.log(`📍 Health: http://localhost:${PORT}/health`);
      console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔌 Socket.IO: Enabled`);
      console.log(`⏰ Background Jobs: Running`);
      console.log(`🔋 Battery Monitoring: Enabled`);
      console.log(`${'='.repeat(60)}\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⚠️ Shutting down gracefully...');
  const { closeConnection } = require('./config/database');
  await closeConnection();
  process.exit(0);
});

startServer();

module.exports = { app, server };

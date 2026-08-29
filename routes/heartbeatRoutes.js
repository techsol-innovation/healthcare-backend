const express = require('express');
const router = express.Router();
const { verifyToken, isChild, isParent } = require('../middleware/auth');
const {
  sendHeartbeat,
  getMyHeartbeatStatus,
  getHeartbeatHistory,
  getChildrenOnlineStatus,
} = require('../controllers/heartbeatController');

// Parent sends heartbeat (device being monitored)
router.post('/', verifyToken, isParent, sendHeartbeat);

// Get my heartbeat status (parent)
router.get('/my-status', verifyToken, isParent, getMyHeartbeatStatus);

// Get heartbeat history for a child
router.get('/history/:childId', verifyToken, getHeartbeatHistory);

// Get all parents online status (for caregiver/child)
router.get('/parents-status', verifyToken, isChild, getChildrenOnlineStatus);

module.exports = router;

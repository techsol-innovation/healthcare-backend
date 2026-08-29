const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const {
  getActivityTimeline,
  getParentDashboard,
  recordCheckIn,
} = require('../controllers/activityController');

// Get 24-hour activity timeline for a patient (Parent)
router.get('/timeline/:parentId', verifyToken, getActivityTimeline);

// Get dashboard summary for parent (all children)
router.get('/dashboard', verifyToken, getParentDashboard);

// Parent checks in
router.post('/checkin', verifyToken, recordCheckIn);

module.exports = router;

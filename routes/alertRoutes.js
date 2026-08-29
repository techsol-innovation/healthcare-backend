const express = require('express');
const router = express.Router();
const { verifyToken, isParent, isChild } = require('../middleware/auth');
const {
  getMyAlerts,
  getUnreadAlerts,
  markAlertAsRead,
  markAllAlertsAsRead,
  getAlertStats,
  createAlert,
  sendCustomReminder,
} = require('../controllers/alertController');

// Get all alerts (available for both parent and child/caregiver)
router.get('/', verifyToken, getMyAlerts);

// Get unread alerts (available for both parent and child/caregiver)
router.get('/unread', verifyToken, getUnreadAlerts);

// Get alert statistics (available for both parent and child/caregiver)
router.get('/stats', verifyToken, getAlertStats);

// Mark alert as read (available for both parent and child/caregiver)
router.put('/:alertId/read', verifyToken, markAlertAsRead);

// Mark all alerts as read (available for both parent and child/caregiver)
router.put('/read-all', verifyToken, markAllAlertsAsRead);

// Create custom alert (child can create alerts for parent)
router.post('/', verifyToken, isChild, createAlert);

// Send a custom personal reminder to a parent (Push Notification + App Alert)
router.post('/custom-reminder', verifyToken, isChild, sendCustomReminder);

module.exports = router;

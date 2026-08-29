const Alert = require('../models/Alert');
const { sendNotificationToUser } = require('../services/socketService');
const { sendPushNotification } = require('../services/notificationService');
const { getConnection, mssql } = require('../config/database');

// Get all alerts for parent OR child/caregiver
const getMyAlerts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;

    console.log('🔔 Getting alerts for:', { userId, userRole, limit });

    const alerts = await Alert.getByParentId(userId, limit);

    console.log('✅ Found alerts:', alerts.length);

    res.status(200).json({
      success: true,
      count: alerts.length,
      data: alerts,
    });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get alerts',
      error: error.message,
    });
  }
};

// Get unread alerts for parent OR child/caregiver
const getUnreadAlerts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;

    console.log('🔔 Getting unread alerts for:', { userId, userRole });

    const alerts = await Alert.getUnreadByParentId(userId);

    console.log('✅ Found unread alerts:', alerts.length);

    res.status(200).json({
      success: true,
      count: alerts.length,
      data: alerts,
    });
  } catch (error) {
    console.error('Get unread alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread alerts',
      error: error.message,
    });
  }
};

// Mark alert as read
const markAlertAsRead = async (req, res) => {
  try {
    const { alertId } = req.params;
    const parentUserId = req.user.userId;

    await Alert.markAsRead(alertId, parentUserId);

    res.status(200).json({
      success: true,
      message: 'Alert marked as read',
    });
  } catch (error) {
    console.error('Mark alert as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark alert as read',
      error: error.message,
    });
  }
};

// Mark all alerts as read
const markAllAlertsAsRead = async (req, res) => {
  try {
    const parentUserId = req.user.userId;

    await Alert.markAllAsRead(parentUserId);

    res.status(200).json({
      success: true,
      message: 'All alerts marked as read',
    });
  } catch (error) {
    console.error('Mark all alerts as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all alerts as read',
      error: error.message,
    });
  }
};

// Get alert counts by type
const getAlertStats = async (req, res) => {
  try {
    const parentUserId = req.user.userId;

    const stats = await Alert.getCountByType(parentUserId);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get alert stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get alert stats',
      error: error.message,
    });
  }
};

// Create alert (internal use, can also be used by child to create custom alerts)
const createAlert = async (req, res) => {
  try {
    const { parentId, alertType, title, message, severity } = req.body;
    const childUserId = req.user.userId;

    // Verify child has access to this parent
    const pool = await getConnection();
    const linkCheck = await pool
      .request()
      .input('childId', mssql.Int, childUserId)
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT * FROM ParentChildLink
        WHERE ChildId = @childId AND ParentId = @parentId
      `);

    if (linkCheck.recordset.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const alertId = await Alert.create({
      parentId,
      childId: childUserId,
      alertType,
      title,
      message,
      severity: severity || 'medium',
    });

    // Send real-time notification
    sendNotificationToUser(parentId, 'new_alert', {
      alertId,
      alertType,
      title,
      message,
      severity,
      timestamp: new Date(),
    });

    res.status(201).json({
      success: true,
      message: 'Alert created successfully',
      data: { alertId },
    });
  } catch (error) {
    console.error('Create alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create alert',
      error: error.message,
    });
  }
};

// Send a custom reminder (Push Notification + In-App Alert)
const sendCustomReminder = async (req, res) => {
  try {
    const { parentId, title, message } = req.body;
    const childUserId = req.user.userId;

    if (!parentId || !title || !message) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Verify child has access to this parent
    const pool = await getConnection();
    const linkCheck = await pool
      .request()
      .input('childId', mssql.Int, childUserId)
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT * FROM ParentChildLink
        WHERE ChildId = @childId AND ParentId = @parentId
      `);

    if (linkCheck.recordset.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You are not linked to this parent.',
      });
    }

    // 1. Create the alert in the database so it appears in the parent's app
    const alertId = await Alert.create({
      parentId: parentId, // Parent is the recipient
      childId: childUserId, // Caregiver is the sender
      alertType: 'custom_reminder',
      title: title,
      message: message,
      severity: 'medium',
    });

    // 2. Send real-time socket notification if parent is currently using the app
    sendNotificationToUser(parentId, 'custom_reminder', {
      alertId,
      title,
      message,
      timestamp: new Date(),
    });

    // 3. Send Native Push Notification to the parent's phone
    sendPushNotification(parentId, title, message);

    res.status(201).json({
      success: true,
      message: 'Reminder sent successfully',
    });
  } catch (error) {
    console.error('Send custom reminder error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send custom reminder',
      error: error.message,
    });
  }
};

module.exports = {
  getMyAlerts,
  getUnreadAlerts,
  markAlertAsRead,
  markAllAlertsAsRead,
  getAlertStats,
  createAlert,
  sendCustomReminder,
};

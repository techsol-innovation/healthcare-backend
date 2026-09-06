const SOS = require('../models/SOS');
const Alert = require('../models/Alert');
const { sendNotificationToUser } = require('../services/socketService');
const { sendPushNotification } = require('../services/notificationService');
const { getConnection, mssql } = require('../config/database');

// Parent triggers SOS
const triggerSOS = async (req, res) => {
  try {
    const { message, location } = req.body;
    const parentUserId = req.user.userId;

    const pool = await getConnection();

    // Find the child/caregiver linked to this parent
    const linkQuery = await pool
      .request()
      .input('parentId', mssql.Int, parentUserId)
      .query(`
        SELECT ChildId FROM ParentChildLink
        WHERE ParentId = @parentId
      `);

    if (linkQuery.recordset.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'No caregiver linked to your account.',
      });
    }

    const childId = linkQuery.recordset[0].ChildId;

    // Create SOS event
    const sosId = await SOS.create({
      parentId: parentUserId,
      childId,
      message: message || 'Emergency SOS triggered by parent',
      location,
    });

    // Get parent details
    const parent = await pool
      .request()
      .input('userId', mssql.Int, parentUserId)
      .query('SELECT Name, Email, PhoneNumber FROM Users WHERE UserId = @userId');

    const parentName = (parent.recordset && parent.recordset.length > 0) ? parent.recordset[0].Name : 'Parent';

    let baseMessage = message || `${parentName} has triggered an emergency SOS!`;
    let pushMessage = baseMessage;
    
    let locObj = null;
    if (location) {
      if (typeof location === 'string') {
        try { 
          locObj = JSON.parse(location); 
        } catch(e) {
          console.warn('⚠️ [SOS] Location was not valid JSON string:', e.message);
        }
      } else {
        locObj = location;
      }
    }

    if (locObj && locObj.latitude && locObj.longitude) {
      const mapsLink = `https://maps.google.com/?q=${locObj.latitude},${locObj.longitude}`;
      pushMessage += `\n📍 Location: ${mapsLink}`;
    }

    // Create alert for the child
    await Alert.create({
      parentId: childId, // Alert goes to child
      childId: parentUserId, // Triggered by parent
      alertType: 'sos',
      title: '🚨 Emergency SOS',
      message: pushMessage,
      severity: 'critical',
      relatedEntityId: sosId,
      relatedEntityType: 'sos',
    });

    // Send Push Notification asynchronously
    sendPushNotification(childId, '🚨 Emergency SOS', pushMessage);

    // Send real-time notification to child
    sendNotificationToUser(childId, 'sos_alert', {
      sosId,
      parentId: parentUserId,
      message: message || 'Emergency SOS triggered',
      location,
      timestamp: new Date(),
    });

    res.status(201).json({
      success: true,
      message: 'SOS triggered successfully',
      data: {
        sosId,
        childId,
        parent: (parent.recordset && parent.recordset.length > 0) ? parent.recordset[0] : null,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error('Trigger SOS error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger SOS',
      error: error.message,
    });
  }
};

// Get SOS events (parent view)
const getMySOS = async (req, res) => {
  try {
    const parentUserId = req.user.userId;

    const sosEvents = await SOS.getByParentId(parentUserId);

    res.status(200).json({
      success: true,
      count: sosEvents.length,
      data: sosEvents,
    });
  } catch (error) {
    console.error('Get SOS events error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get SOS events',
      error: error.message,
    });
  }
};

// Get active SOS events (parent view)
const getActiveSOS = async (req, res) => {
  try {
    const parentUserId = req.user.userId;

    const sosEvents = await SOS.getActiveByParentId(parentUserId);

    res.status(200).json({
      success: true,
      count: sosEvents.length,
      data: sosEvents,
    });
  } catch (error) {
    console.error('Get active SOS events error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get active SOS events',
      error: error.message,
    });
  }
};

// Get SOS alerts for child
const getSOSForChild = async (req, res) => {
  try {
    const childUserId = req.user.userId;

    const sosEvents = await SOS.getByChildId(childUserId);

    res.status(200).json({
      success: true,
      count: sosEvents.length,
      data: sosEvents,
    });
  } catch (error) {
    console.error('Get SOS for child error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get SOS events',
      error: error.message,
    });
  }
};

// Child acknowledges SOS
const acknowledgeSOS = async (req, res) => {
  try {
    const { sosId } = req.params;
    const childUserId = req.user.userId;

    await SOS.acknowledge(sosId, childUserId);

    // Get SOS details
    const sosEvent = await SOS.findById(sosId);

    if (sosEvent) {
      // Notify parent that SOS was acknowledged
      sendNotificationToUser(sosEvent.ParentId, 'sos_acknowledged', {
        sosId,
        childName: sosEvent.ChildName,
        timestamp: new Date(),
      });
    }

    res.status(200).json({
      success: true,
      message: 'SOS acknowledged successfully',
    });
  } catch (error) {
    console.error('Acknowledge SOS error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to acknowledge SOS',
      error: error.message,
    });
  }
};

// Child resolves SOS
const resolveSOS = async (req, res) => {
  try {
    const { sosId } = req.params;
    const childUserId = req.user.userId;

    await SOS.resolve(sosId, childUserId);

    // Get SOS details
    const sosEvent = await SOS.findById(sosId);

    if (sosEvent) {
      // Notify parent that SOS was resolved
      sendNotificationToUser(sosEvent.ParentId, 'sos_resolved', {
        sosId,
        childName: sosEvent.ChildName,
        timestamp: new Date(),
      });
    }

    res.status(200).json({
      success: true,
      message: 'SOS resolved successfully',
    });
  } catch (error) {
    console.error('Resolve SOS error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve SOS',
      error: error.message,
    });
  }
};

// Get SOS statistics
const getSOSStats = async (req, res) => {
  try {
    const parentUserId = req.user.userId;
    const { days = 30 } = req.query;

    const stats = await SOS.getStats(parentUserId, days);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get SOS stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get SOS statistics',
      error: error.message,
    });
  }
};

module.exports = {
  triggerSOS,
  getMySOS,
  getActiveSOS,
  getSOSForChild,
  acknowledgeSOS,
  resolveSOS,
  getSOSStats,
};

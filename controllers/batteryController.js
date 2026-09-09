/**
 * Battery Controller
 * Handles battery monitoring and alert endpoints
 */

const BatteryAlert = require('../models/BatteryAlert');
const BatteryLog = require('../models/BatteryLog');
const FCMToken = require('../models/FCMToken');
const FCMService = require('../services/fcmService');
const ParentChildLink = require('../models/ParentChildLink');
const User = require('../models/User');
const { sendNotificationToUser } = require('../services/socketService');

/**
 * Report battery status and trigger alert if needed
 * POST /api/battery/report
 * Body: { batteryPercentage, batteryState, deviceInfo }
 */
exports.reportBatteryStatus = async (req, res) => {
  try {
    const parentUserId = req.user.userId; // Use lowercase userId to match JWT token
    const { batteryPercentage, batteryState, deviceInfo } = req.body;
    
    console.log("BACKEND RECEIVED BATTERY:", req.body);

    // ===== LIVE BATTERY CONSOLE DISPLAY =====
    const batteryIcon = batteryPercentage >= 80 ? '🔋' : batteryPercentage >= 50 ? '🔋' : batteryPercentage >= 20 ? '🪫' : '🪫';
    const stateIcon = batteryState === 'charging' ? '⚡' : '🔌';
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    
    console.log('\n' + '='.repeat(60));
    console.log(`${batteryIcon} LIVE BATTERY STATUS - Parent ID: ${parentUserId}`);
    console.log('='.repeat(60));
    console.log(`⏰ Time:       ${timestamp}`);
    console.log(`📊 Battery:    ${batteryPercentage}%`);
    console.log(`${stateIcon} State:      ${batteryState.toUpperCase()}`);
    console.log(`🔔 Alert?:     ${batteryPercentage <= 20 && batteryState !== 'charging' ? '✅ YES - WILL TRIGGER' : '❌ NO'}`);
    console.log('='.repeat(60) + '\n');
    // ===== END LIVE BATTERY DISPLAY =====

    // Sanitize battery percentage
    const safePercentage = Math.max(0, Math.min(100, (batteryPercentage < 0 ? 100 : batteryPercentage)));

    // Log battery status
    await BatteryLog.create(parentUserId, safePercentage, batteryState);

    // Look up linked caretaker for real-time socket broadcast & alert
    const caretakerId = await BatteryAlert.getCaretakerId(parentUserId);
    if (caretakerId) {
      sendNotificationToUser(caretakerId, 'battery_updated', {
        parentId: parentUserId,
        batteryPercentage: safePercentage,
        batteryState,
        isCharging: batteryState === 'charging' || batteryState === 'full',
        timestamp: new Date().toISOString(),
      });
      console.log(`📡 Broadcast battery_updated to Caregiver ${caretakerId}: ${safePercentage}% (${batteryState})`);
    }

    // Check if alert is needed (battery <= 20%)
    const shouldAlert = safePercentage <= 20 && batteryState !== 'charging' && batteryState !== 'unsupported';

    if (!shouldAlert) {
      return res.json({
        success: true,
        message: 'Battery status logged and broadcast',
        alertTriggered: false
      });
    }

    if (!caretakerId) {
      return res.json({
        success: true,
        message: 'Battery status logged. No linked caretaker found.',
        alertTriggered: false
      });
    }

    // Create alert with rate limiting
    const alertResult = await BatteryAlert.create(
      parentUserId,
      caretakerId,
      batteryPercentage,
      batteryState,
      JSON.stringify(deviceInfo)
    );

    if (alertResult.rateLimited) {
      return res.json({
        success: true,
        message: alertResult.message,
        alertTriggered: false,
        rateLimited: true
      });
    }

    // Get parent name for messages
    const parent = await User.findById(parentUserId);
    const parentName = parent ? parent.Name : 'Parent';

    // ALWAYS emit real-time socket event (works even without push tokens, e.g. web/Expo Go)
    sendNotificationToUser(caretakerId, 'new_alert', {
      title: '⚠️ Low Battery',
      message: `${parentName}'s phone battery is down to ${batteryPercentage}%.`
    });

    // Get caretaker FCM tokens
    const caretakerTokens = await FCMToken.getActiveTokens(caretakerId);
    if (caretakerTokens.length === 0) {
      console.log(`⚠️ No FCM tokens found for Caretaker ${caretakerId}`);
      return res.json({
        success: true,
        message: 'Alert created but caretaker has no active devices',
        alertTriggered: true,
        alertId: alertResult.alertId
      });
    }

    // Send FCM notification
    const fcmResult = await FCMService.sendBatteryAlert(
      caretakerTokens.map(t => t.FCMToken),
      {
        title: '⚠️ Low Battery Alert',
        body: `${parentName}'s phone battery is down to ${batteryPercentage}%.`,
        data: {
          type: 'battery_alert',
          alertId: alertResult.alertId.toString(),
          parentUserId: parentUserId.toString()
        }
      }
    );
    
    if (fcmResult.sentCount > 0) {
      await BatteryAlert.updateStatus(alertResult.alertId, 'sent');
    }

    // Deactivate invalid tokens
    for (const invalidToken of fcmResult.invalidTokens) {
      await FCMToken.deactivateToken(caretakerId, invalidToken);
    }

    res.json({
      success: true,
      message: 'Battery alert sent successfully',
      alertTriggered: true,
      alertId: alertResult.alertId,
      notificationsSent: fcmResult.sentCount
    });
  } catch (error) {
    console.error('❌ Error in reportBatteryStatus:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to report battery status',
      error: error.message
    });
  }
};

/**
 * Get current battery status
 * GET /api/battery/status/:parentUserId
 */
exports.getBatteryStatus = async (req, res) => {
  try {
    const { parentUserId } = req.params;
    const requestingUserId = req.user.userId;
    const requestingUserRole = req.user.role;

    console.log('🔋 getBatteryStatus called:', { parentUserId, requestingUserId, requestingUserRole });

    // Check permissions
    if (requestingUserRole === 'parent' && requestingUserId !== parseInt(parentUserId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const status = await BatteryLog.getCurrentStatus(parseInt(parentUserId));
    
    console.log('📊 Battery status retrieved:', status);

    // If queried by caregiver, prompt the parent device via socket to sample fresh telemetry in the background
    if (requestingUserRole === 'child') {
      sendNotificationToUser(parseInt(parentUserId), 'request_battery_status', {
        requestedBy: requestingUserId,
        timestamp: new Date().toISOString(),
      });
    }

    // Convert camelCase to PascalCase for mobile app compatibility
    const formattedStatus = status ? {
      BatteryPercentage: status.batteryPercentage,
      BatteryState: status.batteryState,
      IsCharging: status.isCharging,
      Timestamp: status.lastUpdated,
      MinutesAgo: status.minutesAgo ?? 0,
      IsStale: status.isStale ?? false,
      BatteryColor: status.batteryColor ?? 'green',
      ShouldAlert: status.shouldAlert ?? false,
    } : null;

    res.json({
      success: true,
      data: formattedStatus
    });
  } catch (error) {
    console.error('❌ Error in getBatteryStatus:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to get battery status',
      error: error.message
    });
  }
};

/**
 * Get battery history
 * GET /api/battery/history/:parentUserId?hours=24
 */
exports.getBatteryHistory = async (req, res) => {
  try {
    const { parentUserId } = req.params;
    const { hours = 24 } = req.query;
    const requestingUserId = req.user.userId;
    const requestingUserRole = req.user.role;

    // Check permissions
    if (requestingUserRole === 'parent' && requestingUserId !== parseInt(parentUserId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const history = await BatteryLog.getHistory(parseInt(parentUserId), parseInt(hours));

    res.json({
      success: true,
      history: history
    });
  } catch (error) {
    console.error('❌ Error in getBatteryHistory:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get battery history',
      error: error.message
    });
  }
};

/**
 * Get battery alert history
 * GET /api/battery/alerts?page=1&limit=20
 */
exports.getAlertHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { page = 1, limit = 20 } = req.query;

    const history = await BatteryAlert.getHistory(
      userId,
      userRole,
      parseInt(page),
      parseInt(limit)
    );

    res.json({
      success: true,
      alerts: history.alerts,
      pagination: history.pagination
    });
  } catch (error) {
    console.error('❌ Error in getAlertHistory:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get alert history',
      error: error.message
    });
  }
};

/**
 * Acknowledge battery alert
 * POST /api/battery/alerts/:alertId/acknowledge
 */
exports.acknowledgeAlert = async (req, res) => {
  try {
    const { alertId } = req.params;
    const caretakerId = req.user.userId;
    const userRole = req.user.role;

    // Only caretakers can acknowledge
    if (userRole !== 'child') {
      return res.status(403).json({
        success: false,
        message: 'Only caretakers can acknowledge alerts'
      });
    }

    const result = await BatteryAlert.acknowledge(parseInt(alertId), caretakerId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json({
      success: true,
      message: 'Alert acknowledged successfully'
    });
  } catch (error) {
    console.error('❌ Error in acknowledgeAlert:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to acknowledge alert',
      error: error.message
    });
  }
};

/**
 * Register FCM token
 * POST /api/battery/fcm/register
 * Body: { fcmToken, deviceInfo }
 */
exports.registerFCMToken = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { fcmToken, deviceInfo } = req.body;

    const result = await FCMToken.registerToken(
      userId,
      fcmToken,
      JSON.stringify(deviceInfo)
    );

    res.json({
      success: true,
      message: result.message,
      tokenId: result.tokenId
    });
  } catch (error) {
    console.error('❌ Error in registerFCMToken:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register FCM token',
      error: error.message
    });
  }
};

/**
 * Deactivate FCM token (logout)
 * POST /api/battery/fcm/deactivate
 * Body: { fcmToken }
 */
exports.deactivateFCMToken = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { fcmToken } = req.body;

    if (fcmToken) {
      await FCMToken.deactivateToken(userId, fcmToken);
    } else {
      // Deactivate all tokens if no specific token provided
      await FCMToken.deactivateAllTokens(userId);
    }

    res.json({
      success: true,
      message: 'FCM token deactivated successfully'
    });
  } catch (error) {
    console.error('❌ Error in deactivateFCMToken:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate FCM token',
      error: error.message
    });
  }
};

/**
 * Test FCM notification
 * POST /api/battery/fcm/test
 */
exports.testFCMNotification = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userName = req.user.Name;

    const tokens = await FCMToken.getActiveTokens(userId);
    if (tokens.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No active FCM tokens found for your account'
      });
    }

    const fcmResult = await FCMService.sendNotification(
      tokens.map(t => t.FCMToken),
      '🔔 Test Notification',
      `Hello ${userName}! Your battery monitoring system is working.`,
      {
        type: 'TEST',
        userId: String(userId)
      }
    );

    res.json({
      success: true,
      message: 'Test notification sent',
      sentCount: fcmResult.sentCount,
      failedCount: fcmResult.failedCount
    });
  } catch (error) {
    console.error('❌ Error in testFCMNotification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test notification',
      error: error.message
    });
  }
};

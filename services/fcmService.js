/**
 * FCM Service
 * Handles Firebase Cloud Messaging notifications
 */

const { getFirebaseAdmin, isFirebaseInitialized } = require('../config/firebase');
const FCMToken = require('../models/FCMToken');

class FCMService {
  /**
   * Send battery alert notification to caretaker
   * @param {Array<string>} fcmTokens - Array of FCM tokens
   * @param {Object} alertData - Alert data
   * @returns {Promise<Object>} Result object with success/failure details
   */
  static async sendBatteryAlert(fcmTokens, alertData) {
    if (!isFirebaseInitialized()) {
      console.warn('⚠️ Firebase not initialized. Skipping FCM notification.');
      return {
        success: false,
        message: 'Firebase not initialized',
        sentCount: 0,
        failedCount: fcmTokens.length
      };
    }

    const admin = getFirebaseAdmin();
    const { parentName, batteryPercentage, batteryState, alertId } = alertData;

    const message = {
      notification: {
        title: `⚠️ Low Battery Alert - ${parentName}`,
        body: `Battery at ${batteryPercentage}% (${batteryState}). Tap to call or view details.`,
        sound: 'default',
        priority: 'high'
      },
      data: {
        type: 'BATTERY_ALERT',
        alertId: String(alertId),
        batteryPercentage: String(batteryPercentage),
        batteryState: batteryState,
        parentName: parentName,
        timestamp: new Date().toISOString()
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'alerts',
          sound: 'default',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            contentAvailable: true
          }
        }
      }
    };

    const results = {
      success: true,
      sentCount: 0,
      failedCount: 0,
      invalidTokens: []
    };

    // Send to all tokens
    for (const token of fcmTokens) {
      try {
        await admin.messaging().send({
          ...message,
          token: token
        });
        
        results.sentCount++;
        console.log(`✅ FCM sent to token: ${token.substring(0, 20)}...`);
        
        // Update last used timestamp
        await FCMToken.updateLastUsed(token);
      } catch (error) {
        results.failedCount++;
        console.error(`❌ Failed to send to token ${token.substring(0, 20)}...:`, error.message);
        
        // Check if token is invalid
        if (error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered') {
          results.invalidTokens.push(token);
        }
      }
    }

    // Log summary
    console.log(`📊 FCM Results: Sent=${results.sentCount}, Failed=${results.failedCount}, Invalid=${results.invalidTokens.length}`);

    return results;
  }

  /**
   * Send general notification
   * @param {Array<string>} fcmTokens - Array of FCM tokens
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   * @param {Object} data - Additional data
   * @returns {Promise<Object>} Result object
   */
  static async sendNotification(fcmTokens, title, body, data = {}) {
    if (!isFirebaseInitialized()) {
      console.warn('⚠️ Firebase not initialized. Skipping FCM notification.');
      return {
        success: false,
        message: 'Firebase not initialized',
        sentCount: 0,
        failedCount: fcmTokens.length
      };
    }

    const admin = getFirebaseAdmin();

    const message = {
      notification: {
        title: title,
        body: body,
        sound: 'default'
      },
      data: {
        ...data,
        timestamp: new Date().toISOString()
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          priority: 'high'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    };

    const results = {
      success: true,
      sentCount: 0,
      failedCount: 0,
      invalidTokens: []
    };

    for (const token of fcmTokens) {
      try {
        await admin.messaging().send({
          ...message,
          token: token
        });
        
        results.sentCount++;
        await FCMToken.updateLastUsed(token);
      } catch (error) {
        results.failedCount++;
        console.error(`❌ Failed to send notification:`, error.message);
        
        if (error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered') {
          results.invalidTokens.push(token);
        }
      }
    }

    return results;
  }

  /**
   * Send multicast notification to multiple tokens
   * @param {Array<string>} fcmTokens - Array of FCM tokens (max 500)
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   * @param {Object} data - Additional data
   * @returns {Promise<Object>} Result object
   */
  static async sendMulticast(fcmTokens, title, body, data = {}) {
    if (!isFirebaseInitialized()) {
      console.warn('⚠️ Firebase not initialized. Skipping FCM notification.');
      return {
        success: false,
        message: 'Firebase not initialized'
      };
    }

    if (fcmTokens.length === 0) {
      return {
        success: true,
        sentCount: 0,
        failedCount: 0
      };
    }

    const admin = getFirebaseAdmin();

    const message = {
      notification: {
        title: title,
        body: body
      },
      data: {
        ...data,
        timestamp: new Date().toISOString()
      },
      android: {
        priority: 'high'
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      },
      tokens: fcmTokens
    };

    try {
      const response = await admin.messaging().sendMulticast(message);
      
      console.log(`📊 Multicast sent: Success=${response.successCount}, Failed=${response.failureCount}`);
      
      return {
        success: true,
        sentCount: response.successCount,
        failedCount: response.failureCount,
        responses: response.responses
      };
    } catch (error) {
      console.error('❌ Error sending multicast:', error);
      throw error;
    }
  }
}

module.exports = FCMService;

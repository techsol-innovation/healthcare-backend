/**
 * BatteryAlert Model
 * Handles battery alert operations with rate limiting
 */

const sql = require('mssql');
const db = require('../config/database');

class BatteryAlert {
  /**
   * Create a new battery alert with rate limiting (30 minutes)
   * @param {number} parentUserId - Parent user ID
   * @param {number} caretakerId - Caretaker user ID
   * @param {number} batteryPercentage - Battery percentage (0-100)
   * @param {string} batteryState - Battery state (charging, unplugged, full, unknown)
   * @param {string} deviceInfo - Device information JSON string
   * @returns {Promise<Object>} Result object with success status and alert ID
   */
  static async create(parentUserId, caretakerId, batteryPercentage, batteryState, deviceInfo) {
    try {
      const pool = await db.getConnection();
      
      // Check for rate limiting (30 minutes)
      const lastAlertQuery = `
        SELECT TOP 1 AlertId, AlertSentAt,
               DATEDIFF(MINUTE, AlertSentAt, GETDATE()) AS MinutesSinceAlert
        FROM BatteryAlerts
        WHERE ParentUserId = @parentUserId
        ORDER BY AlertSentAt DESC
      `;
      
      const lastAlertResult = await pool.request()
        .input('parentUserId', sql.Int, parentUserId)
        .query(lastAlertQuery);
      
      // Rate limiting check
      if (lastAlertResult.recordset.length > 0) {
        const minutesSinceAlert = lastAlertResult.recordset[0].MinutesSinceAlert;
        if (minutesSinceAlert < 30) {
          console.log(`⏱️ Alert rate limited for Parent ${parentUserId}. Last alert: ${minutesSinceAlert} min ago`);
          return {
            success: false,
            message: `Alert rate limited. Please wait ${30 - minutesSinceAlert} more minutes.`,
            rateLimited: true,
            minutesToWait: 30 - minutesSinceAlert
          };
        }
      }
      
      // Create new alert
      const insertQuery = `
        INSERT INTO BatteryAlerts (
          ParentUserId, CaretakerId, BatteryPercentage, 
          BatteryState, AlertStatus, DeviceInfo, AlertSentAt
        )
        OUTPUT INSERTED.AlertId
        VALUES (
          @parentUserId, @caretakerId, @batteryPercentage,
          @batteryState, 'sent', @deviceInfo, GETDATE()
        )
      `;
      
      const result = await pool.request()
        .input('parentUserId', sql.Int, parentUserId)
        .input('caretakerId', sql.Int, caretakerId)
        .input('batteryPercentage', sql.Int, batteryPercentage)
        .input('batteryState', sql.VarChar(20), batteryState)
        .input('deviceInfo', sql.NVarChar(500), deviceInfo)
        .query(insertQuery);
      
      const alertId = result.recordset[0].AlertId;
      
      console.log(`✅ Battery alert created: AlertId=${alertId}, Parent=${parentUserId}, Battery=${batteryPercentage}%`);
      
      return {
        success: true,
        alertId,
        message: 'Alert created successfully',
        rateLimited: false
      };
    } catch (error) {
      console.error('❌ Error creating battery alert:', error);
      throw error;
    }
  }

  /**
   * Get alert history for a user
   * @param {number} userId - User ID
   * @param {string} userRole - User role ('parent' or 'child')
   * @param {number} pageSize - Number of records per page
   * @param {number} pageNumber - Page number
   * @returns {Promise<Array>} Array of alert objects
   */
  static async getHistory(userId, userRole, pageSize = 20, pageNumber = 1) {
    try {
      const pool = await db.getConnection();
      
      const offset = (pageNumber - 1) * pageSize;
      
      const query = `
        SELECT 
          ba.AlertId,
          ba.BatteryPercentage,
          ba.BatteryState,
          ba.AlertStatus,
          ba.IsAcknowledged,
          ba.AlertSentAt,
          ba.AcknowledgedAt,
          ba.DeviceInfo,
          parent.Name AS ParentName,
          parent.PhoneNumber AS ParentPhone,
          caretaker.Name AS CaretakerName,
          caretaker.PhoneNumber AS CaretakerPhone,
          DATEDIFF(MINUTE, ba.AlertSentAt, GETDATE()) AS MinutesSinceAlert
        FROM BatteryAlerts ba
        INNER JOIN Users parent ON ba.ParentUserId = parent.UserId
        INNER JOIN Users caretaker ON ba.CaretakerId = caretaker.UserId
        WHERE ${userRole === 'parent' ? 'ba.ParentUserId' : 'ba.CaretakerId'} = @userId
        ORDER BY ba.AlertSentAt DESC
        OFFSET @offset ROWS
        FETCH NEXT @pageSize ROWS ONLY
      `;
      
      const result = await pool.request()
        .input('userId', sql.Int, userId)
        .input('offset', sql.Int, offset)
        .input('pageSize', sql.Int, pageSize)
        .query(query);
      
      console.log(`📋 Retrieved ${result.recordset.length} battery alerts for User ${userId} (${userRole})`);
      
      return result.recordset;
    } catch (error) {
      console.error('❌ Error getting battery alert history:', error);
      throw error;
    }
  }

  /**
   * Acknowledge an alert (mark as read by caretaker)
   * @param {number} alertId - Alert ID
   * @param {number} caretakerId - Caretaker user ID
   * @returns {Promise<boolean>} Success status
   */
  static async acknowledge(alertId, caretakerId) {
    try {
      const pool = await db.getConnection();
      
      const query = `
        UPDATE BatteryAlerts
        SET IsAcknowledged = 1,
            AcknowledgedAt = GETDATE(),
            AlertStatus = 'read'
        WHERE AlertId = @alertId AND CaretakerId = @caretakerId
      `;
      
      const result = await pool.request()
        .input('alertId', sql.Int, alertId)
        .input('caretakerId', sql.Int, caretakerId)
        .query(query);
      
      const success = result.rowsAffected[0] > 0;
      
      if (success) {
        console.log(`✅ Alert ${alertId} acknowledged by Caretaker ${caretakerId}`);
      } else {
        console.log(`⚠️ Alert ${alertId} not found or already acknowledged`);
      }
      
      return success;
    } catch (error) {
      console.error('❌ Error acknowledging alert:', error);
      throw error;
    }
  }

  /**
   * Update alert status
   * @param {number} alertId - Alert ID
   * @param {number} userId - User ID (parent or caretaker)
   * @param {string} newStatus - New status (read, dismissed, expired)
   * @returns {Promise<boolean>} Success status
   */
  static async updateStatus(alertId, userId, newStatus) {
    try {
      const pool = await db.getConnection();
      
      const query = `
        UPDATE BatteryAlerts
        SET AlertStatus = @newStatus
        WHERE AlertId = @alertId 
        AND (ParentUserId = @userId OR CaretakerId = @userId)
      `;
      
      const result = await pool.request()
        .input('alertId', sql.Int, alertId)
        .input('userId', sql.Int, userId)
        .input('newStatus', sql.VarChar(20), newStatus)
        .query(query);
      
      const success = result.rowsAffected[0] > 0;
      
      if (success) {
        console.log(`✅ Alert ${alertId} status updated to '${newStatus}' by User ${userId}`);
      }
      
      return success;
    } catch (error) {
      console.error('❌ Error updating alert status:', error);
      throw error;
    }
  }

  /**
   * Get caretaker ID for a parent
   * @param {number} parentUserId - Parent user ID
   * @returns {Promise<number|null>} Caretaker ID or null
   */
  static async getCaretakerId(parentUserId) {
    try {
      const pool = await db.getConnection();
      
      const query = `
        SELECT TOP 1 ChildId AS CaretakerId
        FROM ParentChildLink
        WHERE ParentId = @parentUserId
      `;
      
      const result = await pool.request()
        .input('parentUserId', sql.Int, parentUserId)
        .query(query);
      
      return result.recordset.length > 0 ? result.recordset[0].CaretakerId : null;
    } catch (error) {
      console.error('❌ Error getting caretaker ID:', error);
      throw error;
    }
  }

  /**
   * Get unacknowledged alerts count for caretaker
   * @param {number} caretakerId - Caretaker user ID
   * @returns {Promise<number>} Count of unacknowledged alerts
   */
  static async getUnacknowledgedCount(caretakerId) {
    try {
      const pool = await db.getConnection();
      
      const query = `
        SELECT COUNT(*) AS UnacknowledgedCount
        FROM BatteryAlerts
        WHERE CaretakerId = @caretakerId 
        AND IsAcknowledged = 0
        AND AlertStatus = 'sent'
      `;
      
      const result = await pool.request()
        .input('caretakerId', sql.Int, caretakerId)
        .query(query);
      
      return result.recordset[0].UnacknowledgedCount;
    } catch (error) {
      console.error('❌ Error getting unacknowledged count:', error);
      return 0;
    }
  }
}

module.exports = BatteryAlert;

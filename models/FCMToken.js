/**
 * FCMToken Model
 * Handles Firebase Cloud Messaging token management
 */

const sql = require('mssql');
const db = require('../config/database');

class FCMToken {
  /**
   * Register or update FCM token for a user
   * @param {number} userId - User ID
   * @param {string} fcmToken - FCM device token
   * @param {string} deviceInfo - Device information JSON string
   * @returns {Promise<Object>} Result object
   */
  static async registerToken(userId, fcmToken, deviceInfo = null) {
    try {
      const pool = await db.getConnection();
      
      // Check if token already exists
      const checkQuery = `
        SELECT TokenId FROM FCMTokens
        WHERE UserId = @userId AND FCMToken = @fcmToken
      `;
      
      const checkResult = await pool.request()
        .input('userId', sql.Int, userId)
        .input('fcmToken', sql.NVarChar(500), fcmToken)
        .query(checkQuery);
      
      if (checkResult.recordset.length > 0) {
        // Update existing token
        const updateQuery = `
          UPDATE FCMTokens
          SET LastUsedAt = GETDATE(),
              DeviceInfo = @deviceInfo,
              IsActive = 1
          WHERE TokenId = @tokenId
        `;
        
        await pool.request()
          .input('tokenId', sql.Int, checkResult.recordset[0].TokenId)
          .input('deviceInfo', sql.NVarChar(sql.MAX), deviceInfo)
          .query(updateQuery);
        
        console.log(`🔄 Updated FCM token for User ${userId}`);
        return {
          success: true,
          message: 'Token updated',
          tokenId: checkResult.recordset[0].TokenId
        };
      } else {
        // Insert new token
        const insertQuery = `
          INSERT INTO FCMTokens (UserId, FCMToken, DeviceInfo, RegisteredAt, LastUsedAt, IsActive)
          VALUES (@userId, @fcmToken, @deviceInfo, GETDATE(), GETDATE(), 1);
          SELECT SCOPE_IDENTITY() AS TokenId;
        `;
        
        const insertResult = await pool.request()
          .input('userId', sql.Int, userId)
          .input('fcmToken', sql.NVarChar(500), fcmToken)
          .input('deviceInfo', sql.NVarChar(sql.MAX), deviceInfo)
          .query(insertQuery);
        
        console.log(`✅ Registered new FCM token for User ${userId}`);
        return {
          success: true,
          message: 'Token registered',
          tokenId: insertResult.recordset[0].TokenId
        };
      }
    } catch (error) {
      console.error('❌ Error registering FCM token:', error);
      throw error;
    }
  }

  /**
   * Get active FCM tokens for a user
   * @param {number} userId - User ID
   * @returns {Promise<Array>} Array of active FCM tokens
   */
  static async getActiveTokens(userId) {
    try {
      const pool = await db.getConnection();
      
      const query = `
        SELECT FCMToken, DeviceInfo, RegisteredAt, LastUsedAt
        FROM FCMTokens
        WHERE UserId = @userId AND IsActive = 1
        ORDER BY LastUsedAt DESC
      `;
      
      const result = await pool.request()
        .input('userId', sql.Int, userId)
        .query(query);
      
      return result.recordset;
    } catch (error) {
      console.error('❌ Error getting active tokens:', error);
      throw error;
    }
  }

  /**
   * Deactivate a specific FCM token
   * @param {number} userId - User ID
   * @param {string} fcmToken - FCM token to deactivate
   * @returns {Promise<boolean>} Success status
   */
  static async deactivateToken(userId, fcmToken) {
    try {
      const pool = await db.getConnection();
      
      const query = `
        UPDATE FCMTokens
        SET IsActive = 0
        WHERE UserId = @userId AND FCMToken = @fcmToken
      `;
      
      await pool.request()
        .input('userId', sql.Int, userId)
        .input('fcmToken', sql.NVarChar(500), fcmToken)
        .query(query);
      
      console.log(`🔕 Deactivated FCM token for User ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ Error deactivating token:', error);
      return false;
    }
  }

  /**
   * Deactivate all tokens for a user (logout)
   * @param {number} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  static async deactivateAllTokens(userId) {
    try {
      const pool = await db.getConnection();
      
      const query = `
        UPDATE FCMTokens
        SET IsActive = 0
        WHERE UserId = @userId
      `;
      
      await pool.request()
        .input('userId', sql.Int, userId)
        .query(query);
      
      console.log(`🔕 Deactivated all FCM tokens for User ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ Error deactivating all tokens:', error);
      return false;
    }
  }

  /**
   * Clean up inactive tokens (older than 90 days)
   * @returns {Promise<number>} Number of deleted tokens
   */
  static async cleanupInactiveTokens() {
    try {
      const pool = await db.getConnection();
      
      const query = `
        DELETE FROM FCMTokens
        WHERE IsActive = 0 
        AND LastUsedAt < DATEADD(DAY, -90, GETDATE())
      `;
      
      const result = await pool.request().query(query);
      const deletedCount = result.rowsAffected[0];
      
      if (deletedCount > 0) {
        console.log(`🧹 Cleaned up ${deletedCount} inactive FCM tokens`);
      }
      
      return deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up inactive tokens:', error);
      return 0;
    }
  }

  /**
   * Update last used timestamp for a token
   * @param {string} fcmToken - FCM token
   * @returns {Promise<void>}
   */
  static async updateLastUsed(fcmToken) {
    try {
      const pool = await db.getConnection();
      
      const query = `
        UPDATE FCMTokens
        SET LastUsedAt = GETDATE()
        WHERE FCMToken = @fcmToken
      `;
      
      await pool.request()
        .input('fcmToken', sql.NVarChar(500), fcmToken)
        .query(query);
    } catch (error) {
      console.error('❌ Error updating last used:', error);
      // Don't throw - this is not critical
    }
  }
}

module.exports = FCMToken;

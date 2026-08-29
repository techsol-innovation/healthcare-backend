const { getConnection, mssql } = require('../config/database');

class Heartbeat {
  // Record heartbeat from child device
  static async record({ childId, deviceInfo, batteryLevel }) {
    try {
      const pool = await getConnection();
      
      // Validate inputs
      if (!childId) {
        throw new Error('childId is required');
      }
      
      // Ensure deviceInfo is a string
      const deviceInfoString = typeof deviceInfo === 'string' 
        ? deviceInfo 
        : JSON.stringify(deviceInfo || { device: 'unknown' });
      
      // Ensure batteryLevel is a number or null
      const batteryLevelInt = batteryLevel !== undefined && batteryLevel !== null 
        ? parseInt(batteryLevel) 
        : null;
      
      console.log('🔍 Heartbeat.record params:', { 
        childId, 
        deviceInfoType: typeof deviceInfoString,
        deviceInfoLength: deviceInfoString?.length,
        batteryLevel: batteryLevelInt 
      });
      
      const result = await pool
        .request()
        .input('childId', mssql.Int, childId)
        .input('deviceInfo', mssql.NVarChar, deviceInfoString)
        .input('batteryLevel', mssql.Int, batteryLevelInt)
        .query(`
          INSERT INTO Heartbeats (ChildId, DeviceInfo, BatteryLevel, LastSeenAt, CreatedAt)
          VALUES (@childId, @deviceInfo, @batteryLevel, GETDATE(), GETDATE());
          SELECT SCOPE_IDENTITY() AS HeartbeatId;
        `);
      
      if (result.recordset && result.recordset.length > 0) {
        return result.recordset[0].HeartbeatId;
      }
      return 1; // Fallback mock ID
    } catch (error) {
      console.error('❌ Heartbeat.record error:', error.message);
      throw error;
    }
  }

  // Get last heartbeat for a child
  static async getLastHeartbeat(childId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('childId', mssql.Int, childId)
      .query(`
        SELECT TOP 1 * FROM Heartbeats 
        WHERE ChildId = @childId 
        ORDER BY LastSeenAt DESC
      `);
    
    return result.recordset[0] || null;
  }

  // Get all children who haven't sent heartbeat in X minutes
  static async getOfflineChildren(thresholdMinutes = 15) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('thresholdMinutes', mssql.Int, thresholdMinutes)
      .query(`
        SELECT DISTINCT 
          u.UserId as ChildId,
          u.Name as ChildName,
          u.Email as ChildEmail,
          h.LastSeenAt,
          DATEDIFF(MINUTE, h.LastSeenAt, GETDATE()) as MinutesOffline
        FROM Users u
        INNER JOIN (
          SELECT ChildId, MAX(LastSeenAt) as LastSeenAt
          FROM Heartbeats
          GROUP BY ChildId
        ) h ON u.UserId = h.ChildId
        WHERE u.Role = 'parent'
          AND DATEDIFF(MINUTE, h.LastSeenAt, GETDATE()) >= @thresholdMinutes
      `);
    
    return result.recordset;
  }

  // Get heartbeat history for a child
  static async getHistory(childId, hours = 24) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('childId', mssql.Int, childId)
      .input('hours', mssql.Int, hours)
      .query(`
        SELECT * FROM Heartbeats 
        WHERE ChildId = @childId 
          AND LastSeenAt >= DATEADD(HOUR, -@hours, GETDATE())
        ORDER BY LastSeenAt DESC
      `);
    
    return result.recordset;
  }

  // Check if child is online
  static async isOnline(childId, thresholdMinutes = 15) {
    const lastHeartbeat = await this.getLastHeartbeat(childId);
    if (!lastHeartbeat) return false;

    const minutesAgo = Math.floor(
      (new Date() - new Date(lastHeartbeat.LastSeenAt)) / 1000 / 60
    );
    
    return minutesAgo < thresholdMinutes;
  }
}

module.exports = Heartbeat;

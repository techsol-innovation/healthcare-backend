const { getConnection, mssql } = require('../config/database');

class BatteryLog {
  // Create/log battery status (new method for battery monitoring system)
  static async create(parentUserId, batteryPercentage, batteryState) {
    try {
      const pool = await getConnection();
      const isCharging = batteryState === 'charging' ? 1 : 0;
      const pId = parseInt(parentUserId, 10);
      const safePct = Math.max(0, Math.min(100, parseInt(batteryPercentage, 10) || 0));
      
      const result = await pool
        .request()
        .input('parentUserId', mssql.Int, pId)
        .input('batteryPercentage', mssql.Int, safePct)
        .input('batteryState', mssql.VarChar(20), batteryState)
        .input('isCharging', mssql.Bit, isCharging)
        .query(`
          INSERT INTO BatteryLogs (ParentUserId, BatteryPercentage, BatteryState, IsCharging, LoggedAt, ChildId, BatteryLevel)
          VALUES (@parentUserId, @batteryPercentage, @batteryState, @isCharging, GETDATE(), @parentUserId, @batteryPercentage);
          SELECT SCOPE_IDENTITY() AS LogId;
        `);
      
      console.log(`📊 Battery logged: Parent=${pId}, Battery=${safePct}%, State=${batteryState}`);
      return result.recordset[0]?.LogId;
    } catch (error) {
      console.error('❌ Error logging battery status:', error);
      // Don't throw - logging failure shouldn't break main flow
    }
  }

  // Get current battery status (new method)
  static async getCurrentStatus(parentUserId) {
    try {
      console.log('🔍 BatteryLog.getCurrentStatus called with:', { parentUserId, type: typeof parentUserId });
      
      const pool = await getConnection();
      
      console.log('🔍 Executing query for parentUserId:', parentUserId);
      
      const result = await pool
        .request()
        .input('parentUserId', mssql.Int, parentUserId)
        .query(`
          SELECT TOP 1
            BatteryPercentage,
            BatteryState,
            IsCharging,
            LoggedAt
          FROM BatteryLogs
          WHERE ParentUserId = @parentUserId
          ORDER BY LoggedAt DESC
        `);
      
      console.log('🔍 Query result:', { rowCount: result.recordset.length, data: result.recordset[0] });
      
      if (result.recordset.length === 0) {
        console.log('⚠️ No battery data found for parent:', parentUserId);
        return null;
      }
      
      const log = result.recordset[0];
      const batteryColor = log.BatteryPercentage >= 50 ? 'green'
        : log.BatteryPercentage >= 21 ? 'orange'
        : 'red';
      
      const shouldAlert = log.BatteryPercentage <= 20 && !log.IsCharging;
      
      const statusResult = {
        batteryPercentage: log.BatteryPercentage,
        batteryState: log.BatteryState,
        isCharging: log.IsCharging,
        lastUpdated: log.LoggedAt,
        batteryColor,
        shouldAlert
      };
      
      console.log('✅ Returning battery status:', statusResult);
      return statusResult;
    } catch (error) {
      console.error('❌ Error getting current battery status:', error);
      console.error('Stack:', error.stack);
      throw error;
    }
  }

  // Get battery history for charting (supports ParentUserId or fallback ChildId)
  static async getHistory(parentUserId, hours = 24) {
    try {
      const pool = await getConnection();
      const pId = parseInt(parentUserId, 10);
      const h = parseInt(hours, 10) || 24;
      
      const result = await pool
        .request()
        .input('parentUserId', mssql.Int, pId)
        .input('hours', mssql.Int, h)
        .query(`
          SELECT 
            BatteryPercentage,
            BatteryState,
            IsCharging,
            LoggedAt
          FROM BatteryLogs
          WHERE (ParentUserId = @parentUserId OR ChildId = @parentUserId)
          AND LoggedAt >= DATEADD(HOUR, -@hours, GETDATE())
          ORDER BY LoggedAt ASC
        `);
      
      return result.recordset;
    } catch (error) {
      console.error('❌ Error getting battery history:', error);
      throw error;
    }
  }

  // Clean up old battery logs (older than 7 days to save free database storage)
  static async cleanupOldLogs() {
    try {
      const pool = await getConnection();
      
      const result = await pool
        .request()
        .query(`
          DELETE FROM BatteryLogs
          WHERE LoggedAt < DATEADD(DAY, -7, GETDATE())
        `);
      
      const deletedCount = result.rowsAffected[0];
      
      if (deletedCount > 0) {
        console.log(`🧹 Cleaned up ${deletedCount} old battery logs (older than 7 days)`);
      }
      
      return deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up old logs:', error);
      return 0;
    }
  }

  // LEGACY METHODS BELOW (kept for backward compatibility)
  
  // Log battery status
  static async log({ childId, batteryLevel, isCharging }) {
    try {
      const pool = await getConnection();
      
      // Validate inputs
      if (!childId) {
        throw new Error('childId is required for BatteryLog.log');
      }
      
      if (batteryLevel === undefined || batteryLevel === null) {
        throw new Error('batteryLevel is required for BatteryLog.log');
      }
      
      // Determine battery state from isCharging flag
      const batteryState = isCharging ? 'charging' : 'unplugged';
      
      // Ensure all values are proper types
      const childIdInt = parseInt(childId);
      const batteryLevelInt = parseInt(batteryLevel);
      const isChargingBit = isCharging ? 1 : 0;
      
      console.log('🔍 BatteryLog.log params:', { 
        childId: childIdInt, 
        batteryLevel: batteryLevelInt, 
        isCharging: isChargingBit,
        batteryState 
      });
      
      const result = await pool
        .request()
        .input('childId', mssql.Int, childIdInt)
        .input('batteryLevel', mssql.Int, batteryLevelInt)
        .input('isCharging', mssql.Bit, isChargingBit)
        .input('batteryState', mssql.VarChar(20), batteryState)
        .query(`
          INSERT INTO BatteryLogs (ChildId, BatteryLevel, IsCharging, LoggedAt, ParentUserId, BatteryPercentage, BatteryState)
          VALUES (@childId, @batteryLevel, @isCharging, GETDATE(), @childId, @batteryLevel, @batteryState);
          SELECT SCOPE_IDENTITY() AS BatteryLogId;
        `);
      
      if (result.recordset && result.recordset.length > 0) {
        return result.recordset[0].BatteryLogId;
      }
      return 1; // Fallback mock ID
    } catch (error) {
      console.error('❌ BatteryLog.log error:', error.message);
      throw error;
    }
  }

  // Get latest battery status for a child
  static async getLatest(childId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('childId', mssql.Int, childId)
      .query(`
        SELECT TOP 1 * FROM BatteryLogs 
        WHERE ChildId = @childId 
        ORDER BY LoggedAt DESC
      `);
    
    return result.recordset[0] || null;
  }

  // Get battery history for a child (legacy)
  static async getChildHistory(childId, hours = 24) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('childId', mssql.Int, childId)
      .input('hours', mssql.Int, hours)
      .query(`
        SELECT * FROM BatteryLogs 
        WHERE ChildId = @childId 
          AND LoggedAt >= DATEADD(HOUR, -@hours, GETDATE())
        ORDER BY LoggedAt DESC
      `);
    
    return result.recordset;
  }

  // Get children/parents with low battery
  static async getLowBatteryChildren(threshold = 20) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('threshold', mssql.Int, threshold)
      .query(`
        SELECT DISTINCT 
          u.UserId as ChildId,
          u.Name as ChildName,
          u.Email as ChildEmail,
          ISNULL(bl.BatteryPercentage, bl.BatteryLevel) as BatteryLevel,
          bl.IsCharging,
          bl.LoggedAt
        FROM Users u
        INNER JOIN (
          SELECT ISNULL(ParentUserId, ChildId) AS TargetUserId, MAX(LoggedAt) as LatestLog
          FROM BatteryLogs
          WHERE ParentUserId IS NOT NULL OR ChildId IS NOT NULL
          GROUP BY ISNULL(ParentUserId, ChildId)
        ) latest ON u.UserId = latest.TargetUserId
        INNER JOIN BatteryLogs bl ON (ISNULL(bl.ParentUserId, bl.ChildId) = latest.TargetUserId) AND latest.LatestLog = bl.LoggedAt
        WHERE u.Role = 'parent'
          AND ISNULL(bl.BatteryPercentage, bl.BatteryLevel) <= @threshold
          AND bl.IsCharging = 0
      `);
    
    return result.recordset;
  }
}

module.exports = BatteryLog;

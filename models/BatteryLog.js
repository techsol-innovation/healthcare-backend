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

  // Get current battery status (unified across BatteryLogs and Heartbeats)
  static async getCurrentStatus(parentUserId) {
    try {
      console.log('🔍 BatteryLog.getCurrentStatus called with:', { parentUserId, type: typeof parentUserId });
      
      const pool = await getConnection();
      const pId = parseInt(parentUserId, 10);
      
      // 1. Fetch latest record from BatteryLogs (checking ParentUserId and legacy ChildId)
      const batteryResult = await pool
        .request()
        .input('parentUserId', mssql.Int, pId)
        .query(`
          SELECT TOP 1
            BatteryPercentage,
            BatteryState,
            IsCharging,
            LoggedAt
          FROM BatteryLogs
          WHERE (ParentUserId = @parentUserId OR ChildId = @parentUserId)
          ORDER BY LoggedAt DESC
        `);
      
      // 2. Fetch latest record from Heartbeats (which samples battery every 5-15m)
      const heartbeatResult = await pool
        .request()
        .input('parentUserId', mssql.Int, pId)
        .query(`
          SELECT TOP 1
            BatteryLevel,
            LastSeenAt
          FROM Heartbeats
          WHERE ChildId = @parentUserId AND BatteryLevel IS NOT NULL
          ORDER BY LastSeenAt DESC
        `);
      
      const log = batteryResult.recordset[0] || null;
      const hb = heartbeatResult.recordset[0] || null;

      if (!log && !hb) {
        console.log('⚠️ No battery data found in BatteryLogs or Heartbeats for parent:', pId);
        return null;
      }

      // Determine which reading is fresher
      let selectedPercentage = 100;
      let selectedState = 'unplugged';
      let selectedIsCharging = false;
      let selectedTimestamp = new Date();

      if (log && hb) {
        const logTime = new Date(log.LoggedAt).getTime();
        const hbTime = new Date(hb.LastSeenAt).getTime();

        if (hbTime > logTime) {
          selectedPercentage = hb.BatteryLevel ?? log.BatteryPercentage;
          selectedState = log.BatteryState || 'unplugged';
          selectedIsCharging = !!log.IsCharging;
          selectedTimestamp = hb.LastSeenAt;
        } else {
          selectedPercentage = log.BatteryPercentage;
          selectedState = log.BatteryState;
          selectedIsCharging = !!log.IsCharging;
          selectedTimestamp = log.LoggedAt;
        }
      } else if (log) {
        selectedPercentage = log.BatteryPercentage;
        selectedState = log.BatteryState;
        selectedIsCharging = !!log.IsCharging;
        selectedTimestamp = log.LoggedAt;
      } else {
        selectedPercentage = hb.BatteryLevel;
        selectedState = 'unplugged';
        selectedIsCharging = false;
        selectedTimestamp = hb.LastSeenAt;
      }

      const diffMs = Date.now() - new Date(selectedTimestamp).getTime();
      const minutesAgo = Math.max(0, Math.floor(diffMs / 60000));
      const isStale = minutesAgo > 25;

      const batteryColor = selectedPercentage >= 50 ? 'green'
        : selectedPercentage >= 21 ? 'orange'
        : 'red';
      
      const shouldAlert = selectedPercentage <= 20 && !selectedIsCharging;
      
      const statusResult = {
        batteryPercentage: selectedPercentage,
        batteryState: selectedState,
        isCharging: selectedIsCharging,
        lastUpdated: selectedTimestamp,
        minutesAgo,
        isStale,
        batteryColor,
        shouldAlert
      };
      
      console.log('✅ Returning unified battery status:', statusResult);
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

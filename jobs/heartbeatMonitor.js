const cron = require('node-cron');
const Heartbeat = require('../models/Heartbeat');
const BatteryLog = require('../models/BatteryLog');
const MedicineTracking = require('../models/MedicineTracking');
const Alert = require('../models/Alert');
const { sendNotificationToUser } = require('../services/socketService');
const { sendPushNotification } = require('../services/notificationService');
const { getConnection, mssql } = require('../config/database');

// Check for offline children and create alerts
const checkOfflineChildren = async () => {
  try {
    console.log('🔍 Checking for offline children...');

    const thresholdMinutes = 15;
    const offlineChildren = await Heartbeat.getOfflineChildren(thresholdMinutes);

    console.log(`Found ${offlineChildren.length} offline children`);

    const pool = await getConnection();

    for (const child of offlineChildren) {
      // Find all caregivers linked to this patient (ParentChildLink stores ParentId=patient, ChildId=caregiver)
      const caregivers = await pool
        .request()
        .input('patientId', mssql.Int, child.ChildId)
        .query(`
          SELECT pcl.ChildId AS CaregiverId, u.Name AS CaregiverName
          FROM ParentChildLink pcl
          JOIN Users u ON pcl.ChildId = u.UserId
          WHERE pcl.ParentId = @patientId
          UNION
          SELECT pcl.ParentId AS CaregiverId, u.Name AS CaregiverName
          FROM ParentChildLink pcl
          JOIN Users u ON pcl.ParentId = u.UserId
          WHERE pcl.ChildId = @patientId AND u.Role = 'child'
        `);

      for (const caregiver of caregivers.recordset) {
        // Check if alert already exists for this offline event (within last hour)
        const existingAlert = await pool
          .request()
          .input('parentId', mssql.Int, caregiver.CaregiverId)
          .input('childId', mssql.Int, child.ChildId)
          .query(`
            SELECT AlertId FROM Alerts
            WHERE ParentId = @parentId 
              AND ChildId = @childId
              AND AlertType = 'offline'
              AND CreatedAt >= DATEADD(HOUR, -1, GETDATE())
          `);

        if (existingAlert.recordset.length === 0) {
          // Create offline alert (sent to caregiver)
          const alertId = await Alert.create({
            parentId: caregiver.CaregiverId,
            childId: child.ChildId,
            alertType: 'offline',
            title: '📵 Device Offline',
            message: `${child.ChildName} has been offline for ${child.MinutesOffline} minutes. Last seen at ${new Date(child.LastSeenAt).toLocaleString()}`,
            severity: 'high',
          });

          // Send real-time notification to caregiver
          sendNotificationToUser(caregiver.CaregiverId, 'offline_alert', {
            alertId,
            childId: child.ChildId,
            childName: child.ChildName,
            minutesOffline: child.MinutesOffline,
            lastSeen: child.LastSeenAt,
            timestamp: new Date(),
          });

          // Send native push notification to caregiver
          sendPushNotification(
            caregiver.CaregiverId, 
            '📵 Device Offline', 
            `${child.ChildName} has been offline for ${child.MinutesOffline} minutes. Last seen at ${new Date(child.LastSeenAt).toLocaleTimeString()}.`
          );

          console.log(`✅ Created offline alert for ${child.ChildName} -> caregiver ${caregiver.CaregiverName}`);
        }
      }
    }

    console.log('✅ Offline children check completed');
  } catch (error) {
    console.error('❌ Error checking offline children:', error);
  }
};

// Check for low battery and create alerts
const checkLowBattery = async () => {
  try {
    console.log('🔍 Checking for low battery...');

    const threshold = 20;
    const lowBatteryChildren = await BatteryLog.getLowBatteryChildren(threshold);

    console.log(`Found ${lowBatteryChildren.length} children/parents with low battery`);

    const pool = await getConnection();

    for (const child of lowBatteryChildren) {
      // Find all caregivers linked to this patient (ParentChildLink stores ParentId=patient, ChildId=caregiver)
      const caregivers = await pool
        .request()
        .input('patientId', mssql.Int, child.ChildId)
        .query(`
          SELECT pcl.ChildId AS CaregiverId, u.Name AS CaregiverName
          FROM ParentChildLink pcl
          JOIN Users u ON pcl.ChildId = u.UserId
          WHERE pcl.ParentId = @patientId
          UNION
          SELECT pcl.ParentId AS CaregiverId, u.Name AS CaregiverName
          FROM ParentChildLink pcl
          JOIN Users u ON pcl.ParentId = u.UserId
          WHERE pcl.ChildId = @patientId AND u.Role = 'child'
        `);

      for (const caregiver of caregivers.recordset) {
        // Check if alert already exists for this low battery event (within last 2 hours)
        const existingAlert = await pool
          .request()
          .input('parentId', mssql.Int, caregiver.CaregiverId)
          .input('childId', mssql.Int, child.ChildId)
          .query(`
            SELECT AlertId FROM Alerts
            WHERE ParentId = @parentId 
              AND ChildId = @childId
              AND AlertType = 'low_battery'
              AND CreatedAt >= DATEADD(HOUR, -2, GETDATE())
          `);

        if (existingAlert.recordset.length === 0) {
          // Create low battery alert (sent to caregiver)
          const alertId = await Alert.create({
            parentId: caregiver.CaregiverId,
            childId: child.ChildId,
            alertType: 'low_battery',
            title: '🔋 Low Battery',
            message: `${child.ChildName}'s device battery is at ${child.BatteryLevel}%. Please charge the device.`,
            severity: child.BatteryLevel <= 10 ? 'critical' : 'medium',
          });

          // Send real-time notification to caregiver
          sendNotificationToUser(caregiver.CaregiverId, 'low_battery_alert', {
            alertId,
            childId: child.ChildId,
            childName: child.ChildName,
            batteryLevel: child.BatteryLevel,
            timestamp: new Date(),
          });

          // Send native push notification to caregiver
          sendPushNotification(
            caregiver.CaregiverId, 
            '🔋 Low Battery', 
            `${child.ChildName}'s device battery is at ${child.BatteryLevel}%. Please charge the device.`
          );

          console.log(`✅ Created low battery alert for ${child.ChildName} (${child.BatteryLevel}%) -> caregiver ${caregiver.CaregiverName}`);
        }
      }
    }

    console.log('✅ Low battery check completed');
  } catch (error) {
    console.error('❌ Error checking low battery:', error);
  }
};

// Check for missing daily check-ins at 8 PM
const checkMissedCheckIns = async () => {
  try {
    console.log('🔍 Checking for missed daily check-ins...');
    const pool = await getConnection();

    // Get all active parents
    const parents = await pool.request().query("SELECT UserId, Name FROM Users WHERE Role = 'parent'");
    
    for (const parent of parents.recordset) {
      // Did they check in today?
      const checkIns = await pool.request()
        .input('parentId', mssql.Int, parent.UserId)
        .query(`
          SELECT ParentId FROM CheckIns 
          WHERE ParentId = @parentId 
          AND CAST(CheckInTime AS DATE) = CAST(GETDATE() AS DATE)
        `);
      
      if (checkIns.recordset.length === 0) {
        // Find linked children (caregivers)
        const caregivers = await pool.request()
          .input('parentId', mssql.Int, parent.UserId)
          .query('SELECT ChildId FROM ParentChildLink WHERE ParentId = @parentId');
        
        for (const caregiver of caregivers.recordset) {
          // Check if we already alerted today
          const existingAlert = await pool.request()
            .input('parentId', mssql.Int, caregiver.ChildId)
            .input('childId', mssql.Int, parent.UserId)
            .query(`
              SELECT AlertId FROM Alerts
              WHERE ParentId = @parentId 
                AND ChildId = @childId
                AND AlertType = 'missed_checkin'
                AND CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
            `);
          
          if (existingAlert.recordset.length === 0) {
            const alertId = await Alert.create({
              parentId: caregiver.ChildId,
              childId: parent.UserId,
              alertType: 'missed_checkin',
              title: '⚠️ Missed Daily Check-in',
              message: `${parent.Name} missed their daily check-in (expected by 8 PM). Please check on them.`,
              severity: 'high',
            });
            
            sendNotificationToUser(caregiver.ChildId, 'missed_checkin_alert', {
              alertId,
              message: `${parent.Name} missed their daily check-in.`,
              timestamp: new Date()
            });

            // Send native push notification to caregiver
            sendPushNotification(
              caregiver.ChildId, 
              '⚠️ Missed Daily Check-in', 
              `${parent.Name} missed their daily check-in (expected by 8 PM). Please check on them.`
            );

            console.log(`✅ Created missed check-in alert for ${parent.Name}`);
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Error checking missed check-ins:', error);
  }
};

// Start heartbeat monitor job
const startHeartbeatMonitor = () => {
  // Check offline children every 10 minutes
  cron.schedule('*/10 * * * *', () => {
    checkOfflineChildren();
  });

  // Check low battery every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    checkLowBattery();
  });

  // Run immediately on startup (after 15 seconds)
  setTimeout(() => {
    checkOfflineChildren();
    checkLowBattery();
    // checkMissedCheckIns(); // Uncomment for testing immediately
  }, 15000);

  // Check missed check-ins every day at 20:00 (8:00 PM)
  cron.schedule('0 20 * * *', () => {
    checkMissedCheckIns();
  });

  // Database auto-cleanup every day at midnight to stay within free tier limits
  cron.schedule('0 0 * * *', async () => {
    console.log('🧹 Starting daily database auto-cleanup...');
    await BatteryLog.cleanupOldLogs();
    await MedicineTracking.cleanupOldLogs();
    console.log('✅ Daily database auto-cleanup completed');
  });

  console.log('💓 Heartbeat monitor started (offline check: every 10 min, battery check: every 30 min, check-in check: 8 PM, cleanup: midnight)');
};

module.exports = {
  startHeartbeatMonitor,
  checkOfflineChildren,
  checkLowBattery,
};

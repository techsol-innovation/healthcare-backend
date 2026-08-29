const { getConnection, mssql } = require('../config/database');
const Alert = require('../models/Alert');
const { sendNotificationToUser } = require('../services/socketService');

// Get 24-hour activity timeline for a patient (ParentId)
const getActivityTimeline = async (req, res) => {
  try {
    const { parentId } = req.params;
    const hours = req.query.hours ? parseInt(req.query.hours, 10) : 24;
    const userId = req.user.userId;
    const userRole = req.user.role;

    const pool = await getConnection();

    // Authorization check
    if (userRole === 'parent') {
      // Parent (Patient) can only view their own activity
      if (parseInt(parentId) !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }
    } else if (userRole === 'child') {
      // Child (Caregiver) can view linked parents' activity
      const linkCheck = await pool
        .request()
        .input('childId', mssql.Int, userId)
        .input('parentId', mssql.Int, parentId)
        .query(`
          SELECT * FROM ParentChildLink
          WHERE ParentId = @parentId AND ChildId = @childId
        `);

      if (linkCheck.recordset.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Patient not linked to your account.',
        });
      }
    }

    // Get medicine tracking events (Medicines.ParentId = Patient)
    const medicineEvents = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .input('hours', mssql.Int, hours)
      .query(`
        SELECT 
          'medicine' as EventType,
          mt.TrackingId as EventId,
          m.Name as MedicineName,
          mt.Status,
          mt.ScheduledDate,
          mt.ScheduledTime,
          mt.TakenAt,
          mt.CreatedAt as EventTime
        FROM MedicineTracking mt
        INNER JOIN Medicines m ON mt.MedicineId = m.MedicineId
        WHERE m.ParentId = @parentId
          AND mt.CreatedAt >= DATEADD(HOUR, -@hours, GETDATE())
        ORDER BY mt.CreatedAt DESC
      `);

    // Get heartbeat events (Heartbeats.ChildId = Patient in DB schema)
    const heartbeatEvents = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .input('hours', mssql.Int, hours)
      .query(`
        SELECT 
          'heartbeat' as EventType,
          HeartbeatId as EventId,
          'Device Heartbeat' as Description,
          BatteryLevel,
          LastSeenAt as EventTime
        FROM Heartbeats
        WHERE ChildId = @parentId
          AND LastSeenAt >= DATEADD(HOUR, -@hours, GETDATE())
        ORDER BY LastSeenAt DESC
      `);

    // Get battery alerts (BatteryLogs.ParentUserId = Patient)
    // Checking both ParentUserId and ChildId just in case of mixed legacy schema
    const batteryEvents = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .input('hours', mssql.Int, hours)
      .query(`
        SELECT 
          'battery' as EventType,
          LogId as EventId,
          'Battery Level' as Description,
          BatteryPercentage as BatteryLevel,
          IsCharging,
          LoggedAt as EventTime
        FROM BatteryLogs
        WHERE ParentUserId = @parentId
          AND LoggedAt >= DATEADD(HOUR, -@hours, GETDATE())
          AND (BatteryPercentage <= 20 OR BatteryPercentage = 100)
        ORDER BY LoggedAt DESC
      `);

    // Get SOS events (SOSEvents.ParentId = Patient)
    const sosEvents = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .input('hours', mssql.Int, hours)
      .query(`
        SELECT 
          'sos' as EventType,
          SOSId as EventId,
          'Emergency SOS' as Description,
          Message,
          Status,
          CreatedAt as EventTime
        FROM SOSEvents s
        WHERE s.ParentId = @parentId
          AND s.CreatedAt >= DATEADD(HOUR, -@hours, GETDATE())
        ORDER BY s.CreatedAt DESC
      `);

    // Get alerts (Alerts.ChildId = Patient for alerts sent TO Caregiver, but triggered BY Patient)
    // Wait, Alert schema: ChildId is the sender (Patient). ParentId is the recipient (Caregiver).
    const alertEvents = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .input('hours', mssql.Int, hours)
      .query(`
        SELECT 
          'alert' as EventType,
          AlertId as EventId,
          AlertType,
          Title,
          Message,
          Severity,
          CreatedAt as EventTime
        FROM Alerts
        WHERE ChildId = @parentId
          AND CreatedAt >= DATEADD(HOUR, -@hours, GETDATE())
        ORDER BY CreatedAt DESC
      `);

    // Combine all events
    const timeline = [
      ...medicineEvents.recordset.map(e => ({ ...e, category: 'medicine' })),
      ...heartbeatEvents.recordset.map(e => ({ ...e, category: 'system' })),
      ...batteryEvents.recordset.map(e => ({ ...e, category: 'system' })),
      ...sosEvents.recordset.map(e => ({ ...e, category: 'emergency' })),
      ...alertEvents.recordset.map(e => ({ ...e, category: 'alert' })),
    ];

    // Sort by EventTime descending
    timeline.sort((a, b) => new Date(b.EventTime) - new Date(a.EventTime));

    // Get summary statistics
    const summary = {
      totalEvents: timeline.length,
      medicineTaken: medicineEvents.recordset.filter(e => e.Status === 'taken').length,
      medicineMissed: medicineEvents.recordset.filter(e => e.Status === 'missed').length,
      medicinePending: medicineEvents.recordset.filter(e => e.Status === 'pending').length,
      heartbeats: heartbeatEvents.recordset.length,
      batteryAlerts: batteryEvents.recordset.length,
      sosEvents: sosEvents.recordset.length,
      alerts: alertEvents.recordset.length,
    };

    res.status(200).json({
      success: true,
      timeRange: `Last ${hours} hours`,
      summary,
      timeline,
    });
  } catch (error) {
    console.error('Get activity timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get activity timeline',
      error: error.message,
    });
  }
};

// Get dashboard summary for parent (all linked children)
const getParentDashboard = async (req, res) => {
  try {
    const parentUserId = req.user.userId;

    const pool = await getConnection();

    // Get all linked children
    const children = await pool
      .request()
      .input('parentId', mssql.Int, parentUserId)
      .query(`
        SELECT 
          u.UserId as ChildId,
          u.Name as ChildName,
          u.Email as ChildEmail
        FROM Users u
        INNER JOIN ParentChildLink pcl ON u.UserId = pcl.ChildId
        WHERE pcl.ParentId = @parentId AND u.Role = 'child'
      `);

    // Get summary for each child
    const childrenSummaries = await Promise.all(
      children.recordset.map(async (child) => {
        // Today's medicines
        const todayMedicines = await pool
          .request()
          .input('childId', mssql.Int, child.ChildId)
          .query(`
            SELECT 
              COUNT(*) as Total,
              SUM(CASE WHEN mt.Status = 'taken' THEN 1 ELSE 0 END) as Taken,
              SUM(CASE WHEN mt.Status = 'missed' THEN 1 ELSE 0 END) as Missed,
              SUM(CASE WHEN mt.Status = 'pending' THEN 1 ELSE 0 END) as Pending
            FROM Medicines m
            LEFT JOIN MedicineTracking mt ON m.MedicineId = mt.MedicineId 
              AND mt.ScheduledDate = CAST(GETDATE() AS DATE)
            WHERE m.ChildId = @childId AND m.IsActive = 1
          `);

        // Latest heartbeat
        const heartbeat = await pool
          .request()
          .input('childId', mssql.Int, child.ChildId)
          .query(`
            SELECT TOP 1 LastSeenAt, BatteryLevel
            FROM Heartbeats
            WHERE ChildId = @childId
            ORDER BY LastSeenAt DESC
          `);

        // Unread alerts
        const alerts = await pool
          .request()
          .input('parentId', mssql.Int, parentUserId)
          .input('childId', mssql.Int, child.ChildId)
          .query(`
            SELECT COUNT(*) as UnreadCount
            FROM Alerts
            WHERE ParentId = @parentId AND ChildId = @childId AND IsRead = 0
          `);

        // Active SOS
        const sos = await pool
          .request()
          .input('parentId', mssql.Int, parentUserId)
          .input('childId', mssql.Int, child.ChildId)
          .query(`
            SELECT COUNT(*) as ActiveSOS
            FROM SOSEvents
            WHERE ParentId = @parentId AND ChildId = @childId AND Status = 'active'
          `);

        const isOnline = heartbeat.recordset[0] ? 
          Math.floor((new Date() - new Date(heartbeat.recordset[0].LastSeenAt)) / 1000 / 60) < 15 : false;

        return {
          ...child,
          isOnline,
          lastSeen: heartbeat.recordset[0]?.LastSeenAt || null,
          batteryLevel: heartbeat.recordset[0]?.BatteryLevel || null,
          todayMedicines: todayMedicines.recordset[0],
          unreadAlerts: alerts.recordset[0].UnreadCount,
          activeSOS: sos.recordset[0].ActiveSOS,
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        children: childrenSummaries,
        totalChildren: childrenSummaries.length,
        onlineChildren: childrenSummaries.filter(c => c.isOnline).length,
        offlineChildren: childrenSummaries.filter(c => !c.isOnline).length,
        totalUnreadAlerts: childrenSummaries.reduce((sum, c) => sum + c.unreadAlerts, 0),
        totalActiveSOS: childrenSummaries.reduce((sum, c) => sum + c.activeSOS, 0),
      },
    });
  } catch (error) {
    console.error('Get parent dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard data',
      error: error.message,
    });
  }
};

// Parent checks in ("I am OK")
const recordCheckIn = async (req, res) => {
  try {
    const parentUserId = req.user.userId;
    const pool = await getConnection();

    await pool.request()
      .input('parentId', mssql.Int, parentUserId)
      .query(`
        INSERT INTO CheckIns (ParentId, CheckInTime)
        VALUES (@parentId, GETDATE())
      `);

    // Get parent info
    const parentRes = await pool.request().input('parentId', mssql.Int, parentUserId).query('SELECT Name FROM Users WHERE UserId = @parentId');
    const parentName = parentRes.recordset[0]?.Name || 'Parent';

    // Find linked children (caregivers)
    const caregivers = await pool.request()
      .input('parentId', mssql.Int, parentUserId)
      .query('SELECT ChildId FROM ParentChildLink WHERE ParentId = @parentId');

    for (const caregiver of caregivers.recordset) {
      const alertId = await Alert.create({
        parentId: caregiver.ChildId, // Send to caregiver
        childId: parentUserId,
        alertType: 'info',
        title: '✅ Daily Check-in',
        message: `${parentName} has checked in and is doing okay today.`,
        severity: 'low',
      });
      
      sendNotificationToUser(caregiver.ChildId, 'info_alert', {
        alertId,
        message: `${parentName} checked in successfully.`,
        timestamp: new Date()
      });
    }

    res.status(200).json({ success: true, message: 'Check-in recorded' });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ success: false, message: 'Failed to record check-in' });
  }
};

module.exports = {
  getActivityTimeline,
  getParentDashboard,
  recordCheckIn,
};

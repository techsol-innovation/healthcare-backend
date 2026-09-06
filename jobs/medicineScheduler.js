const cron = require('node-cron');
const { getConnection, mssql } = require('../config/database');
const Alert = require('../models/Alert');
const { sendNotificationToUser } = require('../services/socketService');
const { sendPushNotification } = require('../services/notificationService');

const parseAMPM = (timeStr) => {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const modifier = match[3] ? match[3].toUpperCase() : null;
  if (modifier === 'PM' && hours < 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;
  return { hours, minutes };
};

const checkMedicines = async () => {
  try {
    console.log('🔍 Checking for medicine reminders and missed doses...');
    const pool = await getConnection();

    // Fetch all active medicines and today's trackings
    const result = await pool.request().query(`
      SELECT 
        m.MedicineId, m.Name as MedicineName, m.Dosage, m.Time as ScheduledTimeString,
        m.ParentId, m.ChildId, p.Name as ParentName, c.Name as ChildName,
        m.CreatedAt as MedCreatedAt,
        CAST(GETDATE() AS DATE) as Today,
        mt.TrackingId, mt.ScheduledTime as TrackedTime
      FROM Medicines m
      LEFT JOIN Users p ON m.ParentId = p.UserId
      LEFT JOIN Users c ON m.ChildId = c.UserId
      LEFT JOIN MedicineTracking mt ON m.MedicineId = mt.MedicineId AND mt.ScheduledDate = CAST(GETDATE() AS DATE)
      WHERE m.IsActive = 1
        AND CAST(GETDATE() AS DATE) BETWEEN m.StartDate AND ISNULL(m.EndDate, '9999-12-31')
    `);

    // Group by MedicineId to handle multiple trackings
    const medMap = {};
    result.recordset.forEach(row => {
      if (!medMap[row.MedicineId]) {
        // Parse the comma-separated times
        const times = row.ScheduledTimeString ? row.ScheduledTimeString.split(',').map(t => t.trim().toUpperCase()) : [];
        medMap[row.MedicineId] = {
          base: row,
          times: times,
          trackings: new Set()
        };
      }
      
      if (row.TrackingId && row.TrackedTime) {
         let timeStr = row.TrackedTime;
         if (row.TrackedTime instanceof Date) {
            timeStr = row.TrackedTime.toISOString().substring(11, 16);
         } else if (typeof row.TrackedTime === 'string') {
            timeStr = row.TrackedTime.trim().toUpperCase();
         }
         medMap[row.MedicineId].trackings.add(timeStr);
      }
    });

    const now = new Date();
    const tasks = [];
    
    // Process each medicine and time slot
    for (const medId in medMap) {
      const med = medMap[medId];
      const base = med.base;

      for (const timeStr of med.times) {
        // Skip if already tracked (taken or missed)
        if (med.trackings.has(timeStr)) continue;

        const parsed = parseAMPM(timeStr);
        if (!parsed) continue;
        const scheduledTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parsed.hours, parsed.minutes, 0, 0);

        // Guard against doses scheduled prior to medicine creation today
        if (base.MedCreatedAt && new Date(base.MedCreatedAt) > scheduledTime) {
          continue;
        }

        const diffMinutes = (now - scheduledTime) / (1000 * 60);

        // ─── 1. Check for 10-Minute Warnings (Notify Parent) ───
        if (diffMinutes >= 10 && diffMinutes < 20) {
          tasks.push((async () => {
            // Check if we already sent a warning today for THIS SPECIFIC TIME
            const existingWarning = await pool.request()
              .input('parentId', mssql.Int, base.ParentId)
              .input('medicineId', mssql.Int, base.MedicineId)
              .input('today', mssql.Date, base.Today)
              .input('timeStr', mssql.VarChar, `%${timeStr}%`)
              .query(`
                SELECT AlertId FROM Alerts
                WHERE ParentId = @parentId AND AlertType = 'custom_reminder' 
                  AND RelatedEntityId = @medicineId AND CAST(CreatedAt AS DATE) = @today
                  AND Message LIKE @timeStr
              `);

            if (existingWarning.recordset.length === 0) {
              // Parent gets the warning
              const alertId = await Alert.create({
                parentId: base.ParentId, // Send to Parent
                childId: base.ChildId,
                alertType: 'custom_reminder',
                title: 'Medicine Reminder',
                message: `It's time to take your medicine: ${base.MedicineName} (${base.Dosage}) at ${timeStr}. You are 10 minutes late!`,
                severity: 'medium',
                relatedEntityId: base.MedicineId,
                relatedEntityType: 'medicine',
              });

              await sendPushNotification(base.ParentId, 'Medicine Reminder', `It's time to take ${base.MedicineName} (${base.Dosage}) at ${timeStr}`);
              sendNotificationToUser(base.ParentId, 'custom_reminder', {
                alertId, title: 'Medicine Reminder', message: `It's time to take your medicine: ${base.MedicineName} (${base.Dosage}) at ${timeStr}`, timestamp: new Date()
              });
              console.log(`✅ Sent 10-min warning to Parent for ${base.MedicineName} at ${timeStr}`);
            }
          })());
        }

        // ─── 2. Check for 20-Minute Auto-Missed (Notify Caregiver) ───
        // Bound diffMinutes between 20 and 180 minutes to avoid waking up ancient doses
        if (diffMinutes >= 20 && diffMinutes <= 180) {
          tasks.push((async () => {
            // Check if we ALREADY inserted a missed record for this slot.
            const existingMissed = await pool.request()
              .input('medicineId', mssql.Int, base.MedicineId)
              .input('scheduledDate', mssql.Date, base.Today)
              .input('scheduledTime', mssql.VarChar, timeStr)
              .query(`
                SELECT TrackingId FROM MedicineTracking
                WHERE MedicineId = @medicineId
                  AND TRIM(UPPER(ScheduledTime)) = TRIM(UPPER(@scheduledTime))
                  AND CAST(ScheduledDate AS DATE) = CAST(@scheduledDate AS DATE)
              `);

            if (existingMissed.recordset.length > 0) return; // already handled this slot

            // Check if an alert was already sent for this slot today to prevent repeated alerts
            const existingAlert = await pool.request()
              .input('medicineId', mssql.Int, base.MedicineId)
              .input('today', mssql.Date, base.Today)
              .input('timeStr', mssql.VarChar, `%${timeStr}%`)
              .query(`
                SELECT AlertId FROM Alerts
                WHERE AlertType = 'missed_medicine'
                  AND RelatedEntityId = @medicineId
                  AND CAST(CreatedAt AS DATE) = @today
                  AND Message LIKE @timeStr
              `);

            if (existingAlert.recordset.length > 0) return; // already alerted

            // Insert missed tracking record (first time only)
            await pool.request()
              .input('medicineId', mssql.Int, base.MedicineId)
              .input('scheduledDate', mssql.Date, base.Today)
              .input('scheduledTime', mssql.VarChar, timeStr)
              .query(`
                INSERT INTO MedicineTracking (MedicineId, ScheduledDate, ScheduledTime, Status, CreatedAt)
                VALUES (@medicineId, @scheduledDate, @scheduledTime, 'missed', GETDATE())
              `);

            // Caregiver gets the missed alert
            const alertId = await Alert.create({
              parentId: base.ChildId, // Send to Caregiver!
              childId: base.ParentId, // Triggered by Parent
              alertType: 'missed_medicine',
              title: 'Medicine Missed',
              message: `${base.ParentName} missed taking ${base.MedicineName} (${base.Dosage}) scheduled at ${timeStr}`,
              severity: 'high',
              relatedEntityId: base.MedicineId,
              relatedEntityType: 'medicine',
            });

            await sendPushNotification(base.ChildId, 'Missed Medicine', `${base.ParentName} missed their medicine: ${base.MedicineName}`);
            sendNotificationToUser(base.ChildId, 'missed_medicine_alert', {
              alertId, medicineId: base.MedicineId, medicineName: base.MedicineName,
              dosage: base.Dosage, scheduledTime: timeStr, parentName: base.ParentName, timestamp: new Date()
            });
            console.log(`✅ Marked ${base.MedicineName} as missed at ${timeStr} and notified caregiver`);
          })());
        }
      }
    }

    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
      console.log(`✅ Processed ${tasks.length} medicine notifications concurrently.`);
    }



  } catch (error) {
    console.error('❌ Error in medicine cron job:', error);
  }
};

const startMedicineScheduler = () => {
  cron.schedule('* * * * *', () => { // Run every minute for high precision
    checkMedicines();
  });
  setTimeout(checkMedicines, 5000);
  console.log('📅 High-precision Medicine scheduler started (runs every minute)');
};

module.exports = { startMedicineScheduler, checkMedicines };

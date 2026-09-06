const { getConnection, mssql } = require('../config/database');
const Medicine = require('../models/Medicine');
const Alert = require('../models/Alert');
const { sendPushNotification } = require('../services/notificationService');
const { sendNotificationToUser } = require('../services/socketService');

// Child creates medicine schedule for parent
const createMedicine = async (req, res) => {
  try {
    const { name, dosage, frequency, time, parentId, notes } = req.body;
    const childUserId = req.user.userId;

    const pool = await getConnection();

    // Verify the parent exists and is linked to this child
    const linkCheck = await pool
      .request()
      .input('childId', mssql.Int, childUserId)
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT * FROM ParentChildLink
        WHERE ChildId = @childId AND ParentId = @parentId
      `);

    if (linkCheck.recordset.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to create medicine schedules for this parent',
      });
    }

    // Don't forcefully append :00 because time might be comma separated "08:00, 14:00"
    let formattedTime = time;
    
    console.log('Original time:', time);
    console.log('Formatted time:', formattedTime);

    // Insert medicine - use VarChar instead of Time type for flexibility
    const result = await pool
      .request()
      .input('name', mssql.NVarChar, name)
      .input('dosage', mssql.NVarChar, dosage)
      .input('frequency', mssql.VarChar, frequency)
      .input('time', mssql.VarChar, formattedTime)
      .input('parentId', mssql.Int, parentId)
      .input('childId', mssql.Int, childUserId)
      .input('notes', mssql.NVarChar, notes || null)
      .input('startDate', mssql.Date, new Date())
      .query(`
        INSERT INTO Medicines (Name, Dosage, Frequency, Time, ParentId, ChildId, Notes, StartDate, IsActive, CreatedAt)
        VALUES (@name, @dosage, @frequency, @time, @parentId, @childId, @notes, @startDate, 1, GETDATE());
        SELECT SCOPE_IDENTITY() AS MedicineId;
      `);

    const medicineId = result.recordset[0].MedicineId;

    // Send notification to the parent
    try {
      await sendPushNotification(
        parentId, 
        "New Medicine Scheduled", 
        `A new medicine (${name}) has been scheduled for you.`
      );
      
      // Emit real-time socket event so parent gets it instantly
      sendNotificationToUser(parentId, 'new_alert', {
        title: 'New Medicine Scheduled',
        message: `A new medicine (${name}) has been added to your schedule.`,
      });
      
      await Alert.create({
        parentId: parentId,
        childId: childUserId,
        alertType: 'custom_reminder',
        title: 'New Medicine Scheduled',
        message: `A new medicine (${name}) has been added to your schedule.`,
        severity: 'low',
        relatedEntityId: medicineId,
        relatedEntityType: 'medicine',
      });
    } catch (pushErr) {
      console.error('Failed to send notification for new medicine:', pushErr);
    }

    res.status(201).json({
      success: true,
      message: 'Medicine schedule created successfully',
      data: {
        medicineId,
        name,
        dosage,
        frequency,
        time,
        parentId,
      },
    });
  } catch (error) {
    console.error('Create medicine error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create medicine schedule',
      error: error.message,
    });
  }
};

// Child gets all medicines for a specific parent
const getMedicinesByParent = async (req, res) => {
  try {
    const { parentId } = req.params;
    const childUserId = req.user.userId;

    const pool = await getConnection();

    // Verify the child has access to this parent
    const linkCheck = await pool
      .request()
      .input('childId', mssql.Int, childUserId)
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT * FROM ParentChildLink
        WHERE ChildId = @childId AND ParentId = @parentId
      `);

    if (linkCheck.recordset.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view medicines for this parent',
      });
    }

    // Get all medicines for the parent
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT 
          m.MedicineId,
          m.Name,
          m.Dosage,
          m.Frequency,
          m.Time as Time,
          m.Notes,
          m.IsActive,
          m.CreatedAt,
          u.Name as ParentName,
          CASE WHEN EXISTS (
            SELECT 1 FROM MedicineTracking mt 
            WHERE mt.MedicineId = m.MedicineId 
            AND CAST(mt.ScheduledDate AS DATE) = CAST(GETDATE() AS DATE)
          ) THEN 1 ELSE 0 END as HasTrackingToday
        FROM Medicines m
        JOIN Users u ON m.ParentId = u.UserId
        WHERE m.ParentId = @parentId AND m.IsActive = 1
        ORDER BY m.Time ASC
      `);

    res.status(200).json({
      success: true,
      count: result.recordset.length,
      data: result.recordset,
    });
  } catch (error) {
    console.error('Get medicines error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get medicines',
      error: error.message,
    });
  }
};

// Child views medicine tracking/status for parent
const getMedicineTracking = async (req, res) => {
  try {
    const { parentId } = req.params;
    const childUserId = req.user.userId;

    const pool = await getConnection();

    // Verify access
    const linkCheck = await pool
      .request()
      .input('childId', mssql.Int, childUserId)
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT * FROM ParentChildLink
        WHERE ChildId = @childId AND ParentId = @parentId
      `);

    if (linkCheck.recordset.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Get today's medicine tracking
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT 
          m.MedicineId,
          m.Name,
          m.Dosage,
          m.Time as ScheduledTimeString,
          mt.TrackingId,
          mt.Status,
          mt.TakenAt,
          mt.ScheduledTime as ActualTime
        FROM Medicines m
        LEFT JOIN MedicineTracking mt ON m.MedicineId = mt.MedicineId 
          AND CAST(mt.ScheduledDate AS DATE) = CAST(GETDATE() AS DATE)
        WHERE m.ParentId = @parentId AND m.IsActive = 1
        ORDER BY m.Time ASC
      `);

    // Process results to split multiple times per medicine
    const medicineMap = {};
    
    result.recordset.forEach(row => {
      if (!medicineMap[row.MedicineId]) {
         let times = ['08:00'];
         if (row.ScheduledTimeString) {
            if (row.ScheduledTimeString instanceof Date) {
               times = [row.ScheduledTimeString.toISOString().substring(11, 16)];
            } else if (typeof row.ScheduledTimeString === 'string') {
               times = row.ScheduledTimeString.split(',').map(t => t.trim());
            }
         }
         medicineMap[row.MedicineId] = {
            base: row,
            times: times,
            trackings: {}
         };
      }
      if (row.TrackingId && row.ActualTime) {
         let actualTimeStr = row.ActualTime;
         if (row.ActualTime instanceof Date) {
            actualTimeStr = row.ActualTime.toISOString().substring(11, 16);
         } else if (typeof row.ActualTime === 'string') {
            actualTimeStr = row.ActualTime.trim().toUpperCase();
         }

         medicineMap[row.MedicineId].trackings[actualTimeStr] = {
            TrackingId: row.TrackingId,
            Status: row.Status,
            TakenAt: row.TakenAt
         };
      }
    });

    // Flatten into final array, creating one object per dose time
    const finalSchedule = [];
    Object.values(medicineMap).forEach(med => {
       med.times.forEach(t => {
          const track = med.trackings[t] || { TrackingId: null, Status: null, TakenAt: null };
          finalSchedule.push({
             MedicineId: med.base.MedicineId,
             Name: med.base.Name,
             Dosage: med.base.Dosage,
             ScheduledTime: t,
             ActualTime: t, // Keep ActualTime same as ScheduledTime for UI grouping
             ...track
          });
       });
    });
    
    finalSchedule.sort((a,b) => a.ScheduledTime.localeCompare(b.ScheduledTime));

    res.status(200).json({
      success: true,
      data: finalSchedule,
    });
  } catch (error) {
    console.error('Get tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tracking data',
      error: error.message,
    });
  }
};

// Parent gets their assigned medicines
const getMyMedicines = async (req, res) => {
  try {
    const parentUserId = req.user.userId;

    const pool = await getConnection();

    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentUserId)
      .query(`
        SELECT 
          m.MedicineId,
          m.Name,
          m.Dosage,
          m.Frequency,
          m.Time as Time,
          m.Notes,
          u.Name as CaregiverName
        FROM Medicines m
        JOIN Users u ON m.ChildId = u.UserId
        WHERE m.ParentId = @parentId AND m.IsActive = 1
        ORDER BY m.Time ASC
      `);

    res.status(200).json({
      success: true,
      count: result.recordset.length,
      data: result.recordset,
    });
  } catch (error) {
    console.error('Get my medicines error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get medicines',
      error: error.message,
    });
  }
};

// Parent confirms medicine taken
const confirmMedicine = async (req, res) => {
  try {
    const { id } = req.params;
    const { scheduledTime } = req.body;
    const parentUserId = req.user.userId;

    console.log('🔵 Confirming medicine:', id, 'for parent:', parentUserId);

    const pool = await getConnection();

    // Verify medicine belongs to this parent
    const medicineCheck = await pool
      .request()
      .input('medicineId', mssql.Int, id)
      .input('parentId', mssql.Int, parentUserId)
      .query(`
        SELECT MedicineId, Name FROM Medicines
        WHERE MedicineId = @medicineId AND ParentId = @parentId
      `);

    if (medicineCheck.recordset.length === 0) {
      console.log('❌ Medicine not found');
      return res.status(404).json({
        success: false,
        message: 'Medicine not found',
      });
    }

    const medicine = medicineCheck.recordset[0];
    console.log('✅ Medicine found:', medicine.Name);

    const existingTracking = await pool
      .request()
      .input('medicineId', mssql.Int, id)
      .input('scheduledTime', mssql.VarChar, scheduledTime)
      .query(`
        SELECT TrackingId, Status FROM MedicineTracking
        WHERE MedicineId = @medicineId 
        AND TRIM(UPPER(ScheduledTime)) = TRIM(UPPER(@scheduledTime))
        AND CAST(ScheduledDate AS DATE) = CAST(GETDATE() AS DATE)
      `);

    if (existingTracking.recordset.length > 0 && existingTracking.recordset[0].Status === 'taken') {
      console.log('⚠️ Already confirmed today');
      return res.status(400).json({
        success: false,
        message: 'Medicine already confirmed for today',
      });
    }

    // Insert or update tracking record for today
    const result = await pool
      .request()
      .input('medicineId', mssql.Int, id)
      .input('scheduledDate', mssql.Date, new Date())
      .input('scheduledTime', mssql.VarChar, scheduledTime || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
      .input('takenAt', mssql.DateTime, new Date())
      .query(`
        -- First, try to update existing record
        UPDATE MedicineTracking 
        SET Status = 'taken', TakenAt = @takenAt
        WHERE MedicineId = @medicineId 
        AND TRIM(UPPER(ScheduledTime)) = TRIM(UPPER(@scheduledTime))
        AND CAST(ScheduledDate AS DATE) = CAST(@scheduledDate AS DATE)
        
        -- If no rows updated, insert new record
        IF @@ROWCOUNT = 0
        BEGIN
          INSERT INTO MedicineTracking (MedicineId, ScheduledDate, ScheduledTime, Status, TakenAt, CreatedAt)
          VALUES (@medicineId, @scheduledDate, @scheduledTime, 'taken', @takenAt, GETDATE())
        END

        -- Auto-resolve and dismiss all unread reminder/missed alerts for this medicine today
        UPDATE Alerts 
        SET IsRead = 1, ReadAt = GETDATE()
        WHERE RelatedEntityId = @medicineId 
          AND RelatedEntityType = 'medicine'
          AND AlertType IN ('custom_reminder', 'missed_medicine')
          AND CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE);
      `);

    console.log('✅ Medicine confirmed successfully and active alerts auto-resolved');

    res.status(200).json({
      success: true,
      message: 'Medicine confirmed successfully',
      data: {
        medicineId: id,
        status: 'taken',
        confirmedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('❌ Confirm medicine error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm medicine',
      error: error.message,
    });
  }
};

// Parent updates medicine status (Taken/Missed)
const updateMedicineStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, scheduledTime } = req.body; // 'taken' or 'missed'
    const parentUserId = req.user.userId;
    console.log("TRACE 2: Backend received status update. Body:", req.body, "| Params id:", id, "| JWT parentUserId:", parentUserId);

    if (!['taken', 'missed', 'pending'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be "taken", "missed", or "pending".',
      });
    }

    console.log(`🔵 Updating medicine ${id} status to ${status} for parent: ${parentUserId}`);

    const pool = await getConnection();

    // Verify medicine belongs to this parent
    const medicineCheck = await pool
      .request()
      .input('medicineId', mssql.Int, id)
      .input('parentId', mssql.Int, parentUserId)
      .query(`
          SELECT m.MedicineId, m.Name, m.ChildId, u.Name as ParentName 
          FROM Medicines m
          LEFT JOIN Users u ON m.ParentId = u.UserId
          WHERE m.MedicineId = @medicineId AND m.ParentId = @parentId
        `);

    if (medicineCheck.recordset.length === 0) {
      console.log('❌ Medicine not found');
      return res.status(404).json({
        success: false,
        message: 'Medicine not found',
      });
    }

    const caregiverId = medicineCheck.recordset[0].ChildId;
    const medicineName = medicineCheck.recordset[0].Name;
    const parentName = medicineCheck.recordset[0].ParentName || 'Parent';
    const doseTime = scheduledTime || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const takenAt = status === 'taken' ? new Date() : null;

    if (status === 'pending') {
      // Unmark: Delete or reset tracking for today's dose
      await pool
        .request()
        .input('medicineId', mssql.Int, id)
        .input('scheduledTime', mssql.VarChar, doseTime)
        .query(`
          DELETE FROM MedicineTracking 
          WHERE MedicineId = @medicineId 
          AND TRIM(UPPER(ScheduledTime)) = TRIM(UPPER(@scheduledTime))
          AND CAST(ScheduledDate AS DATE) = CAST(GETDATE() AS DATE);

          -- Also resolve any active alerts for this dose today
          UPDATE Alerts 
          SET IsRead = 1, ReadAt = GETDATE()
          WHERE RelatedEntityId = @medicineId 
            AND RelatedEntityType = 'medicine'
            AND CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE);
        `);
    } else {
      // Insert or update tracking record for today
      await pool
        .request()
        .input('medicineId', mssql.Int, id)
        .input('status', mssql.VarChar, status)
        .input('scheduledDate', mssql.Date, new Date())
        .input('scheduledTime', mssql.VarChar, doseTime)
        .input('takenAt', mssql.DateTime, takenAt)
        .query(`
          UPDATE MedicineTracking 
          SET Status = @status, TakenAt = @takenAt
          WHERE MedicineId = @medicineId 
          AND TRIM(UPPER(ScheduledTime)) = TRIM(UPPER(@scheduledTime))
          AND CAST(ScheduledDate AS DATE) = CAST(@scheduledDate AS DATE)
          
          -- If no rows updated, insert new record
          IF @@ROWCOUNT = 0
          BEGIN
            INSERT INTO MedicineTracking (MedicineId, ScheduledDate, ScheduledTime, Status, TakenAt, CreatedAt)
            VALUES (@medicineId, @scheduledDate, @scheduledTime, @status, @takenAt, GETDATE())
          END
        `);
    }

    if (status === 'taken') {
      // Auto-resolve and dismiss all unread reminder & missed alerts for this medicine today
      await pool
        .request()
        .input('medicineId', mssql.Int, id)
        .query(`
          UPDATE Alerts 
          SET IsRead = 1, ReadAt = GETDATE()
          WHERE RelatedEntityId = @medicineId 
            AND RelatedEntityType = 'medicine'
            AND AlertType IN ('custom_reminder', 'missed_medicine')
            AND CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE);
        `);
    }

    if (status === 'missed') {
      // Mark any warning reminder alerts as resolved so they don't loop
      await pool
        .request()
        .input('medicineId', mssql.Int, id)
        .input('parentId', mssql.Int, parentUserId)
        .query(`
          UPDATE Alerts 
          SET IsRead = 1, ReadAt = GETDATE()
          WHERE RelatedEntityId = @medicineId 
            AND AlertType = 'custom_reminder'
            AND ParentId = @parentId
            AND CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE);
        `);

      // Check if we already alerted the caregiver for this dose today to prevent duplicates
      const existingAlert = await pool
        .request()
        .input('medicineId', mssql.Int, id)
        .input('caregiverId', mssql.Int, caregiverId)
        .input('timeFilter', mssql.VarChar, `%${doseTime}%`)
        .query(`
          SELECT AlertId FROM Alerts
          WHERE RelatedEntityId = @medicineId 
            AND ParentId = @caregiverId
            AND AlertType = 'missed_medicine'
            AND CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
            AND Message LIKE @timeFilter
        `);

      if (existingAlert.recordset.length === 0) {
        console.log("Creating missed alert for Caregiver ID:", caregiverId, "| Medicine:", medicineName);
        const newAlert = await Alert.create({
          parentId: caregiverId,        // recipient (Caregiver)
          childId: parentUserId,        // sender (Parent)
          alertType: 'missed_medicine',
          title: '💊 Medicine Missed',
          message: `${medicineName} (Dose: ${doseTime}) was marked as missed.`,
          severity: 'medium',
          relatedEntityId: Number(id),
          relatedEntityType: 'medicine',
        });

        // Send Push Notification asynchronously
        sendPushNotification(caregiverId, '⚠️ Missed Medicine', `${parentName} just missed their medicine: ${medicineName} (Dose: ${doseTime}).`);
        
        // Emit real-time socket event for the sound/vibration
        sendNotificationToUser(caregiverId, 'missed_medicine_alert', {
          parentName: parentName,
          medicineName: medicineName,
          scheduledTime: doseTime
        });
      }
    }

    if (caregiverId) {
      sendNotificationToUser(caregiverId, 'medicine_status_updated', {
        parentId: parentUserId,
        medicineId: Number(id),
        status,
        scheduledTime: doseTime,
        takenAt,
      });
    }

    console.log(`✅ Medicine status updated to ${status} successfully`);

    res.status(200).json({
      success: true,
      message: `Medicine marked as ${status} successfully`,
      data: {
        medicineId: id,
        status,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('❌ Update medicine status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update medicine status',
      error: error.message,
    });
  }
};

// Parent gets today's medicine schedule
const getTodaySchedule = async (req, res) => {
  try {
    const parentUserId = req.user.userId;
    console.log('🔵 Getting today schedule for parent:', parentUserId);

    const pool = await getConnection();

    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentUserId)
      .query(`
        SELECT 
          m.MedicineId,
          m.Name,
          m.Dosage,
          m.Frequency,
          m.Time as ScheduledTimeString,
          m.Notes,
          mt.TrackingId,
          CASE 
            WHEN mt.Status = 'taken' THEN 1 
            ELSE 0 
          END as IsTaken,
          mt.Status,
          mt.TakenAt,
          mt.ScheduledTime as ActualTime
        FROM Medicines m
        LEFT JOIN MedicineTracking mt ON m.MedicineId = mt.MedicineId 
          AND CAST(mt.ScheduledDate AS DATE) = CAST(GETDATE() AS DATE)
        WHERE m.ParentId = @parentId AND m.IsActive = 1
        ORDER BY m.Time ASC
      `);

    // Process results to split multiple times per medicine
    const medicineMap = {};
    
    result.recordset.forEach(row => {
      if (!medicineMap[row.MedicineId]) {
         let times = ['08:00'];
         if (row.ScheduledTimeString) {
            if (row.ScheduledTimeString instanceof Date) {
               times = [row.ScheduledTimeString.toISOString().substring(11, 16)];
            } else if (typeof row.ScheduledTimeString === 'string') {
               times = row.ScheduledTimeString.split(',').map(t => t.trim().toUpperCase());
            }
         }
         medicineMap[row.MedicineId] = {
            base: row,
            times: times,
            trackings: {}
         };
      }
      
      if (row.TrackingId && row.ActualTime) {
         let actualTimeStr = row.ActualTime;
         if (row.ActualTime instanceof Date) {
            actualTimeStr = row.ActualTime.toISOString().substring(11, 16);
         } else if (typeof row.ActualTime === 'string') {
            actualTimeStr = row.ActualTime.trim().toUpperCase();
         }

         medicineMap[row.MedicineId].trackings[actualTimeStr] = {
            TrackingId: row.TrackingId,
            Status: row.Status,
            IsTaken: row.IsTaken,
            TakenAt: row.TakenAt
         };
      }
    });

    // Flatten into final array, creating one object per dose time
    const finalSchedule = [];
    Object.values(medicineMap).forEach(med => {
       med.times.forEach(t => {
          const track = med.trackings[t] || { TrackingId: null, Status: null, IsTaken: 0, TakenAt: null };
          finalSchedule.push({
             MedicineId: med.base.MedicineId,
             Name: med.base.Name,
             Dosage: med.base.Dosage,
             Frequency: med.base.Frequency,
             ScheduledTime: t,
             Notes: med.base.Notes,
             ...track
          });
       });
    });
    
    finalSchedule.sort((a,b) => a.ScheduledTime.localeCompare(b.ScheduledTime));

    console.log('✅ Found split medicines:', finalSchedule.length);

    res.status(200).json({
      success: true,
      data: finalSchedule,
    });
  } catch (error) {
    console.error('Get today schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get today\'s schedule',
      error: error.message,
    });
  }
};

// Update medicine (Child only)
const updateMedicine = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, dosage, frequency, time, notes, isActive } = req.body;
    const childUserId = req.user.userId;

    const pool = await getConnection();

    // Verify medicine belongs to this child
    const medicineCheck = await pool
      .request()
      .input('medicineId', mssql.Int, id)
      .input('childId', mssql.Int, childUserId)
      .query(`
        SELECT * FROM Medicines
        WHERE MedicineId = @medicineId AND ChildId = @childId
      `);

    if (medicineCheck.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found or access denied',
      });
    }

    // Update medicine - use VarChar instead of Time type for flexibility
    await pool
      .request()
      .input('medicineId', mssql.Int, id)
      .input('name', mssql.NVarChar, name)
      .input('dosage', mssql.NVarChar, dosage)
      .input('frequency', mssql.VarChar, frequency)
      .input('time', mssql.VarChar, time)
      .input('notes', mssql.NVarChar, notes || null)
      .input('isActive', mssql.Bit, isActive !== undefined ? isActive : 1)
      .query(`
        UPDATE Medicines
        SET Name = @name,
            Dosage = @dosage,
            Frequency = @frequency,
            Time = @time,
            Notes = @notes,
            IsActive = @isActive
        WHERE MedicineId = @medicineId
      `);

    res.status(200).json({
      success: true,
      message: 'Medicine updated successfully',
    });
  } catch (error) {
    console.error('Update medicine error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update medicine',
      error: error.message,
    });
  }
};

// Delete medicine (Child only)
const deleteMedicine = async (req, res) => {
  try {
    const { id } = req.params;
    const childUserId = req.user.userId;

    const pool = await getConnection();

    // Soft delete (set IsActive to 0)
    const result = await pool
      .request()
      .input('medicineId', mssql.Int, id)
      .input('childId', mssql.Int, childUserId)
      .query(`
        UPDATE Medicines
        SET IsActive = 0
        WHERE MedicineId = @medicineId AND ChildId = @childId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({
        success: false,
        message: 'Medicine not found or access denied',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Medicine deleted successfully',
    });
  } catch (error) {
    console.error('Delete medicine error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete medicine',
      error: error.message,
    });
  }
};

// Analytics: Get 7-Day Medicine History
const getMedicineHistory = async (req, res) => {
  try {
    const { parentId } = req.params;
    const childUserId = req.user.userId;

    const pool = await getConnection();

    // Verify access
    const linkCheck = await pool
      .request()
      .input('childId', mssql.Int, childUserId)
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT * FROM ParentChildLink
        WHERE ChildId = @childId AND ParentId = @parentId
      `);

    if (linkCheck.recordset.length === 0) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const filter = req.query.filter || 'week';
    let dateCondition = "DATEADD(day, -7, GETDATE())";
    if (filter === 'day') dateCondition = "DATEADD(day, -1, GETDATE())";
    if (filter === 'month') dateCondition = "DATEADD(month, -1, GETDATE())";
    if (filter === 'year') dateCondition = "DATEADD(year, -1, GETDATE())";

    const activeMedsCheck = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .query(`SELECT TOP 1 MedicineId FROM Medicines WHERE ParentId = @parentId AND IsActive = 1`);
    const hasActiveMedicines = activeMedsCheck.recordset.length > 0;

    // Query history
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT 
          mt.ScheduledDate, 
          mt.ScheduledTime, 
          mt.Status, 
          m.Name, 
          m.Dosage,
          m.Frequency
        FROM MedicineTracking mt
        JOIN Medicines m ON mt.MedicineId = m.MedicineId
        WHERE m.ParentId = @parentId
          AND mt.ScheduledDate >= ${dateCondition}
        ORDER BY mt.ScheduledDate DESC, mt.ScheduledTime DESC
      `);

    let totalTaken = 0;
    let totalMissed = 0;

    // Group logs by date
    const dateGroups = {};

    result.recordset.forEach(row => {
      if (row.Status === 'taken') totalTaken++;
      if (row.Status === 'missed') totalMissed++;

      // We need a clean date string (YYYY-MM-DD format usually, but here we can just use toLocaleDateString)
      const d = new Date(row.ScheduledDate);
      // Create a stable key like 'YYYY-MM-DD'
      const dateKey = d.toISOString().split('T')[0];

      if (!dateGroups[dateKey]) {
        dateGroups[dateKey] = {
          date: dateKey, // backend can return ISO string
          logs: [],
        };
      }
      
      dateGroups[dateKey].logs.push({
        time: row.ScheduledTime,
        status: row.Status,
        name: row.Name,
        dosage: row.Dosage,
      });
    });

    const total = totalTaken + totalMissed;
    const adherenceScore = total > 0 ? Math.round((totalTaken / total) * 100) : 0;
    const weeklyLogs = Object.values(dateGroups);

    res.status(200).json({
      success: true,
      data: {
        adherenceScore,
        totalTaken,
        totalMissed,
        weeklyLogs,
        hasActiveMedicines,
      }
    });

  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch history',
      error: error.message,
    });
  }
};

module.exports = {
  createMedicine,
  getMedicinesByParent,
  getMedicineTracking,
  getMyMedicines,
  confirmMedicine,
  updateMedicineStatus,
  getTodaySchedule,
  updateMedicine,
  deleteMedicine,
  getMedicineHistory,
};

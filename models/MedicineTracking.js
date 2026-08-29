const { getConnection, mssql } = require('../config/database');

class MedicineTracking {
  // Create a tracking record
  static async create({ medicineId, scheduledDate, scheduledTime, status = 'pending', notes }) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('medicineId', mssql.Int, medicineId)
      .input('scheduledDate', mssql.Date, scheduledDate)
      .input('scheduledTime', mssql.Time, scheduledTime)
      .input('status', mssql.VarChar, status)
      .input('notes', mssql.NVarChar, notes || null)
      .query(`
        INSERT INTO MedicineTracking (MedicineId, ScheduledDate, ScheduledTime, Status, Notes, CreatedAt)
        VALUES (@medicineId, @scheduledDate, @scheduledTime, @status, @notes, GETDATE());
        SELECT SCOPE_IDENTITY() AS TrackingId;
      `);
    
    return result.recordset[0].TrackingId;
  }

  // Get tracking record by ID
  static async findById(trackingId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('trackingId', mssql.Int, trackingId)
      .query(`
        SELECT mt.*, m.Name as MedicineName, m.Dosage, m.ParentId, m.ChildId
        FROM MedicineTracking mt
        LEFT JOIN Medicines m ON mt.MedicineId = m.MedicineId
        WHERE mt.TrackingId = @trackingId
      `);
    
    return result.recordset[0] || null;
  }

  // Get all tracking records for a medicine
  static async getByMedicineId(medicineId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('medicineId', mssql.Int, medicineId)
      .query(`
        SELECT * FROM MedicineTracking 
        WHERE MedicineId = @medicineId
        ORDER BY ScheduledDate DESC, ScheduledTime DESC
      `);
    
    return result.recordset;
  }

  // Get tracking records for a parent (all medicines)
  static async getByParentId(parentId, startDate, endDate) {
    const pool = await getConnection();
    const request = pool.request().input('parentId', mssql.Int, parentId);
    
    let query = `
      SELECT mt.*, m.Name as MedicineName, m.Dosage, m.Frequency
      FROM MedicineTracking mt
      LEFT JOIN Medicines m ON mt.MedicineId = m.MedicineId
      WHERE m.ParentId = @parentId
    `;
    
    if (startDate) {
      request.input('startDate', mssql.Date, startDate);
      query += ' AND mt.ScheduledDate >= @startDate';
    }
    if (endDate) {
      request.input('endDate', mssql.Date, endDate);
      query += ' AND mt.ScheduledDate <= @endDate';
    }
    
    query += ' ORDER BY mt.ScheduledDate DESC, mt.ScheduledTime DESC';
    
    const result = await request.query(query);
    return result.recordset;
  }

  // Get today's tracking records for a parent
  static async getTodayByParentId(parentId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT mt.*, m.Name as MedicineName, m.Dosage, m.Frequency
        FROM MedicineTracking mt
        LEFT JOIN Medicines m ON mt.MedicineId = m.MedicineId
        WHERE m.ParentId = @parentId 
          AND CAST(mt.ScheduledDate AS DATE) = CAST(GETDATE() AS DATE)
        ORDER BY mt.ScheduledTime ASC
      `);
    
    return result.recordset;
  }

  // Update tracking status (confirm medicine taken)
  static async updateStatus(trackingId, status, takenAt, notes) {
    const pool = await getConnection();
    await pool
      .request()
      .input('trackingId', mssql.Int, trackingId)
      .input('status', mssql.VarChar, status)
      .input('takenAt', mssql.DateTime, takenAt || null)
      .input('notes', mssql.NVarChar, notes || null)
      .query(`
        UPDATE MedicineTracking 
        SET Status = @status, TakenAt = @takenAt, Notes = @notes
        WHERE TrackingId = @trackingId
      `);
    
    return true;
  }

  // Mark medicine as taken
  static async markAsTaken(trackingId, notes) {
    return await this.updateStatus(trackingId, 'taken', new Date(), notes);
  }

  // Mark medicine as missed
  static async markAsMissed(trackingId, notes) {
    return await this.updateStatus(trackingId, 'missed', null, notes);
  }

  // Delete tracking record
  static async delete(trackingId) {
    const pool = await getConnection();
    await pool
      .request()
      .input('trackingId', mssql.Int, trackingId)
      .query('DELETE FROM MedicineTracking WHERE TrackingId = @trackingId');
    
    return true;
  }

  // Get statistics for a parent
  static async getStatistics(parentId, startDate, endDate) {
    const pool = await getConnection();
    const request = pool.request().input('parentId', mssql.Int, parentId);
    
    let query = `
      SELECT 
        COUNT(*) as Total,
        SUM(CASE WHEN mt.Status = 'taken' THEN 1 ELSE 0 END) as Taken,
        SUM(CASE WHEN mt.Status = 'missed' THEN 1 ELSE 0 END) as Missed,
        SUM(CASE WHEN mt.Status = 'pending' THEN 1 ELSE 0 END) as Pending
      FROM MedicineTracking mt
      LEFT JOIN Medicines m ON mt.MedicineId = m.MedicineId
      WHERE m.ParentId = @parentId
    `;
    
    if (startDate) {
      request.input('startDate', mssql.Date, startDate);
      query += ' AND mt.ScheduledDate >= @startDate';
    }
    if (endDate) {
      request.input('endDate', mssql.Date, endDate);
      query += ' AND mt.ScheduledDate <= @endDate';
    }
    
    const result = await request.query(query);
    return result.recordset[0];
  }

  // Clean up old medicine tracking logs (older than 30 days to save free database storage)
  static async cleanupOldLogs() {
    try {
      const pool = await getConnection();
      
      const result = await pool
        .request()
        .query(`
          DELETE FROM MedicineTracking
          WHERE ScheduledDate < DATEADD(DAY, -30, GETDATE())
        `);
      
      const deletedCount = result.rowsAffected[0];
      
      if (deletedCount > 0) {
        console.log(`🧹 Cleaned up ${deletedCount} old medicine tracking logs (older than 30 days)`);
      }
      
      return deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up old medicine tracking logs:', error);
      return 0;
    }
  }
}

module.exports = MedicineTracking;

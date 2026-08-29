const { getConnection, mssql } = require('../config/database');

class Medicine {
  // Create a new medicine schedule
  static async create({ name, dosage, frequency, time, parentId, childId, startDate, endDate, notes }) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('name', mssql.NVarChar, name)
      .input('dosage', mssql.NVarChar, dosage)
      .input('frequency', mssql.NVarChar, frequency)
      .input('time', mssql.Time, time)
      .input('parentId', mssql.Int, parentId)
      .input('childId', mssql.Int, childId)
      .input('startDate', mssql.Date, startDate)
      .input('endDate', mssql.Date, endDate || null)
      .input('notes', mssql.NVarChar, notes || null)
      .query(`
        INSERT INTO Medicines (Name, Dosage, Frequency, Time, ParentId, ChildId, StartDate, EndDate, Notes, IsActive, CreatedAt)
        VALUES (@name, @dosage, @frequency, @time, @parentId, @childId, @startDate, @endDate, @notes, 1, GETDATE());
        SELECT SCOPE_IDENTITY() AS MedicineId;
      `);
    
    return result.recordset[0].MedicineId;
  }

  // Get medicine by ID
  static async findById(medicineId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('medicineId', mssql.Int, medicineId)
      .query(`
        SELECT m.*, 
               p.Name as ParentName, p.Email as ParentEmail,
               c.Name as ChildName, c.Email as ChildEmail
        FROM Medicines m
        LEFT JOIN Users p ON m.ParentId = p.UserId
        LEFT JOIN Users c ON m.ChildId = c.UserId
        WHERE m.MedicineId = @medicineId
      `);
    
    return result.recordset[0] || null;
  }

  // Get all medicines for a parent
  static async getByParentId(parentId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT m.*, c.Name as ChildName, c.Email as ChildEmail
        FROM Medicines m
        LEFT JOIN Users c ON m.ChildId = c.UserId
        WHERE m.ParentId = @parentId
        ORDER BY m.Time ASC
      `);
    
    return result.recordset;
  }

  // Get all medicines created by a child (caregiver)
  static async getByChildId(childId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('childId', mssql.Int, childId)
      .query(`
        SELECT m.*, p.Name as ParentName, p.Email as ParentEmail
        FROM Medicines m
        LEFT JOIN Users p ON m.ParentId = p.UserId
        WHERE m.ChildId = @childId
        ORDER BY m.Time ASC
      `);
    
    return result.recordset;
  }

  // Get today's medicines for a parent
  static async getTodayByParentId(parentId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT m.*, c.Name as ChildName
        FROM Medicines m
        LEFT JOIN Users c ON m.ChildId = c.UserId
        WHERE m.ParentId = @parentId 
          AND m.IsActive = 1
          AND CAST(GETDATE() AS DATE) BETWEEN m.StartDate AND ISNULL(m.EndDate, '9999-12-31')
        ORDER BY m.Time ASC
      `);
    
    return result.recordset;
  }

  // Update medicine
  static async update(medicineId, { name, dosage, frequency, time, startDate, endDate, notes, isActive }) {
    const pool = await getConnection();
    await pool
      .request()
      .input('medicineId', mssql.Int, medicineId)
      .input('name', mssql.NVarChar, name)
      .input('dosage', mssql.NVarChar, dosage)
      .input('frequency', mssql.NVarChar, frequency)
      .input('time', mssql.Time, time)
      .input('startDate', mssql.Date, startDate)
      .input('endDate', mssql.Date, endDate || null)
      .input('notes', mssql.NVarChar, notes || null)
      .input('isActive', mssql.Bit, isActive)
      .query(`
        UPDATE Medicines 
        SET Name = @name, Dosage = @dosage, Frequency = @frequency, 
            Time = @time, StartDate = @startDate, EndDate = @endDate, 
            Notes = @notes, IsActive = @isActive
        WHERE MedicineId = @medicineId
      `);
    
    return true;
  }

  // Delete medicine
  static async delete(medicineId) {
    const pool = await getConnection();
    await pool
      .request()
      .input('medicineId', mssql.Int, medicineId)
      .query('DELETE FROM Medicines WHERE MedicineId = @medicineId');
    
    return true;
  }

  // Deactivate medicine (soft delete)
  static async deactivate(medicineId) {
    const pool = await getConnection();
    await pool
      .request()
      .input('medicineId', mssql.Int, medicineId)
      .query('UPDATE Medicines SET IsActive = 0 WHERE MedicineId = @medicineId');
    
    return true;
  }
}

module.exports = Medicine;

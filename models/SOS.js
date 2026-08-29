const { getConnection, mssql } = require('../config/database');

class SOS {
  // Create SOS event
  static async create({ parentId, childId, message, location }) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .input('childId', mssql.Int, childId)
      .input('message', mssql.NVarChar, message || 'Emergency SOS triggered')
      .input('location', mssql.NVarChar, location || null)
      .query(`
        INSERT INTO SOSEvents (ParentId, ChildId, Message, Location, Status, CreatedAt)
        VALUES (@parentId, @childId, @message, @location, 'active', GETDATE());
        SELECT SCOPE_IDENTITY() AS SOSId;
      `);
    
    return result.recordset[0].SOSId;
  }

  // Get SOS by ID
  static async findById(sosId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('sosId', mssql.Int, sosId)
      .query(`
        SELECT 
          s.*,
          p.Name as ParentName,
          p.Email as ParentEmail,
          p.PhoneNumber as ParentPhone,
          c.Name as ChildName,
          c.Email as ChildEmail,
          c.PhoneNumber as ChildPhone
        FROM SOSEvents s
        LEFT JOIN Users p ON s.ParentId = p.UserId
        LEFT JOIN Users c ON s.ChildId = c.UserId
        WHERE s.SOSId = @sosId
      `);
    
    return result.recordset[0] || null;
  }

  // Get SOS events for a parent
  static async getByParentId(parentId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT 
          s.*,
          c.Name as ChildName,
          c.Email as ChildEmail
        FROM SOSEvents s
        LEFT JOIN Users c ON s.ChildId = c.UserId
        WHERE s.ParentId = @parentId
        ORDER BY s.CreatedAt DESC
      `);
    
    return result.recordset;
  }

  // Get active SOS events for a parent
  static async getActiveByParentId(parentId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT 
          s.*,
          c.Name as ChildName,
          c.Email as ChildEmail
        FROM SOSEvents s
        LEFT JOIN Users c ON s.ChildId = c.UserId
        WHERE s.ParentId = @parentId AND s.Status = 'active'
        ORDER BY s.CreatedAt DESC
      `);
    
    return result.recordset;
  }

  // Get SOS events for a child
  static async getByChildId(childId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('childId', mssql.Int, childId)
      .query(`
        SELECT 
          s.*,
          p.Name as ParentName,
          p.Email as ParentEmail
        FROM SOSEvents s
        LEFT JOIN Users p ON s.ParentId = p.UserId
        WHERE s.ChildId = @childId
        ORDER BY s.CreatedAt DESC
      `);
    
    return result.recordset;
  }

  // Acknowledge SOS
  static async acknowledge(sosId, childId) {
    const pool = await getConnection();
    await pool
      .request()
      .input('sosId', mssql.Int, sosId)
      .input('childId', mssql.Int, childId)
      .query(`
        UPDATE SOSEvents 
        SET Status = 'acknowledged', AcknowledgedAt = GETDATE()
        WHERE SOSId = @sosId AND ChildId = @childId AND Status = 'active'
      `);
    
    return true;
  }

  // Resolve SOS
  static async resolve(sosId, childId) {
    const pool = await getConnection();
    await pool
      .request()
      .input('sosId', mssql.Int, sosId)
      .input('childId', mssql.Int, childId)
      .query(`
        UPDATE SOSEvents 
        SET Status = 'resolved', ResolvedAt = GETDATE()
        WHERE SOSId = @sosId AND ChildId = @childId
      `);
    
    return true;
  }

  // Get SOS statistics for a parent
  static async getStats(parentId, days = 30) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .input('days', mssql.Int, days)
      .query(`
        SELECT 
          COUNT(*) as TotalSOS,
          SUM(CASE WHEN Status = 'active' THEN 1 ELSE 0 END) as ActiveSOS,
          SUM(CASE WHEN Status = 'acknowledged' THEN 1 ELSE 0 END) as AcknowledgedSOS,
          SUM(CASE WHEN Status = 'resolved' THEN 1 ELSE 0 END) as ResolvedSOS
        FROM SOSEvents 
        WHERE ParentId = @parentId 
          AND CreatedAt >= DATEADD(DAY, -@days, GETDATE())
      `);
    
    return result.recordset[0];
  }
}

module.exports = SOS;

const { getConnection, mssql } = require('../config/database');

class Alert {
  // Create a new alert
  static async create({ 
    parentId, 
    childId, 
    alertType, 
    title, 
    message, 
    severity = 'medium',
    relatedEntityId = null,
    relatedEntityType = null 
  }) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .input('childId', mssql.Int, childId || null)
      .input('alertType', mssql.VarChar, alertType)
      .input('title', mssql.NVarChar, title)
      .input('message', mssql.NVarChar, message || null)
      .input('severity', mssql.VarChar, severity)
      .input('relatedEntityId', mssql.Int, relatedEntityId)
      .input('relatedEntityType', mssql.VarChar, relatedEntityType)
      .query(`
        INSERT INTO Alerts (ParentId, ChildId, AlertType, Title, Message, Severity, IsRead, RelatedEntityId, RelatedEntityType, CreatedAt)
        VALUES (@parentId, @childId, @alertType, @title, @message, @severity, 0, @relatedEntityId, @relatedEntityType, GETDATE());
        SELECT SCOPE_IDENTITY() AS AlertId;
      `);
    
    return result.recordset[0].AlertId;
  }

  // Get alerts for a parent
  static async getByParentId(parentId, limit = 50) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .input('limit', mssql.Int, limit)
      .query(`
        SELECT TOP (@limit) 
          a.*,
          c.Name as ChildName,
          c.Email as ChildEmail
        FROM Alerts a
        LEFT JOIN Users c ON a.ChildId = c.UserId
        WHERE a.ParentId = @parentId
        ORDER BY a.CreatedAt DESC
      `);
    
    return result.recordset;
  }

  // Get unread alerts for a parent
  static async getUnreadByParentId(parentId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT 
          a.*,
          c.Name as ChildName,
          c.Email as ChildEmail
        FROM Alerts a
        LEFT JOIN Users c ON a.ChildId = c.UserId
        WHERE a.ParentId = @parentId AND a.IsRead = 0
        ORDER BY a.CreatedAt DESC
      `);
    
    return result.recordset;
  }

  // Mark alert as read
  static async markAsRead(alertId, parentId) {
    const pool = await getConnection();
    await pool
      .request()
      .input('alertId', mssql.Int, alertId)
      .input('parentId', mssql.Int, parentId)
      .query(`
        UPDATE Alerts 
        SET IsRead = 1, ReadAt = GETDATE()
        WHERE AlertId = @alertId AND ParentId = @parentId
      `);
    
    return true;
  }

  // Mark all alerts as read for a parent
  static async markAllAsRead(parentId) {
    const pool = await getConnection();
    await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .query(`
        UPDATE Alerts 
        SET IsRead = 1, ReadAt = GETDATE()
        WHERE ParentId = @parentId AND IsRead = 0
      `);
    
    return true;
  }

  // Get alert by ID
  static async findById(alertId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('alertId', mssql.Int, alertId)
      .query(`
        SELECT 
          a.*,
          c.Name as ChildName,
          c.Email as ChildEmail
        FROM Alerts a
        LEFT JOIN Users c ON a.ChildId = c.UserId
        WHERE a.AlertId = @alertId
      `);
    
    return result.recordset[0] || null;
  }

  // Delete old alerts (older than X days)
  static async deleteOld(days = 30) {
    const pool = await getConnection();
    await pool
      .request()
      .input('days', mssql.Int, days)
      .query(`
        DELETE FROM Alerts 
        WHERE CreatedAt < DATEADD(DAY, -@days, GETDATE())
      `);
    
    return true;
  }

  // Get alert count by type for a parent
  static async getCountByType(parentId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT 
          AlertType,
          COUNT(*) as Count,
          SUM(CASE WHEN IsRead = 0 THEN 1 ELSE 0 END) as UnreadCount
        FROM Alerts 
        WHERE ParentId = @parentId
        GROUP BY AlertType
      `);
    
    return result.recordset;
  }
}

module.exports = Alert;

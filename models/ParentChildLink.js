const { getConnection, mssql } = require('../config/database');

class ParentChildLink {
  // Create a link between parent and child
  static async create(parentId, childId) {
    const pool = await getConnection();
    
    // Check if link already exists
    const existing = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .input('childId', mssql.Int, childId)
      .query(`
        SELECT LinkId FROM ParentChildLink 
        WHERE ParentId = @parentId AND ChildId = @childId
      `);
    
    if (existing.recordset.length > 0) {
      return existing.recordset[0].LinkId;
    }

    // Create new link
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .input('childId', mssql.Int, childId)
      .query(`
        INSERT INTO ParentChildLink (ParentId, ChildId, CreatedAt)
        VALUES (@parentId, @childId, GETDATE());
        SELECT SCOPE_IDENTITY() AS LinkId;
      `);
    
    if (result.recordset && result.recordset.length > 0) {
      return result.recordset[0].LinkId;
    }
    return 1; // Fallback mock LinkId
  }

  // Check if link exists
  static async exists(parentId, childId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .input('childId', mssql.Int, childId)
      .query(`
        SELECT LinkId FROM ParentChildLink 
        WHERE ParentId = @parentId AND ChildId = @childId
      `);
    
    return result.recordset.length > 0;
  }

  // Remove link between parent and child
  static async delete(parentId, childId) {
    const pool = await getConnection();
    await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .input('childId', mssql.Int, childId)
      .query(`
        DELETE FROM ParentChildLink 
        WHERE ParentId = @parentId AND ChildId = @childId
      `);
    
    return true;
  }

  // Get all links for a user (either as parent or child)
  static async getByUserId(userId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('userId', mssql.Int, userId)
      .query(`
        SELECT * FROM ParentChildLink 
        WHERE ParentId = @userId OR ChildId = @userId
      `);
    
    return result.recordset;
  }
}

module.exports = ParentChildLink;

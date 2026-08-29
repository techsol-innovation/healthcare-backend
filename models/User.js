const { getConnection, mssql } = require('../config/database');

class User {
  // Create a new user
  static async create({ name, email, passwordHash, role, phoneNumber }) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('name', mssql.NVarChar, name)
      .input('email', mssql.VarChar, email)
      .input('passwordHash', mssql.VarChar, passwordHash)
      .input('role', mssql.VarChar, role)
      .input('phoneNumber', mssql.VarChar, phoneNumber || null)
      .query(`
        INSERT INTO Users (Name, Email, PasswordHash, Role, PhoneNumber, CreatedAt)
        VALUES (@name, @email, @passwordHash, @role, @phoneNumber, GETDATE());
        SELECT SCOPE_IDENTITY() AS UserId;
      `);
    
    return result.recordset[0].UserId;
  }

  // Find user by email
  static async findByEmail(email) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('email', mssql.VarChar, email)
      .query('SELECT * FROM Users WHERE Email = @email');
    
    return result.recordset[0] || null;
  }

  // Find user by ID
  static async findById(userId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('userId', mssql.Int, userId)
      .query('SELECT UserId, Name, Email, Role, PhoneNumber, PushToken, CreatedAt FROM Users WHERE UserId = @userId');
    
    return result.recordset[0] || null;
  }

  // Update Push Token
  static async updatePushToken(userId, token) {
    const pool = await getConnection();
    await pool
      .request()
      .input('userId', mssql.Int, userId)
      .input('token', mssql.VarChar, token)
      .query('UPDATE Users SET PushToken = @token WHERE UserId = @userId');
    return true;
  }

  // Get all parents linked to a child
  static async getParentsByChildId(childId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('childId', mssql.Int, childId)
      .query(`
        SELECT u.UserId, u.Name, u.Email, u.PhoneNumber, u.CreatedAt
        FROM Users u
        INNER JOIN ParentChildLink pcl ON u.UserId = pcl.ParentId
        WHERE pcl.ChildId = @childId AND u.Role = 'parent'
      `);
    
    return result.recordset;
  }

  // Get all children linked to a parent
  static async getChildrenByParentId(parentId) {
    const pool = await getConnection();
    const result = await pool
      .request()
      .input('parentId', mssql.Int, parentId)
      .query(`
        SELECT u.UserId, u.Name, u.Email, u.PhoneNumber, u.CreatedAt
        FROM Users u
        INNER JOIN ParentChildLink pcl ON u.UserId = pcl.ChildId
        WHERE pcl.ParentId = @parentId AND u.Role = 'child'
      `);
    
    return result.recordset;
  }

  // Update user profile
  static async update(userId, { name, phoneNumber }) {
    const pool = await getConnection();
    await pool
      .request()
      .input('userId', mssql.Int, userId)
      .input('name', mssql.NVarChar, name)
      .input('phoneNumber', mssql.VarChar, phoneNumber)
      .query(`
        UPDATE Users 
        SET Name = @name, PhoneNumber = @phoneNumber
        WHERE UserId = @userId
      `);
    
    return true;
  }

  // Delete user
  static async delete(userId) {
    const pool = await getConnection();
    await pool
      .request()
      .input('userId', mssql.Int, userId)
      .query('DELETE FROM Users WHERE UserId = @userId');
    
    return true;
  }
}

module.exports = User;

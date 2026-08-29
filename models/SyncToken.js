const { getConnection, mssql } = require('../config/database');

// In-memory store for development/mock mode
const mockTokens = new Map();
let mockIdCounter = 1;

class SyncToken {
  // Generate a random 6-digit alphanumeric code
  static generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Create a new token
  static async create(caregiverId, parentId = null, parentName = null) {
    const pool = await getConnection();
    const tokenCode = this.generateCode();
    // Token expires in 15 minutes
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    try {
      // Attempt SQL insertion
      const result = await pool
        .request()
        .input('tokenCode', mssql.VarChar, tokenCode)
        .input('caregiverId', mssql.Int, caregiverId)
        .input('parentId', mssql.Int, parentId)
        .input('parentName', mssql.NVarChar, parentName)
        .input('expiresAt', mssql.DateTime, expiresAt)
        .query(`
          IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SyncTokens' and xtype='U')
          BEGIN
            CREATE TABLE SyncTokens (
              Id INT IDENTITY(1,1) PRIMARY KEY,
              TokenCode VARCHAR(6) NOT NULL,
              CaregiverId INT NOT NULL,
              ParentId INT NULL,
              ParentName NVARCHAR(100) NULL,
              ExpiresAt DATETIME NOT NULL,
              IsUsed BIT DEFAULT 0,
              CreatedAt DATETIME DEFAULT GETDATE()
            )
          END
          
          INSERT INTO SyncTokens (TokenCode, CaregiverId, ParentId, ParentName, ExpiresAt, IsUsed)
          VALUES (@tokenCode, @caregiverId, @parentId, @parentName, @expiresAt, 0);
          SELECT SCOPE_IDENTITY() AS Id;
        `);
      
      // Store in memory for mock mode
      mockTokens.set(tokenCode, {
        Id: mockIdCounter++,
        TokenCode: tokenCode,
        CaregiverId: caregiverId,
        ParentId: parentId,
        ParentName: parentName,
        ExpiresAt: expiresAt,
        IsUsed: false
      });

      return tokenCode;
    } catch (err) {
      console.warn('SQL execution failed, using memory fallback for SyncTokens', err.message);
      // Fallback to memory
      mockTokens.set(tokenCode, {
        Id: mockIdCounter++,
        TokenCode: tokenCode,
        CaregiverId: caregiverId,
        ParentId: parentId,
        ParentName: parentName,
        ExpiresAt: expiresAt,
        IsUsed: false
      });
      return tokenCode;
    }
  }

  // Verify and consume a token
  static async verify(tokenCode) {
    const pool = await getConnection();
    
    // Check memory first (for mock mode)
    const memToken = mockTokens.get(tokenCode);
    if (memToken) {
      if (memToken.IsUsed) return { valid: false, reason: 'Token already used' };
      if (memToken.ExpiresAt < new Date()) return { valid: false, reason: 'Token expired' };
      
      mockTokens.delete(tokenCode);
      return { 
        valid: true, 
        token: memToken 
      };
    }

    try {
      const result = await pool
        .request()
        .input('tokenCode', mssql.VarChar, tokenCode)
        .query(`
          SELECT * FROM SyncTokens 
          WHERE TokenCode = @tokenCode
        `);
      
      if (result.recordset.length === 0) {
        return { valid: false, reason: 'Invalid token' };
      }

      const token = result.recordset[0];

      if (token.IsUsed) return { valid: false, reason: 'Token already used' };
      if (new Date(token.ExpiresAt) < new Date()) return { valid: false, reason: 'Token expired' };

      // Mark as used
      await pool
        .request()
        .input('tokenId', mssql.Int, token.Id)
        .query(`UPDATE SyncTokens SET IsUsed = 1 WHERE Id = @tokenId`);

      return {
        valid: true,
        token: token
      };
    } catch (err) {
      console.error('Verify token error:', err);
      return { valid: false, reason: 'Server error' };
    }
  }
}

module.exports = SyncToken;

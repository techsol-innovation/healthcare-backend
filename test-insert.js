require('dotenv').config();
const { getConnection, mssql } = require('./config/database');

async function testInsert() {
  try {
    const pool = await getConnection();
    const result = await pool.request()
      .query(`
        INSERT INTO Users (Name, Email, PasswordHash, Role, PhoneNumber, IsActivated, CreatedAt)
        OUTPUT INSERTED.UserId
        VALUES ('Test User', 'test' + CAST(NEWID() AS VARCHAR(50)) + '@example.com', 'hash', 'child', '1234567890', 1, GETDATE());
      `);
    
    console.log('Result of OUTPUT INSERTED:', JSON.stringify(result, null, 2));

    const result2 = await pool.request()
      .query(`
        INSERT INTO Users (Name, Email, PasswordHash, Role, PhoneNumber, IsActivated, CreatedAt)
        VALUES ('Test User 2', 'test2' + CAST(NEWID() AS VARCHAR(50)) + '@example.com', 'hash', 'child', '1234567890', 1, GETDATE());
        SELECT SCOPE_IDENTITY() AS UserId;
      `);
    
    console.log('Result of SCOPE_IDENTITY:', JSON.stringify(result2, null, 2));

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

testInsert();

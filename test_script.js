const { getConnection, mssql } = require('./config/database');
const ParentChildLink = require('./models/ParentChildLink');

async function run() {
  const pool = await getConnection();
  const CaregiverId = 101;

  const insertResult = await pool.request()
    .input('name', mssql.NVarChar, 'Parent')
    .input('email', mssql.VarChar, 'parent_1@sync.local')
    .input('passwordHash', mssql.VarChar, 'dummy')
    .input('role', mssql.VarChar, 'parent')
    .input('isActivated', mssql.Bit, 1)
    .query(`
      INSERT INTO Users (Name, Email, PasswordHash, Role, IsActivated, CreatedAt)
      OUTPUT INSERTED.UserId
      VALUES (@name, @email, @passwordHash, @role, @isActivated, GETDATE());
    `);
  
  const targetParentId = insertResult.recordset[0].UserId;
  console.log('Created User ID:', targetParentId);

  await ParentChildLink.create(targetParentId, CaregiverId);

  const getParents = await pool.request()
    .input('childUserId', mssql.Int, CaregiverId)
    .query(`
      SELECT u.UserId, u.Name FROM ParentChildLink pcl
      JOIN Users u ON pcl.ParentId = u.UserId
      WHERE pcl.ChildId = @childUserId
    `);
  
  console.log('Linked parents:', getParents.recordset);
}
run().catch(console.error);

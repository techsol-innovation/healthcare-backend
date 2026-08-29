const { getConnection, mssql } = require('./config/database');

async function testAlerts() {
  const pool = await getConnection();
  
  // Create an alert
  console.log('Creating alert...');
  const result = await pool.request()
    .input('parentId', mssql.Int, 101) // Caregiver ID
    .input('childId', mssql.Int, 202)  // Parent ID
    .input('alertType', mssql.VarChar, 'sos')
    .input('title', mssql.NVarChar, 'Test SOS')
    .input('message', mssql.NVarChar, 'Test msg')
    .input('severity', mssql.VarChar, 'critical')
    .input('relatedEntityId', mssql.Int, 1)
    .input('relatedEntityType', mssql.VarChar, 'sos')
    .query(`
        INSERT INTO Alerts (ParentId, ChildId, AlertType, Title, Message, Severity, IsRead, RelatedEntityId, RelatedEntityType, CreatedAt)
        VALUES (@parentId, @childId, @alertType, @title, @message, @severity, 0, @relatedEntityId, @relatedEntityType, GETDATE());
        SELECT SCOPE_IDENTITY() AS AlertId;
    `);
    
  console.log('Alert created:', result.recordset);
  
  // Fetch unread alerts
  console.log('Fetching unread alerts for 101...');
  const unread = await pool.request()
    .input('parentId', mssql.Int, 101)
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
    
  console.log('Unread alerts:', unread.recordset);
  
  const fs = require('fs');
  fs.writeFileSync('alert_test_output.txt', JSON.stringify({
    created: result.recordset,
    unread: unread.recordset
  }, null, 2));
  
  console.log("Done!");
  process.exit(0);
}

testAlerts().catch(console.error);

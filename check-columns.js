const db = require('./config/database');

async function check() {
  const pool = await db.getConnection();
  
  // Add missing FCMTokens columns
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FCMTokens') AND name = 'DeviceInfo')
    ALTER TABLE FCMTokens ADD DeviceInfo NVARCHAR(MAX) NULL
  `);
  console.log('✅ FCMTokens.DeviceInfo ensured');
  
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('FCMTokens') AND name = 'RegisteredAt')
    ALTER TABLE FCMTokens ADD RegisteredAt DATETIME NOT NULL DEFAULT GETDATE()
  `);
  console.log('✅ FCMTokens.RegisteredAt ensured');
  
  // Add missing SOSEvents columns
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('SOSEvents') AND name = 'Location')
    ALTER TABLE SOSEvents ADD Location NVARCHAR(MAX) NULL
  `);
  console.log('✅ SOSEvents.Location ensured');
  
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('SOSEvents') AND name = 'AcknowledgedAt')
    ALTER TABLE SOSEvents ADD AcknowledgedAt DATETIME NULL
  `);
  console.log('✅ SOSEvents.AcknowledgedAt ensured');
  
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('SOSEvents') AND name = 'ResolvedAt')
    ALTER TABLE SOSEvents ADD ResolvedAt DATETIME NULL
  `);
  console.log('✅ SOSEvents.ResolvedAt ensured');
  
  // Verify final state
  const fcm = await pool.request().query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'FCMTokens'"
  );
  console.log('FCMTokens columns:', fcm.recordset.map(x => x.COLUMN_NAME));
  
  const sos = await pool.request().query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SOSEvents'"
  );
  console.log('SOSEvents columns:', sos.recordset.map(x => x.COLUMN_NAME));
  
  process.exit(0);
}

check().catch(e => { console.error(e); process.exit(1); });

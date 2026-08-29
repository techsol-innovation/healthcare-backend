const { getConnection } = require('./config/database');

(async () => {
  try {
    const pool = await getConnection();
    
    // Check if BatteryLogs table exists
    const tableCheck = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = 'BatteryLogs'
    `);
    
    if (tableCheck.recordset.length === 0) {
      console.log('❌ BatteryLogs table does NOT exist');
      console.log('📋 Need to create battery monitoring tables');
      process.exit(0);
    }
    
    console.log('✅ BatteryLogs table exists');
    
    // Get columns
    const columns = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'BatteryLogs'
      ORDER BY ORDINAL_POSITION
    `);
    
    console.log('\n📊 BatteryLogs Table Structure:');
    console.log('================================');
    columns.recordset.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME} (${col.DATA_TYPE}) ${col.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();

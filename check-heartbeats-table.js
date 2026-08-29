const { getConnection } = require('./config/database');

(async () => {
  try {
    const pool = await getConnection();
    
    // Check if Heartbeats table exists
    const tableCheck = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = 'Heartbeats'
    `);
    
    if (tableCheck.recordset.length === 0) {
      console.log('❌ Heartbeats table does NOT exist');
      process.exit(0);
    }
    
    console.log('✅ Heartbeats table exists');
    
    // Get columns
    const columns = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'Heartbeats'
      ORDER BY ORDINAL_POSITION
    `);
    
    console.log('\n📊 Heartbeats Table Structure:');
    console.log('================================');
    columns.recordset.forEach(col => {
      const maxLength = col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '';
      console.log(`  - ${col.COLUMN_NAME} (${col.DATA_TYPE}${maxLength}) ${col.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();

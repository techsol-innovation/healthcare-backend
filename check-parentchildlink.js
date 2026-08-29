const { getConnection } = require('./config/database');

(async () => {
  try {
    const pool = await getConnection();
    
    const columns = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'ParentChildLink'
      ORDER BY ORDINAL_POSITION
    `);
    
    console.log('📊 ParentChildLink Table Columns:');
    console.log('==================================');
    columns.recordset.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME} (${col.DATA_TYPE})`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();

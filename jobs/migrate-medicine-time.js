const { getConnection } = require('../config/database');

const migrateMedicineTime = async () => {
  try {
    const pool = await getConnection();
    
    console.log('🔄 Running migration: Altering Medicines.Time to VARCHAR(100)...');
    
    await pool.request().query(`
      ALTER TABLE Medicines
      ALTER COLUMN Time VARCHAR(100) NOT NULL;
    `);
    
    console.log('✅ Migration complete! Medicines.Time is now VARCHAR(100).');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

migrateMedicineTime();

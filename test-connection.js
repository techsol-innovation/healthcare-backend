const mssql = require('mssql');
require('dotenv').config();

const config = {
  server: 'localhost',
  database: 'MedicineReminderDB',
  user: 'sa',
  password: 'YourPassword123',
  port: 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
};

console.log('Testing database connection with SQL Authentication');
console.log('Server:', config.server);
console.log('Database:', config.database);
console.log('User:', config.user);

async function testConnection() {
  try {
    console.log('Attempting to connect...');
    const pool = await mssql.connect(config);
    console.log('✅ Connection successful!');
    
    const result = await pool.request().query('SELECT @@VERSION AS version');
    console.log('Database version:', result.recordset[0].version);
    
    await pool.close();
    console.log('Connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

testConnection();

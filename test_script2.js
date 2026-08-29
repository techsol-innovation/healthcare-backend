const { getConnection } = require('./config/database');

async function check() {
  const pool = await getConnection();
  const res = await pool.request().query('SELECT * FROM ParentChildLink');
  console.log(res.recordset);
  
  const res2 = await pool.request().query('SELECT * FROM Users');
  console.log(res2.recordset);
  process.exit(0);
}
check();

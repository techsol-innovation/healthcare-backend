require('dotenv').config();
const { getConnection, mssql, sql } = require('./config/database');
const fs = require('fs');
const code = fs.readFileSync('./jobs/medicineScheduler.js', 'utf8');

async function runTest() {
  const pool = await getConnection();
  // Get first parent and child
  const users = await pool.request().query("SELECT UserId, Role FROM Users WHERE Role IN ('parent', 'child')");
  let parent = users.recordset.find(u => u.Role === 'parent');
  let child = users.recordset.find(u => u.Role === 'child');
  
  if (!parent || !child) { console.log('No users found'); process.exit(0); }

  // Create a medicine exactly 11 minutes ago
  let d = new Date();
  d.setMinutes(d.getMinutes() - 11);
  let hours = d.getHours();
  let ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  let mins = d.getMinutes().toString().padStart(2, '0');
  let timeStr = hours.toString().padStart(2, '0') + ':' + mins + ' ' + ampm;
  console.log('Testing timeStr:', timeStr);

  const m = await pool.request()
    .input('name', sql.NVarChar, 'Test Med 10min')
    .input('dosage', sql.NVarChar, '1 pill')
    .input('frequency', sql.VarChar, 'daily')
    .input('time', sql.VarChar, timeStr)
    .input('parentId', sql.Int, parent.UserId)
    .input('childId', sql.Int, child.UserId)
    .input('startDate', sql.Date, new Date())
    .query(`
      INSERT INTO Medicines (Name, Dosage, Frequency, Time, ParentId, ChildId, StartDate, IsActive)
      OUTPUT INSERTED.MedicineId
      VALUES (@name, @dosage, @frequency, @time, @parentId, @childId, @startDate, 1)
    `);
  
  let medId = m.recordset[0].MedicineId;
  console.log('Created med:', medId);

  // Evaluate the scheduler code and run it
  eval(code + '\n\ncheckMedicines().then(() => {\n' +
    '  console.log(\'Check done\');\n' +
    '  pool.request().query(\'SELECT * FROM Alerts WHERE RelatedEntityId = \' + medId).then(r => { console.log(r.recordset); process.exit(0); })\n' +
    '}).catch(e => { console.error(e); process.exit(1); });');
}
runTest();

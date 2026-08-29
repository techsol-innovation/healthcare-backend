require('dotenv').config();
const { getConnection, mssql, sql } = require('./config/database');
const fs = require('fs');

async function testUpdateStatus() {
  const pool = await getConnection();
  // Find a medicine
  const meds = await pool.request().query("SELECT TOP 1 * FROM Medicines WHERE Time LIKE '%PM%' OR Time LIKE '%AM%'");
  if (meds.recordset.length === 0) {
    console.log('No meds with AM/PM found.');
    process.exit(0);
  }
  
  const med = meds.recordset[0];
  console.log('Found Med:', med.Name, med.Time);
  
  // Try to create tracking
  await pool.request()
    .input('medicineId', sql.Int, med.MedicineId)
    .input('scheduledDate', sql.Date, new Date())
    .input('scheduledTime', sql.VarChar, med.Time)
    .input('status', sql.VarChar, 'taken')
    .query(`
      INSERT INTO MedicineTracking (MedicineId, ScheduledDate, ScheduledTime, Status, TakenAt, CreatedAt)
      VALUES (@medicineId, @scheduledDate, @scheduledTime, @status, GETDATE(), GETDATE())
    `);
    
  // Now simulate getTodaySchedule
  const result = await pool
      .request()
      .input('parentId', mssql.Int, med.ParentId)
      .query(`
        SELECT 
          m.MedicineId,
          m.Name,
          m.Time as ScheduledTimeString,
          mt.Status,
          mt.ScheduledTime as ActualTime
        FROM Medicines m
        LEFT JOIN MedicineTracking mt ON m.MedicineId = mt.MedicineId 
          AND CAST(mt.ScheduledDate AS DATE) = CAST(GETDATE() AS DATE)
        WHERE m.ParentId = @parentId AND m.MedicineId = ${med.MedicineId}
      `);
      
  console.log('Join Result:', result.recordset);
  
  // Test parsing
  const row = result.recordset[0];
  const t = row.ScheduledTimeString;
  const trackings = {};
  trackings[row.ActualTime] = row.Status;
  console.log('Match?', trackings[t] === row.Status, '| Expected:', t, 'Actual:', row.ActualTime);
  
  process.exit(0);
}

testUpdateStatus();

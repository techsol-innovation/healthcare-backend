const { getConnection } = require('./config/database');

async function test() {
  const pool = await getConnection();
  
  // Seed the mock DB to be sure
  const req1 = pool.request();
  await req1
    .input('parentId', 202)
    .input('childId', 101)
    .query('INSERT INTO ParentChildLink (ParentId, ChildId) VALUES (@parentId, @childId)');

  // Test getMedicinesByParent style
  const req2 = pool.request();
  const res2 = await req2
    .input('childId', 101)
    .input('parentId', '202') // String
    .query(`
        SELECT * FROM ParentChildLink
        WHERE ChildId = @childId AND ParentId = @parentId
      `);
  console.log('GET check:', res2.recordset);

  // Test createMedicine style
  const req3 = pool.request();
  try {
    const res3 = await req3
      .input('name', 'Aspirin')
      .input('dosage', '1 pill')
      .input('frequency', 'daily')
      .input('time', '09:00:00')
      .input('parentId', 202) // Number
      .input('childId', 101)
      .input('notes', null)
      .input('startDate', new Date())
      .query(`
        INSERT INTO Medicines (Name, Dosage, Frequency, Time, ParentId, ChildId, Notes, StartDate, IsActive, CreatedAt)
        VALUES (@name, @dosage, @frequency, CAST(@time AS TIME), @parentId, @childId, @notes, @startDate, 1, GETDATE());
        SELECT SCOPE_IDENTITY() AS MedicineId;
      `);
    console.log('INSERT check:', res3.recordset);
  } catch (err) {
    console.error('INSERT failed:', err.message);
  }

  process.exit(0);
}
test();

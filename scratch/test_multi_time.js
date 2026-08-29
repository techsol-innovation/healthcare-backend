const jwt = require('jsonwebtoken');
require('dotenv').config();

async function testInsert() {
  const token = jwt.sign({ userId: 1, role: 'child' }, process.env.JWT_SECRET);
  try {
    const res = await fetch('http://localhost:3000/api/medicines', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Med Twice Daily',
        dosage: '1 pill',
        frequency: 'twice_daily',
        time: '08:00, 14:00',
        parentId: 2, // assuming 2 is a valid parent ID
        notes: 'Take with food'
      })
    });
    const json = await res.json();
    console.log(json);
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
}
testInsert();

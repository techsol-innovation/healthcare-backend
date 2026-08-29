const mssql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT) || 1433,
  options: {
    encrypt: false, // Set to true for Azure
    trustServerCertificate: true, // Trust self-signed certificates
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

console.log(`Connecting to SQL Server: ${config.server} as user: ${config.user}`);

let pool = null;

const getConnection = async () => {
  try {
    if (pool) {
      return pool;
    }
    
    // Set this to false when you actually have SQL Server running locally
    const useMock = false; 

    if (useMock) {
      console.log('⚠️ Mocking SQL Server connection (Development Mode)...');

      // ── In-memory stores ────────────────────────────────────────────────
      if (!global._mockDB) {
        global._mockDB = {
          users: [
            // Seed: one existing child/caregiver account so login works
            {
              UserId: 101, Name: 'Caregiver User', Email: 'your@gmail.com',
              PasswordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LPZJFwFTte', // "password"
              Role: 'child', PhoneNumber: null, IsActivated: 1,
              CreatedAt: new Date().toISOString(),
            },
            // Seed: a parent user so links don't break on server restart
            {
              UserId: 202, Name: 'Mock Parent', Email: 'parent@sync.local',
              PasswordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LPZJFwFTte',
              Role: 'parent', PhoneNumber: null, IsActivated: 1,
              CreatedAt: new Date().toISOString(),
            }
          ],
          links: [
            { LinkId: 1, ParentId: 202, ChildId: 101, CreatedAt: new Date().toISOString() }
          ],           // { LinkId, ParentId, ChildId, CreatedAt }
          batteryLogs: [],     // { LogId, ParentUserId, BatteryPercentage, BatteryState, IsCharging, LoggedAt }
          medicines: [],
          medicineTracking: [],
          alerts: [],
          sosEvents: [],
          userIdCounter: 200,
          linkIdCounter: 1,
          logIdCounter: 1,
          medicineIdCounter: 1,
          trackingIdCounter: 1,
          alertIdCounter: 1,
          sosIdCounter: 1,
        };
      }
      const db = global._mockDB;

      pool = {
        request: () => {
          let params = {};
          const req = {
            input: function(name, _type, value) { params[name] = value; return this; },
            query: async (sql) => {
              const s = sql.trim();

              // ── Users ──────────────────────────────────────────────────
              if (s.includes('INSERT INTO Users')) {
                const newUser = {
                  UserId: db.userIdCounter++,
                  Name: params.name || params.Name || 'Parent',
                  Email: params.email || params.Email || `user${db.userIdCounter}@sync.local`,
                  PasswordHash: params.passwordHash || 'MOCK',
                  Role: params.role || 'parent',
                  PhoneNumber: params.phoneNumber || null,
                  IsActivated: params.isActivated !== undefined ? params.isActivated : 1,
                  CreatedAt: new Date().toISOString(),
                };
                db.users.push(newUser);
                console.log(`🗄️ Mock DB: Created user ${newUser.UserId} (${newUser.Email}, role=${newUser.Role})`);
                return { recordset: [{ UserId: newUser.UserId }] };
              }

              if (s.includes('UPDATE Users')) {
                const uid = params.userId;
                const user = db.users.find(u => u.UserId === uid);
                if (user) {
                  if (params.name !== undefined) user.Name = params.name;
                  if (params.passwordHash !== undefined) user.PasswordHash = params.passwordHash;
                  if (params.phoneNumber !== undefined) user.PhoneNumber = params.phoneNumber;
                  if (params.token !== undefined && s.includes('PushToken')) user.PushToken = params.token;
                  if (params.isActivated !== undefined) user.IsActivated = params.isActivated;
                  if (s.includes('IsActivated = 0')) user.IsActivated = 0;
                  if (s.includes('IsActivated = 1')) user.IsActivated = 1;
                }
                return { recordset: [] };
              }

              if (s.includes('SELECT') && s.includes('FROM Users') && !s.includes('JOIN')) {
                let results = [...db.users];
                if (params.email !== undefined)
                  results = results.filter(u => u.Email === params.email);
                if (params.userId !== undefined)
                  results = results.filter(u => u.UserId === params.userId);
                if (params.parentUserId !== undefined)
                  results = results.filter(u => u.UserId === params.parentUserId);
                if (s.includes("Role = 'parent'"))
                  results = results.filter(u => u.Role === 'parent');
                if (s.includes("Role = 'child'"))
                  results = results.filter(u => u.Role === 'child');
                return { recordset: results };
              }

              // ── JOIN: getProfile (parent + caregiver) ───────────────────
              if (s.includes('SELECT') && s.includes('FROM Users u') && s.includes('LEFT JOIN ParentChildLink pcl') && s.includes('u.UserId = @userId')) {
                const uid = Number(params.userId);
                const user = db.users.find(u => Number(u.UserId) === uid);
                if (!user) return { recordset: [] };
                
                const link = db.links.find(l => Number(l.ParentId) === uid);
                let caregiver = null;
                if (link) {
                  caregiver = db.users.find(u => Number(u.UserId) === Number(link.ChildId));
                }
                console.log(`🗄️ Mock DB: getProfile uid=${uid} → user=${user?.Name}, link=${JSON.stringify(link)}, caregiver=${caregiver?.Name || 'none'}`);

                const resultRow = {
                  UserId: user.UserId,
                  Name: user.Name,
                  Email: user.Email,
                  Role: user.Role,
                  PhoneNumber: user.PhoneNumber,
                  CreatedAt: user.CreatedAt,
                  CaregiverId: caregiver ? caregiver.UserId : null,
                  CaregiverName: caregiver ? caregiver.Name : null,
                  CaregiverEmail: caregiver ? caregiver.Email : null,
                  CaregiverPhone: caregiver ? caregiver.PhoneNumber : null
                };
                
                return { recordset: [resultRow] };
              }

              // ── ParentChildLink ────────────────────────────────────────
              if (s.includes('INSERT INTO ParentChildLink')) {
                // Accept both column orderings used throughout the codebase
                const parentId = params.parentId ?? params.parentUserId;
                const childId  = params.childId  ?? params.childUserId;
                const exists = db.links.find(l => l.ParentId === parentId && l.ChildId === childId);
                if (!exists) {
                  const link = { LinkId: db.linkIdCounter++, ParentId: parentId, ChildId: childId, CreatedAt: new Date().toISOString() };
                  db.links.push(link);
                  console.log(`🗄️ Mock DB: Created link Parent=${parentId} ↔ Child=${childId}`);
                  return { recordset: [{ LinkId: link.LinkId }] };
                }
                return { recordset: [{ LinkId: exists.LinkId }] };
              }

              if (s.includes('SELECT') && s.includes('FROM ParentChildLink') && !s.includes('JOIN')) {
                let results = [...db.links];
                if (params.parentId !== undefined)
                  results = results.filter(l => Number(l.ParentId) === Number(params.parentId));
                if (params.parentUserId !== undefined)
                  results = results.filter(l => Number(l.ParentId) === Number(params.parentUserId));
                if (params.childId !== undefined)
                  results = results.filter(l => Number(l.ChildId) === Number(params.childId));
                if (params.childUserId !== undefined)
                  results = results.filter(l => Number(l.ChildId) === Number(params.childUserId));
                return { recordset: results };
              }

              // ── JOIN: getLinkedParents (child → parents) ───────────────
              if (s.includes('FROM ParentChildLink') && s.includes('JOIN Users') && s.includes('pcl.ChildId = @childUserId')) {
                const childId = params.childUserId;
                const myLinks = db.links.filter(l => Number(l.ChildId) === Number(childId));
                const results = myLinks.map(l => {
                  const user = db.users.find(u => Number(u.UserId) === Number(l.ParentId));
                  return user ? { ...user, status: user.IsActivated ? 'active' : 'offline', CreatedAt: l.CreatedAt } : null;
                }).filter(Boolean);
                console.log(`🗄️ Mock DB: getLinkedParents for child=${childId} → found ${myLinks.length} links, returning ${results.length} parents`);
                return { recordset: results };
              }

              // ── JOIN: getCaregiver (parent → child) ───────────────────
              if (s.includes('FROM ParentChildLink') && s.includes('JOIN Users') && s.includes('pcl.ParentId = @parentUserId')) {
                const parentId = params.parentUserId;
                const myLinks = db.links.filter(l => Number(l.ParentId) === Number(parentId));
                const results = myLinks.map(l => {
                  const user = db.users.find(u => Number(u.UserId) === Number(l.ChildId));
                  return user ? { ...user, CreatedAt: l.CreatedAt } : null;
                }).filter(Boolean);
                console.log(`🗄️ Mock DB: getCaregiver for parent=${parentId} → found ${myLinks.length} links, returning ${results.length} caregivers`);
                return { recordset: results };
              }

              // ── JOIN: heartbeat/children status ───────────────────────
              if (s.includes('FROM Users') && s.includes('JOIN ParentChildLink')) {
                const parentId = params.parentId;
                const myLinks = db.links.filter(l => l.ParentId === parentId);
                const results = myLinks.map(l => {
                  const user = db.users.find(u => u.UserId === l.ChildId);
                  return user ? { ChildId: user.UserId, ChildName: user.Name, ChildEmail: user.Email } : null;
                }).filter(Boolean);
                return { recordset: results };
              }

              // ── Medicines ───────────────────────────────────────────
              if (s.includes('INSERT INTO Medicines')) {
                const newMed = {
                  MedicineId: db.medicineIdCounter++,
                  Name: params.name,
                  Dosage: params.dosage,
                  Frequency: params.frequency,
                  Time: params.time,
                  ParentId: Number(params.parentId),
                  ChildId: Number(params.childId),
                  Notes: params.notes || null,
                  IsActive: 1,
                  CreatedAt: new Date().toISOString()
                };
                db.medicines.push(newMed);
                console.log(`🗄️ Mock DB: Created Medicine ${newMed.Name} for Parent=${newMed.ParentId}`);
                return { recordset: [{ MedicineId: newMed.MedicineId }] };
              }

              if (s.includes('UPDATE Medicines') && s.includes('IsActive = 0')) {
                // Delete
                const medId = Number(params.medicineId);
                const med = db.medicines.find(m => m.MedicineId === medId);
                if (med) med.IsActive = 0;
                return { recordset: [], rowsAffected: [med ? 1 : 0] };
              }
              
              if (s.includes('UPDATE Medicines') && !s.includes('IsActive = 0')) {
                const medId = Number(params.medicineId);
                const med = db.medicines.find(m => m.MedicineId === medId);
                if (med) {
                  if (params.name !== undefined) med.Name = params.name;
                  if (params.dosage !== undefined) med.Dosage = params.dosage;
                  if (params.frequency !== undefined) med.Frequency = params.frequency;
                  if (params.time !== undefined) med.Time = params.time;
                  if (params.notes !== undefined) med.Notes = params.notes;
                  if (params.isActive !== undefined) med.IsActive = params.isActive;
                }
                return { recordset: [], rowsAffected: [med ? 1 : 0] };
              }

              if (s.includes('SELECT') && s.includes('FROM Medicines m') && s.includes('JOIN Users u ON m.ParentId = u.UserId')) {
                const pId = Number(params.parentId);
                const meds = db.medicines.filter(m => m.ParentId === pId && m.IsActive === 1);
                const results = meds.map(m => {
                  const u = db.users.find(user => user.UserId === pId);
                  return { ...m, ParentName: u ? u.Name : null };
                });
                return { recordset: results };
              }

              if (s.includes('SELECT') && s.includes('FROM Medicines m') && s.includes('JOIN Users u ON m.ChildId = u.UserId')) {
                const pId = Number(params.parentId);
                const meds = db.medicines.filter(m => m.ParentId === pId && m.IsActive === 1);
                const results = meds.map(m => {
                  const u = db.users.find(user => user.UserId === m.ChildId);
                  return { ...m, CaregiverName: u ? u.Name : null };
                });
                return { recordset: results };
              }

              if (s.includes('SELECT TOP 1 MedicineId FROM Medicines WHERE ParentId = @parentId AND IsActive = 1')) {
                 const pId = Number(params.parentId);
                 const med = db.medicines.find(m => m.ParentId === pId && m.IsActive === 1);
                 return { recordset: med ? [{ MedicineId: med.MedicineId }] : [] };
              }

              if (s.includes('SELECT MedicineId, Name') && s.includes('FROM Medicines') && s.includes('ParentId = @parentId')) {
                 const medId = Number(params.medicineId);
                 const pId = Number(params.parentId);
                 const med = db.medicines.find(m => m.MedicineId === medId && m.ParentId === pId);
                 return { recordset: med ? [med] : [] };
              }
              
              if (s.includes('SELECT * FROM Medicines')) {
                 const medId = Number(params.medicineId);
                 const cId = Number(params.childId);
                 const med = db.medicines.find(m => m.MedicineId === medId && m.ChildId === cId);
                 return { recordset: med ? [med] : [] };
              }

              // ── UPDATE Medicines (Soft Delete) ────────────────────────
              if (s.includes('UPDATE Medicines') && s.includes('IsActive = 0')) {
                const medId = Number(params.medicineId);
                const cId = Number(params.childId);
                const med = db.medicines.find(m => m.MedicineId === medId && m.ChildId === cId);
                if (med) {
                  med.IsActive = 0;
                  console.log(`🗄️ Mock DB: Soft-deleted Medicine ${medId}`);
                  return { recordset: [], rowsAffected: [1] };
                }
                return { recordset: [], rowsAffected: [0] };
              }

              // ── UPDATE Medicines (Edit) ───────────────────────────────
              if (s.includes('UPDATE Medicines') && s.includes('Name = @name')) {
                const medId = Number(params.medicineId);
                const med = db.medicines.find(m => m.MedicineId === medId);
                if (med) {
                  if (params.name !== undefined) med.Name = params.name;
                  if (params.dosage !== undefined) med.Dosage = params.dosage;
                  if (params.frequency !== undefined) med.Frequency = params.frequency;
                  if (params.time !== undefined) med.Time = params.time;
                  if (params.notes !== undefined) med.Notes = params.notes;
                  if (params.isActive !== undefined) med.IsActive = params.isActive;
                  console.log(`🗄️ Mock DB: Updated Medicine ${medId}`);
                  return { recordset: [], rowsAffected: [1] };
                }
                return { recordset: [], rowsAffected: [0] };
              }

              // ── MedicineTracking ───────────────────────────────────────

              if (s.includes('SELECT TrackingId, Status FROM MedicineTracking')) {
                 const medId = Number(params.medicineId);
                 const schedTime = params.scheduledTime;
                 const tr = db.medicineTracking.find(t => t.MedicineId === medId && (!schedTime || t.ScheduledTime === schedTime));
                 return { recordset: tr ? [tr] : [] };
              }
              
              if (s.includes('UPDATE MedicineTracking') && s.includes('INSERT INTO MedicineTracking')) {
                 // UPSERT Logic
                 const medId = Number(params.medicineId);
                 const schedTime = params.scheduledTime;
                 let tr = db.medicineTracking.find(t => t.MedicineId === medId && (!schedTime || t.ScheduledTime === schedTime));
                 if (tr) {
                    tr.Status = params.status !== undefined ? params.status : 'taken';
                    tr.TakenAt = params.takenAt !== undefined ? params.takenAt : new Date().toISOString();
                 } else {
                    tr = {
                       TrackingId: db.trackingIdCounter++,
                       MedicineId: medId,
                       ScheduledTime: schedTime,
                       ScheduledDate: params.scheduledDate !== undefined ? params.scheduledDate : new Date().toISOString(),
                       Status: params.status !== undefined ? params.status : 'taken',
                       TakenAt: params.takenAt !== undefined ? params.takenAt : new Date().toISOString(),
                    };
                    db.medicineTracking.push(tr);
                 }
                 return { recordset: [], rowsAffected: [1] };
              }
              
              if (s.includes('UPDATE MedicineTracking') && !s.includes('INSERT INTO MedicineTracking')) {
                 const medId = Number(params.medicineId);
                 const schedTime = params.scheduledTime;
                 const tr = db.medicineTracking.find(t => t.MedicineId === medId && (!schedTime || t.ScheduledTime === schedTime));
                 if (tr) {
                    tr.Status = params.status !== undefined ? params.status : 'taken';
                    tr.TakenAt = params.takenAt !== undefined ? params.takenAt : new Date().toISOString();
                    return { recordset: [], rowsAffected: [1] };
                 }
                 return { recordset: [], rowsAffected: [0] };
              }
              
              if (s.includes('INSERT INTO MedicineTracking') && !s.includes('UPDATE MedicineTracking')) {
                 const medId = Number(params.medicineId);
                 const newTr = {
                    TrackingId: db.trackingIdCounter++,
                    MedicineId: medId,
                    ScheduledTime: params.scheduledTime,
                    ScheduledDate: params.scheduledDate !== undefined ? params.scheduledDate : new Date().toISOString(),
                    Status: params.status !== undefined ? params.status : 'taken',
                    TakenAt: params.takenAt !== undefined ? params.takenAt : new Date().toISOString(),
                 };
                 db.medicineTracking.push(newTr);
                 return { recordset: [{ TrackingId: newTr.TrackingId }], rowsAffected: [1] };
              }

              // ── Medicine with Tracking (LEFT JOIN) ──────────────────────
              if (s.includes('FROM Medicines m') && s.includes('LEFT JOIN MedicineTracking mt')) {
                const pId = Number(params.parentId);
                const meds = db.medicines.filter(m => m.ParentId === pId && m.IsActive === 1);
                
                // For a true LEFT JOIN, if a medicine has multiple trackings today, it should return multiple rows.
                // However, since medicineController parses all trackings, we can return all matching trackings.
                const results = [];
                meds.forEach(m => {
                  const trackings = db.medicineTracking.filter(t => t.MedicineId === m.MedicineId);
                  if (trackings.length === 0) {
                     results.push({
                       ...m,
                       ScheduledTimeString: m.Time,
                       TrackingId: null,
                       IsTaken: 0,
                       Status: null,
                       TakenAt: null,
                       ActualTime: null,
                     });
                  } else {
                     trackings.forEach(tr => {
                       results.push({
                         ...m,
                         ScheduledTimeString: m.Time,
                         TrackingId: tr.TrackingId,
                         IsTaken: tr.Status === 'taken' ? 1 : 0,
                         Status: tr.Status,
                         TakenAt: tr.TakenAt,
                         ActualTime: tr.ScheduledTime,
                       });
                     });
                  }
                });
                return { recordset: results };
              }

              // ── Medicine History (Dynamic Filter) ───────────────────────────
              if (s.includes('FROM MedicineTracking mt') && s.includes('JOIN Medicines m ON mt.MedicineId = m.MedicineId') && s.includes('DATEADD')) {
                const pId = Number(params.parentId);
                // 1. Get all medicines for this parent
                const parentMeds = db.medicines.filter(m => m.ParentId === pId);
                const parentMedIds = parentMeds.map(m => m.MedicineId);
                
                // 2. Determine date range from query string
                const targetDate = new Date();
                if (s.includes('DATEADD(day, -1')) {
                  targetDate.setDate(targetDate.getDate() - 1);
                } else if (s.includes('DATEADD(month, -1')) {
                  targetDate.setMonth(targetDate.getMonth() - 1);
                } else if (s.includes('DATEADD(year, -1')) {
                  targetDate.setFullYear(targetDate.getFullYear() - 1);
                } else {
                  targetDate.setDate(targetDate.getDate() - 7); // Default week
                }
                
                let historyTrackings = db.medicineTracking.filter(t => 
                  parentMedIds.includes(t.MedicineId) && 
                  new Date(t.ScheduledDate) >= targetDate
                );
                
                // Sort by date DESC, time DESC
                historyTrackings.sort((a, b) => {
                   const dateA = new Date(a.ScheduledDate);
                   const dateB = new Date(b.ScheduledDate);
                   if (dateB.getTime() !== dateA.getTime()) return dateB.getTime() - dateA.getTime();
                   return b.ScheduledTime.localeCompare(a.ScheduledTime);
                });
                
                const results = historyTrackings.map(t => {
                   const med = parentMeds.find(m => m.MedicineId === t.MedicineId);
                   return {
                     ScheduledDate: t.ScheduledDate,
                     ScheduledTime: t.ScheduledTime,
                     Status: t.Status,
                     Name: med.Name,
                     Dosage: med.Dosage,
                     Frequency: med.Frequency,
                   };
                });
                
                return { recordset: results };
              }

              // ── Check-Ins ──────────────────────────────────────────────
              if (s.includes('INSERT INTO CheckIns')) {
                db.checkIns = db.checkIns || [];
                db.checkIns.push({
                  ParentId: Number(params.parentId),
                  CheckInTime: new Date().toISOString()
                });
                return { recordset: [], rowsAffected: [1] };
              }

              if (s.includes('SELECT ParentId FROM CheckIns')) {
                db.checkIns = db.checkIns || [];
                const results = db.checkIns.filter(c => 
                  c.ParentId === Number(params.parentId) && 
                  new Date(c.CheckInTime).toDateString() === new Date().toDateString()
                );
                return { recordset: results };
              }

              // ── Alerts ───────────────────────────────────────────────
              if (s.includes('INSERT INTO Alerts')) {
                const newAlert = {
                  AlertId: db.alertIdCounter++,
                  ParentId: Number(params.parentId),
                  ChildId: Number(params.childId),
                  AlertType: params.alertType,
                  Title: params.title,
                  Message: params.message,
                  Severity: params.severity || 'medium',
                  IsRead: 0,
                  RelatedEntityId: params.relatedEntityId,
                  RelatedEntityType: params.relatedEntityType,
                  CreatedAt: new Date().toISOString(),
                };
                db.alerts.push(newAlert);
                console.log(`🗄️ Mock DB: Created Alert [${newAlert.AlertType}] for Parent(Recipient)=${newAlert.ParentId}`);
                return { recordset: [{ AlertId: newAlert.AlertId }] };
              }

              if (s.includes('SELECT') && s.includes('FROM Alerts') && s.includes('IsRead = 0')) {
                const pId = Number(params.parentId);
                const results = db.alerts
                  .filter(a => a.ParentId === pId && a.IsRead === 0)
                  .map(a => {
                     const c = db.users.find(u => u.UserId === a.ChildId);
                     return { ...a, ChildName: c ? c.Name : null, ChildEmail: c ? c.Email : null };
                  })
                  .sort((a,b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));
                return { recordset: results };
              }

              if (s.includes('SELECT') && s.includes('FROM Alerts') && !s.includes('UPDATE') && !s.includes('GROUP BY')) {
                const pId = Number(params.parentId);
                let results = db.alerts
                  .filter(a => a.ParentId === pId)
                  .map(a => {
                     const c = db.users.find(u => u.UserId === a.ChildId);
                     return { ...a, ChildName: c ? c.Name : null, ChildEmail: c ? c.Email : null };
                  })
                  .sort((a,b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));
                if (params.limit) {
                  results = results.slice(0, Number(params.limit));
                }
                return { recordset: results };
              }

              if (s.includes('SELECT') && s.includes('FROM Alerts') && s.includes('GROUP BY')) {
                return { recordset: [] }; // Mock empty stats
              }

              if (s.includes('UPDATE Alerts') && s.includes('IsRead = 1') && s.includes('AlertId = @alertId')) {
                const aId = Number(params.alertId);
                const alert = db.alerts.find(a => a.AlertId === aId);
                if (alert) {
                  alert.IsRead = 1;
                  alert.ReadAt = new Date().toISOString();
                }
                return { recordset: [], rowsAffected: [alert ? 1 : 0] };
              }
              
              if (s.includes('UPDATE Alerts') && s.includes('IsRead = 1') && !s.includes('AlertId = @alertId')) {
                const pId = Number(params.parentId);
                const unread = db.alerts.filter(a => a.ParentId === pId && a.IsRead === 0);
                unread.forEach(a => {
                  a.IsRead = 1;
                  a.ReadAt = new Date().toISOString();
                });
                return { recordset: [], rowsAffected: [unread.length] };
              }

              // ── BatteryLogs ───────────────────────────────────────────
              if (s.includes('INSERT INTO BatteryLogs')) {
                const newLog = {
                  LogId: db.logIdCounter++,
                  ParentUserId: params.parentUserId || params.childId,
                  BatteryPercentage: params.batteryPercentage || params.batteryLevel,
                  BatteryState: params.batteryState,
                  IsCharging: params.isCharging ? 1 : 0,
                  LoggedAt: new Date().toISOString(),
                };
                db.batteryLogs.push(newLog);
                return { recordset: [{ LogId: newLog.LogId }] };
              }

              if (s.includes('SELECT TOP 1') && s.includes('FROM BatteryLogs')) {
                const parentId = params.parentUserId || params.childId;
                const parentLogs = db.batteryLogs.filter(l => Number(l.ParentUserId) === Number(parentId));
                if (parentLogs.length === 0) {
                  return { recordset: [] };
                }
                const latest = parentLogs[parentLogs.length - 1]; // Since they are pushed sequentially
                return { recordset: [latest] };
              }

              if (s.includes('SELECT') && s.includes('FROM BatteryLogs')) {
                const parentId = params.parentUserId || params.childId;
                const parentLogs = db.batteryLogs.filter(l => Number(l.ParentUserId) === Number(parentId));
                return { recordset: parentLogs.reverse() };
              }

              // ── SOSEvents ────────────────────────────────────────────
              if (s.includes('INSERT INTO SOSEvents')) {
                const newSOS = {
                  SOSId: db.sosIdCounter++,
                  ParentId: Number(params.parentId),
                  ChildId: Number(params.childId),
                  Message: params.message,
                  Location: params.location,
                  Status: 'active',
                  CreatedAt: new Date().toISOString(),
                };
                db.sosEvents.push(newSOS);
                console.log(`🗄️ Mock DB: Created SOS Event for Parent=${newSOS.ParentId}`);
                return { recordset: [{ SOSId: newSOS.SOSId }] };
              }

              // Fallback: return empty recordset
              return { recordset: [], rowsAffected: [0] };
            },
            execute: async () => ({ recordset: [] }),
          };
          return req;
        },
        close: async () => { console.log('Mock database connection closed'); },
      };
      return pool;
    }

    // Connect to actual database
    pool = await mssql.connect(config);
    console.log('✅ Connected to SQL Server database');
    return pool;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
};

const closeConnection = async () => {
  try {
    if (pool) {
      await pool.close();
      pool = null;
      console.log('Database connection closed');
    }
  } catch (error) {
    console.error('Error closing database connection:', error.message);
  }
};

module.exports = {
  getConnection,
  closeConnection,
  mssql,
};

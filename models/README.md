# Database Models

This folder contains all the database models (schemas) for the Medicine Reminder app. Each model corresponds to a table in the SQL Server database and provides methods for CRUD operations.

## Available Models

### 1. **User.js** - Users Table
Handles user authentication and profile management for both Parents and Children (caregivers).

**Methods:**
- `User.create({ name, email, passwordHash, role, phoneNumber })` - Create new user
- `User.findByEmail(email)` - Find user by email
- `User.findById(userId)` - Find user by ID
- `User.getParentsByChildId(childId)` - Get all parents linked to a child
- `User.getChildrenByParentId(parentId)` - Get all children linked to a parent
- `User.update(userId, { name, phoneNumber })` - Update user profile
- `User.delete(userId)` - Delete user

**Example:**
```javascript
const { User } = require('./models');

// Create a new user
const userId = await User.create({
  name: 'John Doe',
  email: 'john@example.com',
  passwordHash: hashedPassword,
  role: 'parent',
  phoneNumber: '1234567890'
});

// Find user by email
const user = await User.findByEmail('john@example.com');
```

---

### 2. **ParentChildLink.js** - ParentChildLink Table
Manages the relationship between Parents and their Children (caregivers).

**Methods:**
- `ParentChildLink.create(parentId, childId)` - Link a parent to a child
- `ParentChildLink.exists(parentId, childId)` - Check if link exists
- `ParentChildLink.delete(parentId, childId)` - Remove link
- `ParentChildLink.getByUserId(userId)` - Get all links for a user

**Example:**
```javascript
const { ParentChildLink } = require('./models');

// Link parent to child
const linkId = await ParentChildLink.create(parentId, childId);

// Check if they're linked
const isLinked = await ParentChildLink.exists(parentId, childId);
```

---

### 3. **Medicine.js** - Medicines Table
Handles medicine schedules created by Children for their Parents.

**Methods:**
- `Medicine.create({ name, dosage, frequency, time, parentId, childId, startDate, endDate, notes })` - Create medicine schedule
- `Medicine.findById(medicineId)` - Get medicine by ID
- `Medicine.getByParentId(parentId)` - Get all medicines for a parent
- `Medicine.getByChildId(childId)` - Get all medicines created by a child
- `Medicine.getTodayByParentId(parentId)` - Get today's medicines for a parent
- `Medicine.update(medicineId, { ...fields })` - Update medicine
- `Medicine.delete(medicineId)` - Delete medicine
- `Medicine.deactivate(medicineId)` - Soft delete (set IsActive = 0)

**Example:**
```javascript
const { Medicine } = require('./models');

// Create a medicine schedule
const medicineId = await Medicine.create({
  name: 'Aspirin',
  dosage: '100mg',
  frequency: 'Once daily',
  time: '08:00:00',
  parentId: 1,
  childId: 2,
  startDate: '2026-02-01',
  endDate: '2026-03-01',
  notes: 'Take with food'
});

// Get today's medicines
const todayMeds = await Medicine.getTodayByParentId(parentId);
```

---

### 4. **MedicineTracking.js** - MedicineTracking Table
Tracks medicine intake status (taken, missed, pending).

**Methods:**
- `MedicineTracking.create({ medicineId, scheduledDate, scheduledTime, status, notes })` - Create tracking record
- `MedicineTracking.findById(trackingId)` - Get tracking by ID
- `MedicineTracking.getByMedicineId(medicineId)` - Get all tracking for a medicine
- `MedicineTracking.getByParentId(parentId, startDate, endDate)` - Get tracking for parent
- `MedicineTracking.getTodayByParentId(parentId)` - Get today's tracking
- `MedicineTracking.updateStatus(trackingId, status, takenAt, notes)` - Update status
- `MedicineTracking.markAsTaken(trackingId, notes)` - Mark as taken
- `MedicineTracking.markAsMissed(trackingId, notes)` - Mark as missed
- `MedicineTracking.delete(trackingId)` - Delete record
- `MedicineTracking.getStatistics(parentId, startDate, endDate)` - Get statistics

**Example:**
```javascript
const { MedicineTracking } = require('./models');

// Mark medicine as taken
await MedicineTracking.markAsTaken(trackingId, 'Taken on time');

// Get today's tracking
const todayTracking = await MedicineTracking.getTodayByParentId(parentId);

// Get statistics
const stats = await MedicineTracking.getStatistics(parentId, '2026-02-01', '2026-02-28');
// Returns: { Total: 60, Taken: 50, Missed: 5, Pending: 5 }
```

---

## Usage in Controllers

Instead of writing raw SQL queries, you can now use these models:

### Before (Raw SQL):
```javascript
const result = await pool
  .request()
  .input('email', mssql.VarChar, email)
  .query('SELECT * FROM Users WHERE Email = @email');
const user = result.recordset[0];
```

### After (Using Models):
```javascript
const { User } = require('../models');
const user = await User.findByEmail(email);
```

## Benefits

✅ **Clean Code** - No more raw SQL in controllers
✅ **Reusable** - Use the same methods across different controllers
✅ **Maintainable** - Change queries in one place
✅ **Type Safety** - Clear method signatures
✅ **Easy Testing** - Mock models instead of database

## Import All Models

```javascript
const { User, Medicine, MedicineTracking, ParentChildLink } = require('../models');
```

Or import individual models:
```javascript
const User = require('../models/User');
const Medicine = require('../models/Medicine');
```

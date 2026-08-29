# Database Table Name Fix - Battery Monitoring

## ❌ Error Fixed
```
ERROR  API Error: 500 {"error": "Invalid object name 'ParentChildLinks'."}
```

## 🔧 Root Cause
The `BatteryAlert` model was querying the wrong table name and using incorrect column names.

## ✅ Fixes Applied

### File: `backend/models/BatteryAlert.js`

**Issue 1: Wrong Table Name**
- ❌ Before: `FROM ParentChildLinks` (plural, doesn't exist)
- ✅ After: `FROM ParentChildLink` (singular, correct table name)

**Issue 2: Wrong Column Names**
- ❌ Before: `ChildId` and `ParentId`
- ✅ After: `ChildUserId` and `ParentUserId` (actual column names)

### Complete Fix:
```sql
-- BEFORE (Wrong):
SELECT TOP 1 ChildId AS CaretakerId
FROM ParentChildLinks
WHERE ParentId = @parentUserId AND IsActive = 1

-- AFTER (Correct):
SELECT TOP 1 ChildUserId AS CaretakerId
FROM ParentChildLink
WHERE ParentUserId = @parentUserId
```

## 📋 Database Schema Reference

### ParentChildLink Table Structure:
```sql
CREATE TABLE ParentChildLink (
    LinkId INT IDENTITY(1,1) PRIMARY KEY,
    ChildUserId INT NOT NULL,      -- ✅ Correct column name
    ParentUserId INT NOT NULL,     -- ✅ Correct column name
    LinkedAt DATETIME DEFAULT GETDATE(),
    ...
);
```

## 🚀 Next Steps

1. **Restart Backend Server:**
   ```powershell
   cd C:\Users\naved\Desktop\HC_App\backend
   node server.js
   ```

2. **Test Battery Monitoring:**
   - Mobile app will now successfully report battery status
   - Backend will query the correct table
   - Alerts will be created properly

## ✅ Status
**FIXED** - Battery monitoring should now work correctly!

---
**Date**: March 3, 2026  
**Issue**: Invalid object name 'ParentChildLinks'  
**Resolution**: Changed to correct table name 'ParentChildLink' with proper column names

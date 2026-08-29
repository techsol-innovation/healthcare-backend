# Debugging Guide - Heartbeat Error

## 🔍 How to Debug the Error

### Step 1: Check Backend Logs

Restart the backend server with:
```bash
cd C:\Users\naved\Desktop\HC_App\backend
node server.js
```

### Step 2: Login as Caregiver

On mobile app, login with caregiver credentials.

### Step 3: Watch for These Console Logs

The backend will now show detailed logs:

```
📝 Heartbeat request: {
  childUserId: 5,
  role: 'child',
  deviceInfo: 'string',  ← Should be 'string'
  batteryLevel: 100,     ← Should be a number
  isCharging: false      ← Should be boolean
}

🔍 Heartbeat.record params: { 
  childId: 5, 
  deviceInfoType: 'string',
  deviceInfoLength: 52,
  batteryLevel: 100 
}

✅ Heartbeat recorded: 123

🔍 BatteryLog.log params: { 
  childId: 5, 
  batteryLevel: 100, 
  isCharging: 0,
  batteryState: 'unplugged' 
}

✅ Battery logged for child: 5
```

### Step 4: If You See Errors

**Error: "Cannot read property 'toString' of undefined"**

This means one of these is undefined:
- `childId` (should be from `req.user.userId`)
- `deviceInfo` (should be from `req.body.deviceInfo`)
- `batteryLevel` (should be from `req.body.batteryLevel`)

Look for which parameter shows as `undefined` in the logs.

### Step 5: Check Mobile App Payload

The mobile app should be sending:
```javascript
{
  deviceInfo: '{"deviceModel":"iPhone","osVersion":"17.0","appVersion":"1.0.0"}',
  batteryLevel: 100,
  isCharging: false
}
```

### Step 6: Common Issues

**Issue 1**: `childUserId` is undefined
- **Cause**: JWT token not decoded properly
- **Fix**: Check `req.user.userId` exists
- **Look for**: `📝 Heartbeat request: { childUserId: undefined }`

**Issue 2**: `deviceInfo` is not a string
- **Cause**: Mobile app sending object instead of string
- **Fix**: Mobile app should send `JSON.stringify(deviceInfo)`
- **Look for**: `deviceInfoType: 'object'` instead of `'string'`

**Issue 3**: `batteryLevel` is undefined
- **Cause**: Mobile app not sending batteryLevel
- **Fix**: Mobile app should always send a number
- **Look for**: `batteryLevel: undefined`

## 🧪 Manual Test

You can test the heartbeat endpoint with curl:

```bash
# Get JWT token first by logging in
TOKEN="your_jwt_token_here"

# Test heartbeat
curl -X POST http://localhost:3000/api/heartbeat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"deviceInfo\":\"{\\\"deviceModel\\\":\\\"Test\\\",\\\"osVersion\\\":\\\"1.0\\\"}\",\"batteryLevel\":100,\"isCharging\":false}"
```

## 📋 Checklist

- [ ] Backend server running
- [ ] Detailed logs enabled (✅ already added)
- [ ] Login as caregiver
- [ ] Check console for `📝 Heartbeat request` log
- [ ] Check if `childUserId` is a number
- [ ] Check if `deviceInfo` is a string
- [ ] Check if `batteryLevel` is a number
- [ ] Note any `undefined` values
- [ ] Check if error occurs in Heartbeat.record or BatteryLog.log

## 🎯 Next Steps Based on Logs

### If childUserId is undefined:
```
Problem: JWT token issue
Solution: Check auth middleware and JWT creation
```

### If deviceInfo is object:
```
Problem: Mobile app sending object
Solution: Update heartbeatService.js to JSON.stringify()
```

### If batteryLevel is undefined:
```
Problem: Mobile app not sending value
Solution: Add default value in heartbeatService.js
```

### If all values look correct but still error:
```
Problem: Database column type mismatch
Solution: Check Heartbeats table structure
```

---

**Please share the console logs after login to help identify the exact issue!**

# OTP Setup (Provider Based)

This project supports professional phone-based OTP authentication with multiple providers.

## Supported OTP Providers

- `mock` (default): no external SMS provider, logs OTP to backend console
- `twilio`: real SMS delivery via Twilio
- `custom`: your own SMS gateway endpoint

---

## 1) Install dependency

```bash
npm install twilio
```

## 2) Add environment variables

Create/update your backend `.env` file:

```env
# OTP Provider Configuration
OTP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+12345678900
OTP_DEFAULT_COUNTRY_CODE=+91

# OTP Behavior Configuration
OTP_EXPIRY_MINUTES=10
OTP_LENGTH=6
MAX_OTP_ATTEMPTS=3
OTP_RATE_LIMIT_MINUTES=1
MAX_OTP_REQUESTS_PER_HOUR=5
```

### Provider-specific notes:

- `TWILIO_PHONE_NUMBER` must be a Twilio SMS-enabled number
- `OTP_DEFAULT_COUNTRY_CODE` is used when user enters local numbers without `+` prefix

### Use your own SMS gateway (custom provider)

If you want to manage delivery through your own code/API, set:

```env
OTP_PROVIDER=custom
OTP_CUSTOM_SMS_URL=https://your-sms-gateway.example.com/send
OTP_CUSTOM_SMS_METHOD=POST
OTP_CUSTOM_SMS_AUTH_HEADER=Authorization
OTP_CUSTOM_SMS_AUTH_TOKEN=Bearer your_gateway_token
OTP_DEFAULT_COUNTRY_CODE=+91
```

Your endpoint will receive this JSON payload from backend:

```json
{
  "to": "+919876543210",
  "message": "Your HealthTakeCare login code is 123456. It expires in 10 minutes.",
  "otpCode": "123456",
  "purpose": "login"
}
```

Your endpoint should return HTTP 2xx for success.

### Local development without Twilio

Use:

```env
OTP_PROVIDER=mock
OTP_DEFAULT_COUNTRY_CODE=+91
```

In this mode, OTP is printed in backend logs as:

`[MOCK_OTP] phone=... otp=...`

---

## 3) Restart backend

```bash
npm run dev
```

---

## Phone-Based OTP Authentication API

### Flow Overview

1. **User enters phone number** → App calls `POST /api/auth/send-otp`
2. **System sends OTP** via SMS to the phone number
3. **User enters OTP** → App calls `POST /api/auth/verify-otp`
4. **System verifies OTP** and returns JWT token (auto-registers new users)

### API Endpoints

#### Send OTP

```http
POST /api/auth/send-otp
Content-Type: application/json

{
  "phoneNumber": "+919876543210",
  "purpose": "login"  // optional: "login" | "register" | "reset_password"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP sent successfully to 91****3210",
  "data": {
    "phoneNumber": "91****3210",
    "expiresIn": 600,
    "isNewUser": false,
    "purpose": "login"
  }
}
```

**Rate Limited Response (429):**
```json
{
  "success": false,
  "message": "Please wait 45 seconds before requesting a new OTP",
  "retryAfter": 45
}
```

#### Verify OTP & Login/Register

```http
POST /api/auth/verify-otp
Content-Type: application/json

{
  "phoneNumber": "+919876543210",
  "otpCode": "123456",
  "name": "John Doe",      // Required only for new users
  "role": "parent"         // Optional: "parent" (default) | "child"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "userId": 123,
    "name": "John Doe",
    "email": "user_919876543210_xxx@phone.local",
    "role": "parent",
    "phoneNumber": "919876543210",
    "isNewUser": false,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Invalid OTP Response (400):**
```json
{
  "success": false,
  "message": "Invalid OTP. 2 attempt(s) remaining.",
  "remainingAttempts": 2
}
```

#### Resend OTP

```http
POST /api/auth/resend-otp
Content-Type: application/json

{
  "phoneNumber": "+919876543210"
}
```

---

## Security Features

### Rate Limiting
- **Minimum wait between OTPs:** 1 minute (configurable via `OTP_RATE_LIMIT_MINUTES`)
- **Maximum OTPs per hour:** 5 (configurable via `MAX_OTP_REQUESTS_PER_HOUR`)

### OTP Security
- **Secure generation:** Uses `crypto.randomBytes()` for cryptographically secure OTPs
- **Expiry:** 10 minutes (configurable via `OTP_EXPIRY_MINUTES`)
- **Max attempts:** 3 (configurable via `MAX_OTP_ATTEMPTS`)
- **Single use:** OTP is invalidated after successful verification or max attempts
- **Previous OTPs invalidated:** When a new OTP is requested, all previous ones are marked as used

### Logging & Audit
- IP address and User-Agent are logged with each OTP request
- All OTP attempts are tracked in the database

---

## Database Setup

Run the SQL script to create the AuthOtp table:

```sql
-- Run in your SQL Server
-- File: database/CREATE_AUTH_OTP_TABLE.sql
```

Or the table is auto-created when the first OTP request is made.

---

## Parent-Child Linking OTP (Separate Flow)

This is a separate OTP flow for linking parents to caregivers:

- `POST /api/users/invite-parent` with `{ parentPhoneNumber }`
- `POST /api/users/verify-parent-otp` with `{ parentPhoneNumber, otpCode }`

---

## Troubleshooting

### OTP not received
1. Check `OTP_PROVIDER` is correctly set
2. For Twilio: verify account SID, auth token, and phone number are valid
3. Check backend logs for `[MOCK_OTP]` if using mock provider
4. Ensure phone number includes country code

### Rate limit errors
- Wait for the specified `retryAfter` seconds
- For testing, you can adjust `OTP_RATE_LIMIT_MINUTES` and `MAX_OTP_REQUESTS_PER_HOUR`

### Database errors
- Ensure SQL Server is running
- Check database connection in `.env`
- Run `database/CREATE_AUTH_OTP_TABLE.sql` manually if auto-creation fails

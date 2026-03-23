# User Verification System

## Overview

The verification system provides multiple ways to verify user identity:

| Method | Badge Awarded | Description |
|--------|---------------|-------------|
| Email | No (pending phone too) | 6-digit code sent to email |
| Phone | No (pending email too) | 6-digit code sent to phone |
| Photo | Yes ✓ | Selfie verification (admin approved) |
| Identity | Yes ✓ | Government ID (admin approved) |

**Verified Badge**: Awarded when user completes **email + phone** OR **photo** verification.

## Database Schema

```sql
-- verifications table
id          UUID (primary key)
user_id     UUID (references users)
type        VARCHAR: 'email', 'phone', 'photo', 'identity'
status      VARCHAR: 'pending', 'approved', 'rejected'
code        VARCHAR (verification code)
expires_at  TIMESTAMP
verified_at TIMESTAMP
metadata    JSONB (extra data like photo base64)
created_at  TIMESTAMP
```

## API Endpoints

```bash
# Send verification code
POST /api/verification/send-code
Body: { "type": "email" | "phone" | "photo" }

# Verify with code
POST /api/verification/verify
Body: { "type": "email" | "phone", "code": "123456" }

# Get verification status
GET /api/verification/status

# Submit photo verification
POST /api/verification/photo/submit
Body: { "photo": "base64_image_data" }

# Admin: Approve photo verification
POST /api/verification/photo/approve/:userId

# Admin: Reject photo verification
POST /api/verification/photo/reject/:userId
Body: { "reason": "Photo unclear" }
```

## Verification Flow

### 1. Email/Phone Verification
```
1. User clicks "Send Code" → API sends 6-digit code
2. Code stored in memory + DB (expires in 10 min)
3. User enters code → API validates
4. If valid → Update status to 'approved'
5. If both email & phone verified → Award badge
```

### 2. Photo Verification
```
1. User clicks "Verify with Photo" → Initiates
2. User submits base64 selfie → Stored in DB
3. Status = 'pending' → Admin review required
4. Admin approves → Status = 'approved', user gets badge
5. OR Admin rejects → Status = 'rejected', user retries
```

## Frontend Component

Use `VerificationFlow` component in the Profile page:

```tsx
import VerificationFlow from './components/verification/VerificationFlow';

// In Profile component
<VerificationFlow onVerified={() => refreshUser()} />
```

## Badge Display

Users with `is_verified = true` get:
- Blue checkmark badge on profile
- Boosted in ML recommendations
- Trust indicators in chat

## Security

- Codes expire after 10 minutes (email/phone)
- Rate limiting: max 5 requests per minute
- Photo verification requires admin approval
- Codes are one-time use only
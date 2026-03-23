# Face Verification System

## Overview

Uses **face-api.js** (TensorFlow.js) to compare a user's selfie with their profile photos to verify identity.

## How It Works

```
1. User takes a selfie or uploads photo
2. ML model detects face and extracts 128-point descriptor
3. Compares with face descriptors from profile images
4. If confidence >= 55% → Auto-approved
5. If < 55% → Pending admin review
```

## Algorithm

- **Face Detection**: TinyFaceDetector (lightweight, fast)
- **Face Landmarks**: 68-point facial landmarks
- **Face Recognition**: 128-dimensional face descriptor
- **Comparison**: Euclidean distance between descriptors
- **Confidence**: 1 - distance (0 to 1)

## Files

- `server/ml/faceVerification.ts` - ML service
- `src/components/verification/FaceVerification.tsx` - Frontend component

## API Endpoints

```bash
# Submit face verification
POST /api/face/photo/verify
Body: { "selfieBase64": "...", "confidence": 0.75 }

# Get pending verifications (admin)
GET /api/face/pending-photo-verifications

# Manual approve/reject (admin)
POST /api/face/photo/verify/manual/:userId
Body: { "approved": true } or { "approved": false, "reason": "..." }
```

## Models Required

Download face-api.js models to `public/models/`:
- tiny_face_detector_model-weights_manifest.json
- face_landmark_68_model-weights_manifest.json
- face_recognition_model-shard1

Models are automatically loaded from `/models` path.

## Frontend Usage

```tsx
import FaceVerification from './components/verification/FaceVerification';

<FaceVerification 
  profileImages={user.images}
  onVerified={(result) => console.log(result)}
/>
```

## Security

- Face data stored as reference only
- Minimum 55% confidence for auto-approval
- Admin review for lower confidence matches
- No biometric data stored permanently
# GlobalConnect Dating App

A production-ready dating application with real-time messaging, ML recommendations, and comprehensive security.

## Project Structure

```
globalconnect-dating/
├── frontend/           # React + Vite frontend
│   ├── src/            # React components, hooks, services
│   ├── package.json    # Frontend dependencies
│   └── vite.config.ts # Vite config with API proxy
│
├── backend/            # Express + TypeScript backend
│   ├── server/        # API routes, services, middleware
│   ├── config/       # Nginx and deployment configs
│   ├── package.json   # Backend dependencies
│   └── tsconfig.json # TypeScript config
│
├── sql/               # Database schemas
├── android/           # Android app (Capacitor)
└── package.json       # Monorepo workspace config
```

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 6+

### Installation

```bash
# Install all dependencies
npm run install:all

# Or install individually
cd frontend && npm install
cd ../backend && npm install
```

### Development

```bash
# Run both frontend and backend
npm run dev:all

# Or run separately
npm run dev          # Frontend on http://localhost:3000
npm run dev:backend  # Backend on http://localhost:3001
```

### Production Build

```bash
# Build frontend
npm run build

# Build backend
npm run build:backend
```

## Environment Variables

### Backend (.env)
```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=datingapp
DB_USER=postgres
DB_PASSWORD=your_password

# JWT
JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# External Services
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
SENDGRID_API_KEY=...
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
```

## API Endpoints

| Service | Endpoint |
|---------|----------|
| Auth | `/api/auth/*` |
| Users | `/api/users/*` |
| Swipes | `/api/swipe/*` |
| Messages | `/api/messages/*` |
| Matches | `/api/likes/*` |
| Subscriptions | `/api/subscription/*` |
| Ads | `/api/ads/*` |
| Moderation | `/api/moderation/*` |

## Features

- JWT Authentication with refresh tokens
- Real-time WebSocket messaging
- ML-based recommendations
- Face verification
- Content moderation
- Fraud detection
- Rate limiting
- End-to-end encryption

## Tech Stack

**Frontend:**
- React 19
- Vite 6
- TypeScript
- Tailwind CSS

**Backend:**
- Express.js
- TypeScript
- PostgreSQL
- Redis
- WebSocket

## License

Private - All rights reserved

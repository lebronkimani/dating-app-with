# GlobalConnect Dating App - Setup Guide

## Prerequisites

### 1. Install PostgreSQL

**Windows:**
- Download from https://www.postgresql.org/download/windows/
- Or use: `choco install postgresql` (if you have Chocolatey)
- During installation, set password for postgres user

**macOS:**
- `brew install postgresql@16`
- `brew services start postgresql@16`

**Linux (Ubuntu/Debian):**
- `sudo apt update`
- `sudo apt install postgresql postgresql-contrib`
- `sudo systemctl start postgresql`

### 2. Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE datingapp;

# Exit psql
\q
```

### 3. Run Schema

```bash
# Run the schema script
psql -U postgres -d datingapp -f sql/schema.sql
```

### 4. Configure Environment

Copy `.env.example` to `.env` and update:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=datingapp
DB_USER=postgres
DB_PASSWORD=your_postgres_password
PORT=3001
```

### 5. Start the Server

```bash
# Install dependencies
npm install

# Start server
npm run server
```

## Performance Notes

The schema includes these optimizations for 5M+ records:

1. **UUID Primary Keys** - Distributed, no hot spots
2. **Partial Indexes** - Faster queries on filtered data
3. **Composite Indexes** - Optimized for common query patterns
4. **Array Columns** - Efficient storage for interests/languages
5. **Connection Pooling** - Handles high concurrency

### Recommended PostgreSQL Settings

Add to `postgresql.conf`:

```properties
# Memory
shared_buffers = 256MB          # 25% of RAM
effective_cache_size = 1GB       # 75% of RAM
work_mem = 16MB

# Logging
log_min_duration_statement = 1000

# Connection
max_connections = 100
```

## Seeding Test Data

```bash
# Seed 10,000 test users
npx tsx sql/seed.ts users 10000

# Seed 100,000 swipes
npx tsx sql/seed.ts swipes 100000

# Seed 5 million users (takes a while)
npx tsx sql/seed.ts users 5000000
```

## API Endpoints

Once running:
- Health: `GET http://localhost:3001/api/health`
- Register: `POST http://localhost:3001/api/auth/register`
- Login: `POST http://localhost:3001/api/auth/login`
- Discover: `GET http://localhost:3001/api/users/discover` (requires x-user-id header)
- Swipe: `POST http://localhost:3001/api/swipe`
- Matches: `GET http://localhost:3001/api/swipe/matches`
- Messages: `GET/POST http://localhost:3001/api/messages/:matchId`
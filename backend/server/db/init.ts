import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'datingapp',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: isProduction ? {
    rejectUnauthorized: true,
    ca: process.env.DB_SSL_CA,
    key: process.env.DB_SSL_KEY,
    cert: process.env.DB_SSL_CERT
  } : false
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        age INTEGER NOT NULL CHECK (age >= 18 AND age <= 120),
        location VARCHAR(255),
        bio TEXT,
        images TEXT[] DEFAULT '{}',
        is_verified BOOLEAN DEFAULT false,
        interests TEXT[] DEFAULT '{}',
        languages TEXT[] DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_age ON users(age);
      CREATE INDEX IF NOT EXISTS idx_users_location ON users(location);
      CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS swipes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        swiper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        swiped_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        direction VARCHAR(10) NOT NULL CHECK (direction IN ('left', 'right')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(swiper_id, swiped_id)
      );

      CREATE INDEX IF NOT EXISTS idx_swiper_id ON swipes(swiper_id);
      CREATE INDEX IF NOT EXISTS idx_swiped_id ON swipes(swiped_id);
      CREATE INDEX IF NOT EXISTS idx_swipes_swiper_swiped ON swipes(swiper_id, swiped_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user1_id, user2_id)
      );

      CREATE INDEX IF NOT EXISTS idx_matches_user1 ON matches(user1_id);
      CREATE INDEX IF NOT EXISTS idx_matches_user2 ON matches(user2_id);
      CREATE INDEX IF NOT EXISTS idx_matches_users ON matches(user1_id, user2_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_messages_match_id ON messages(match_id);
      CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
      CREATE INDEX IF NOT EXISTS idx_messages_match_created ON messages(match_id, created_at DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(blocker_id, blocked_id)
      );

      CREATE INDEX IF NOT idx_blocks_blocker ON blocks(blocker_id);
      CREATE INDEX IF NOT idx_blocks_blocked ON blocks(blocked_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reported_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category VARCHAR(50) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
      CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        min_age INTEGER DEFAULT 18,
        max_age INTEGER DEFAULT 50,
        max_distance INTEGER DEFAULT 100,
        gender_preference VARCHAR(20) DEFAULT 'all'
      );

      CREATE INDEX IF NOT EXISTS idx_preferences_user ON user_preferences(user_id);
    `);

    console.log('Database tables and indexes created successfully');
  } finally {
    client.release();
  }
}

export function getPool() {
  return pool;
}

export function generateId(): string {
  return crypto.randomUUID();
}

export default { initDb, getPool, generateId };
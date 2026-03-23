import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';

const { Pool } = pg;

const app = express();
const PORT = process.env.PORT || 3001;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'datingapp',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_secret_key';

app.use(cors());
app.use(express.json());

const authenticate = (req: any, res: any, next: any) => {
  const userId = req.headers['x-user-id'];
  if (userId) {
    req.userId = userId;
    return next();
  }
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const decoded: any = jwt.verify(auth.substring(7), JWT_SECRET);
      req.userId = decoded.userId;
    } catch {}
  }
  next();
};

// Auth
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, age, sex, location, bio } = req.body;
    if (!email || !password || !name || !age || !sex) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, age, gender, location, bio)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, name, age`,
      [email, hash, name, age, sex, location || null, bio || null]
    );
    const token = jwt.sign({ userId: result.rows[0].id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: result.rows[0], token });
  } catch (err: any) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.is_banned) {
      return res.status(403).json({ error: 'Account suspended' });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      user: { id: user.id, email: user.email, name: user.name, age: user.age },
      token
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Users
app.get('/api/users/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, name, age, gender, location, bio, images, interests, languages, is_verified, is_premium
       FROM users WHERE id = $1`,
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

app.put('/api/users/me', authenticate, async (req, res) => {
  try {
    const { name, bio, location, interests, languages, images } = req.body;
    await pool.query(
      `UPDATE users SET name = COALESCE($1, name), bio = COALESCE($2, bio), location = COALESCE($3, location),
       interests = COALESCE($4, interests), languages = COALESCE($5, languages), images = COALESCE($6, images)
       WHERE id = $7`,
      [name, bio, location, interests, languages, images, req.userId]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Swipe
app.post('/api/swipe', authenticate, async (req, res) => {
  try {
    const { targetUserId, direction } = req.body;
    if (!targetUserId || !direction) {
      return res.status(400).json({ error: 'Missing targetUserId or direction' });
    }
    await pool.query(
      `INSERT INTO swipes (swiper_id, swiped_id, direction) VALUES ($1, $2, $3)
       ON CONFLICT (swiper_id, swiped_id) DO UPDATE SET direction = $3`,
      [req.userId, targetUserId, direction]
    );
    
    // Check for match
    const otherSwipe = await pool.query(
      `SELECT direction FROM swipes WHERE swiper_id = $1 AND swiped_id = $2`,
      [targetUserId, req.userId]
    );
    
    let isMatch = false;
    if (otherSwipe.rows.length > 0) {
      if (direction === 'like' && otherSwipe.rows[0].direction === 'like') {
        await pool.query(
          `INSERT INTO matches (user1_id, user2_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [req.userId, targetUserId]
        );
        isMatch = true;
      }
    }
    
    res.json({ success: true, isMatch });
  } catch (err: any) {
    console.error('Swipe error:', err);
    res.status(500).json({ error: 'Failed to swipe' });
  }
});

// Discovery
app.get('/api/filters/discover', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, age, gender, location, bio, images, interests, is_verified
       FROM users WHERE id != $1 AND age >= 18 AND age <= 50
       LIMIT 20`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Likes You
app.get('/api/likes/likes-you', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.age, u.images FROM users u
       JOIN swipes s ON s.swiped_id = u.id
       WHERE s.swiper_id = $1 AND s.direction = 'like'
       ORDER BY s.created_at DESC LIMIT 20`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get likes' });
  }
});

// Matches
app.get('/api/likes/matches', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.id, m.created_at,
       CASE WHEN m.user1_id = $1 THEN m.user2_id ELSE m.user1_id END as other_user_id,
       u.name, u.images
       FROM matches m
       JOIN users u ON u.id = CASE WHEN m.user1_id = $1 THEN m.user2_id ELSE m.user1_id END
       WHERE m.user1_id = $1 OR m.user2_id = $1
       ORDER BY m.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get matches' });
  }
});

// Messages
app.get('/api/messages/:matchId', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, sender_id, text, read, created_at FROM messages
       WHERE match_id = $1 ORDER BY created_at ASC LIMIT 50`,
      [req.params.matchId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

app.post('/api/messages/:matchId', authenticate, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Missing message text' });
    }
    const result = await pool.query(
      `INSERT INTO messages (match_id, sender_id, text) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.matchId, req.userId, text]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Profile
app.get('/api/profile/:userId', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, age, gender, location, bio, images, interests, languages, is_verified
       FROM users WHERE id = $1`,
      [req.params.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

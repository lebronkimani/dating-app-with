import { Router, Request, Response } from 'express';
import { getPool, generateId } from '../db/init';
import { recommendationEngine } from '../ml/recommendations';
import { ResponseSanitizer } from '../services/responseSanitizer';

const router = Router();

router.get('/me', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pool = getPool();
  const result = await pool.query(
    `SELECT id, email, name, age, sex, location, bio, images, is_verified, 
            is_premium, premium_expires_at, interests, languages, latitude, longitude,
            created_at, updated_at, last_active, profile_complete,
            age_verified, phone_verified, email_verified, face_verified
     FROM users WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const user = ResponseSanitizer.filterUser(result.rows[0]);
  res.json(user);
});

router.put('/me', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { name, age, location, bio, images, interests, languages } = req.body;
  const pool = getPool();

  const result = await pool.query(
    `UPDATE users 
     SET name = $1, age = $2, location = $3, bio = $4, images = $5, interests = $6, languages = $7, updated_at = CURRENT_TIMESTAMP
     WHERE id = $8
     RETURNING *`,
    [name, age, location, bio, images, interests, languages, userId]
  );

  const user = result.rows[0];
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    age: user.age,
    location: user.location,
    bio: user.bio,
    images: user.images || [],
    isVerified: user.is_verified,
    interests: user.interests || [],
    languages: user.languages || []
  });
});

router.get('/discover', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pool = getPool();
  
  const prefsResult = await pool.query('SELECT * FROM user_preferences WHERE user_id = $1', [userId]);
  const minAge = prefsResult.rows[0]?.min_age || 18;
  const maxAge = prefsResult.rows[0]?.max_age || 50;

  const usersResult = await pool.query(
    `SELECT u.id, u.name, u.age, u.location, u.bio, u.images, u.is_verified, u.interests, u.languages
     FROM users u
     WHERE u.id != $1
       AND u.age >= $2 AND u.age <= $3
       AND u.id NOT IN (
         SELECT swiped_id FROM swipes WHERE swiper_id = $1
         UNION
         SELECT blocked_id FROM blocks WHERE blocker_id = $1
       )
     LIMIT 50`,
    [userId, minAge, maxAge]
  );

  const candidateIds = usersResult.rows.map((r: any) => r.id);
  const rankedIds = recommendationEngine.rankUsersForDiscovery(userId, candidateIds);
  
  const rankedUsersMap = new Map(usersResult.rows.map((u: any) => [u.id, u]));
  const rankedUsers = rankedIds.slice(0, 20).map((id: string) => {
    const u = rankedUsersMap.get(id);
    return {
      id: u.id,
      name: u.name,
      age: u.age,
      location: u.location || 'Unknown',
      distance: 'Distance unknown',
      bio: u.bio || '',
      images: u.images || [],
      isVerified: u.is_verified,
      interests: u.interests || [],
      languages: u.languages || []
    };
  });

  res.json(rankedUsers);
});

router.post('/block', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { blocked_user_id } = req.body;
  if (!blocked_user_id) {
    return res.status(400).json({ error: 'Missing blocked_user_id' });
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, blocked_user_id]
  );

  res.json({ success: true });
});

export default router;
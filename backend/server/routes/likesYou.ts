import { Router, Request, Response } from 'express';
import { getPool } from '../db/init';
import { locationService } from '../services/location';
import { recommendationEngine } from '../ml/recommendations';

const router = Router();

function isSunday(): boolean {
  return new Date().getDay() === 0;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

async function isUserPremium(pool: any, userId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT is_premium, premium_expires_at FROM users WHERE id = $1',
    [userId]
  );
  
  if (result.rows.length === 0) return false;
  
  const user = result.rows[0];
  return user.is_premium && (!user.premium_expires_at || new Date(user.premium_expires_at) > new Date());
}

router.get('/likes-you/count', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pool = getPool();
  
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM likes WHERE liked_id = $1 AND is_match = false`,
    [userId]
  );

  res.json({ likesCount: parseInt(result.rows[0].count) || 0 });
});

router.get('/likes-you', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pool = getPool();
  const premium = await isUserPremium(pool, userId);
  const userCoords = await locationService.getUserCoordinates(userId);

  const likesResult = await pool.query(
    `SELECT l.id, l.liker_id, l.created_at,
            u.name, u.age, u.sex, u.location, u.bio, u.images, u.is_verified, u.interests, u.languages, u.latitude, u.longitude
     FROM likes l
     JOIN users u ON l.liker_id = u.id
     WHERE l.liked_id = $1 AND l.is_match = false
     ORDER BY l.created_at DESC
     LIMIT 50`,
    [userId]
  );

  const candidates = [];
  for (const row of likesResult.rows) {
    const score = await recommendationEngine.predictMatchProbability(userId, row.liker_id);
    
    if (premium) {
      let distanceText = 'Unknown';
      if (userCoords && row.latitude && row.longitude) {
        const distanceKm = locationService.calculateDistance(
          userCoords,
          { latitude: parseFloat(row.latitude), longitude: parseFloat(row.longitude) }
        );
        distanceText = locationService.formatDistance(distanceKm);
      }

      candidates.push({
        id: row.liker_id,
        name: row.name,
        age: row.age,
        sex: row.sex,
        location: distanceText,
        bio: row.bio || '',
        images: row.images || [],
        isVerified: row.is_verified,
        interests: row.interests || [],
        languages: row.languages || [],
        blurred: false,
        matchProbability: Math.round(score * 100)
      });
    } else {
      candidates.push({
        id: row.liker_id,
        blurred: true,
        images: row.images && row.images.length > 0 ? [row.images[0]] : [],
        matchProbability: Math.round(score * 100)
      });
    }
  }

  candidates.sort((a, b) => (b.matchProbability || 50) - (a.matchProbability || 50));

  res.json({
    likesCount: likesResult.rows.length,
    isPremium: premium,
    canReveal: !premium && isSunday(),
    profiles: candidates
  });
});

router.post('/likes-you/reveal', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { liker_id } = req.body;
  if (!liker_id) {
    return res.status(400).json({ error: 'Missing liker_id' });
  }

  const pool = getPool();
  const premium = await isUserPremium(pool, userId);
  
  if (premium) {
    return res.status(400).json({ error: 'Premium users can see all profiles' });
  }

  if (!isSunday()) {
    return res.status(403).json({ 
      error: 'Reveal is only available on Sundays',
      isSunday: false
    });
  }

  const currentWeek = getWeekNumber(new Date());
  const currentYear = new Date().getFullYear();

  const existingReveal = await pool.query(
    `SELECT id FROM ad_reveals 
     WHERE user_id = $1 AND week_number = $2 AND year = $3`,
    [userId, currentWeek, currentYear]
  );

  if (existingReveal.rows.length > 0) {
    return res.status(403).json({ 
      error: 'You have already used your reveal this week',
      weekNumber: currentWeek
    });
  }

  const likeExists = await pool.query(
    `SELECT id FROM likes WHERE liker_id = $1 AND liked_id = $2`,
    [liker_id, userId]
  );

  if (likeExists.rows.length === 0) {
    return res.status(404).json({ error: 'Like not found' });
  }

  await pool.query(
    `INSERT INTO ad_reveals (user_id, revealed_liker_id, week_number, year)
     VALUES ($1, $2, $3, $4)`,
    [userId, liker_id, currentWeek, currentYear]
  );

  const userResult = await pool.query(
    `SELECT id, name, age, sex, location, bio, images, is_verified, interests, languages
     FROM users WHERE id = $1`,
    [liker_id]
  );

  const user = userResult.rows[0];
  const score = await recommendationEngine.predictMatchProbability(userId, liker_id);

  res.json({
    revealed: true,
    profile: {
      id: user.id,
      name: user.name,
      age: user.age,
      sex: user.sex,
      location: user.location || 'Unknown',
      bio: user.bio || '',
      images: user.images || [],
      isVerified: user.is_verified,
      interests: user.interests || [],
      languages: user.languages || [],
      blurred: false,
      matchProbability: Math.round(score * 100)
    }
  });
});

router.post('/likes-you/like-back', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { liker_id } = req.body;
  if (!liker_id) {
    return res.status(400).json({ error: 'Missing liker_id' });
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingLike = await client.query(
      `SELECT id FROM likes WHERE liker_id = $1 AND liked_id = $2`,
      [userId, liker_id]
    );

    if (existingLike.rows.length === 0) {
      await client.query(
        `INSERT INTO likes (liker_id, liked_id, is_match) VALUES ($1, $2, true)`,
        [userId, liker_id]
      );
    }

    const existingMatch = await client.query(
      `SELECT id FROM matches WHERE 
       (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`,
      [userId, liker_id]
    );

    let isMatch = false;
    if (existingMatch.rows.length === 0) {
      await client.query(
        `INSERT INTO matches (user1_id, user2_id) VALUES ($1, $2)`,
        [userId, liker_id]
      );
      isMatch = true;
    }

    await client.query(
      `UPDATE likes SET is_match = true WHERE 
       (liker_id = $1 AND liked_id = $2) OR (liker_id = $2 AND liked_id = $1)`,
      [userId, liker_id]
    );

    await client.query(
      `INSERT INTO swipes (swiper_id, swiped_id, direction) VALUES ($1, $2, 'right')
       ON CONFLICT (swiper_id, swiped_id) DO UPDATE SET direction = 'right'`,
      [userId, liker_id]
    );

    await client.query('COMMIT');

    res.json({ success: true, isMatch });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Like back error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.get('/likes-you/reveal-status', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pool = getPool();
  const premium = await isUserPremium(pool, userId);
  
  if (premium) {
    return res.json({
      canReveal: true,
      isPremium: true,
      isSunday: isSunday(),
      revealUsed: false
    });
  }

  const currentWeek = getWeekNumber(new Date());
  const currentYear = new Date().getFullYear();

  const existingReveal = await pool.query(
    `SELECT id FROM ad_reveals 
     WHERE user_id = $1 AND week_number = $2 AND year = $3`,
    [userId, currentWeek, currentYear]
  );

  res.json({
    canReveal: isSunday() && existingReveal.rows.length === 0,
    isPremium: false,
    isSunday: isSunday(),
    revealUsed: existingReveal.rows.length > 0
  });
});

export default router;

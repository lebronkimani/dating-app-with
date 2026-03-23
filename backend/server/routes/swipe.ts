import { Router, Request, Response } from 'express';
import { getPool, generateId } from '../db/init';
import { redisService } from '../services/redis';
import { recommendationEngine } from '../ml/recommendations';
import { eventQueue, Events } from '../services/eventQueue';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

const FREE_SWIPE_LIMIT = 100;
const SWIPE_RATE_WINDOW = 60;

function isSunday(): boolean {
  return new Date().getDay() === 0;
}

async function getUserPremiumStatus(pool: any, userId: string): Promise<{ isPremium: boolean; premiumExpiresAt: Date | null }> {
  const result = await pool.query(
    'SELECT is_premium, premium_expires_at FROM users WHERE id = $1',
    [userId]
  );
  
  if (result.rows.length === 0) {
    return { isPremium: false, premiumExpiresAt: null };
  }
  
  const user = result.rows[0];
  const isPremium = user.is_premium && 
    (!user.premium_expires_at || new Date(user.premium_expires_at) > new Date());
  
  return { isPremium, premiumExpiresAt: user.premium_expires_at };
}

async function checkSuperLikeEligibility(pool: any, userId: string, isPremium: boolean): Promise<{
  eligible: boolean;
  reason?: string;
  canWatchAd?: boolean;
}> {
  const userResult = await pool.query('SELECT is_premium, premium_expires_at FROM users WHERE id = $1', [userId]);
  const user = userResult.rows[0];
  const isUserPremium = user.is_premium && (!user.premium_expires_at || new Date(user.premium_expires_at) > new Date());

  if (isUserPremium) {
    const today = new Date().toISOString().split('T')[0];
    const result = await pool.query(
      `SELECT id FROM super_likes 
       WHERE sender_id = $1 AND created_at >= $2`,
      [userId, today]
    );
    
    if (result.rows.length > 0) {
      return { eligible: false, reason: 'Daily super like already used' };
    }
    return { eligible: true };
  }

  const creditResult = await pool.query(
    'SELECT credits, last_sunday FROM super_like_credits WHERE user_id = $1',
    [userId]
  );

  if (creditResult.rows.length > 0 && creditResult.rows[0].credits > 0) {
    return { eligible: true };
  }

  if (isSunday()) {
    return { eligible: true };
  }

  return { 
    eligible: false, 
    reason: 'Super likes are only available on Sundays for free users. Watch an ad to unlock one!',
    canWatchAd: true 
  };
}

router.post('/', rateLimit('swipe'), async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { swiped_user_id, direction } = req.body;
  
  if (!swiped_user_id || !direction) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (direction !== 'left' && direction !== 'right' && direction !== 'super') {
    return res.status(400).json({ error: 'Invalid direction' });
  }

  const hasSwipedAlready = await redisService.hasSwiped(userId, swiped_user_id);
  if (hasSwipedAlready) {
    return res.status(400).json({ error: 'Already swiped on this user' });
  }

  const pool = getPool();
  const { isPremium } = await getUserPremiumStatus(pool, userId);

  if (direction === 'super') {
    const eligibility = await checkSuperLikeEligibility(pool, userId, isPremium);
    if (!eligibility.eligible) {
      return res.status(403).json({ 
        error: eligibility.reason,
        canWatchAd: eligibility.canWatchAd
      });
    }
  }

  if (!isPremium) {
    const canSwipe = await redisService.checkRateLimit(userId, 'swipe', FREE_SWIPE_LIMIT, SWIPE_RATE_WINDOW);
    if (!canSwipe) {
      return res.status(429).json({ 
        error: 'Daily swipe limit reached. Upgrade to premium for unlimited swipes!',
        upgradeRequired: true,
        retryAfter: SWIPE_RATE_WINDOW
      });
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    
    await client.query(
      `INSERT INTO swipes (swiper_id, swiped_id, direction) VALUES ($1, $2, $3)
       ON CONFLICT (swiper_id, swiped_id) DO UPDATE SET direction = $3`,
      [userId, swiped_user_id, direction]
    );

    await redisService.setSwipeCooldown(userId, swiped_user_id);

    let isMatch = false;

    if (direction === 'super') {
      await client.query(
        `INSERT INTO super_likes (sender_id, target_id) VALUES ($1, $2)
         ON CONFLICT (sender_id, target_id) DO NOTHING`,
        [userId, swiped_user_id]
      );

      const existingMatch = await client.query(
        `SELECT id FROM matches WHERE 
         (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`,
        [userId, swiped_user_id]
      );

      if (existingMatch.rows.length === 0) {
        await client.query(
          `INSERT INTO matches (user1_id, user2_id) VALUES ($1, $2)`,
          [userId, swiped_user_id]
        );
        isMatch = true;
      }

      const userResult = await client.query(
        'SELECT is_premium, premium_expires_at FROM users WHERE id = $1',
        [userId]
      );
      const user = userResult.rows[0];
      const isUserPremium = user.is_premium && (!user.premium_expires_at || new Date(user.premium_expires_at) > new Date());

      if (!isUserPremium) {
        await client.query(
          `INSERT INTO super_like_credits (user_id, credits, last_sunday)
           VALUES ($1, 0, NULL)
           ON CONFLICT (user_id) DO UPDATE SET 
             credits = CASE WHEN super_like_credits.credits > 0 THEN super_like_credits.credits - 1 ELSE 0 END,
             updated_at = CURRENT_TIMESTAMP`,
          [userId]
        );
      }
    } else if (direction === 'right') {
      await client.query(
        `INSERT INTO likes (liker_id, liked_id, is_match) VALUES ($1, $2, false)
         ON CONFLICT (liker_id, liked_id) DO NOTHING`,
        [userId, swiped_user_id]
      );

      const theirSwipe = await client.query(
        `SELECT direction FROM swipes WHERE swiper_id = $1 AND swiped_id = $2 AND direction IN ('right', 'super')`,
        [swiped_user_id, userId]
      );

      if (theirSwipe.rows.length > 0) {
        const existingMatch = await client.query(
          `SELECT id FROM matches WHERE 
           (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`,
          [userId, swiped_user_id]
        );

        if (existingMatch.rows.length === 0) {
          await client.query(
            `INSERT INTO matches (user1_id, user2_id) VALUES ($1, $2)`,
            [userId, swiped_user_id]
          );
          isMatch = true;
        }

        await client.query(
          `UPDATE likes SET is_match = true WHERE 
           (liker_id = $1 AND liked_id = $2) OR (liker_id = $2 AND liked_id = $1)`,
          [userId, swiped_user_id]
        );
      }
    }

    await client.query('COMMIT');

    try {
      const action = direction === 'super' ? 'superlike' : direction;
      await recommendationEngine.updateEmbeddingFromSwipe(userId, swiped_user_id, action);
      
      await eventQueue.publish({
        type: Events.SWIPE_CREATED,
        userId,
        data: {
          swiperId: userId,
          swipedId: swiped_user_id,
          direction,
          isMatch
        }
      });
    } catch (error) {
      console.error('Embedding update error:', error);
    }

    res.json({ 
      success: true, 
      match: isMatch,
      direction
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Swipe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.get('/matches', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pool = getPool();

  const matchesResult = await pool.query(
    `SELECT m.id, m.created_at,
            CASE WHEN m.user1_id = $1 THEN m.user2_id ELSE m.user1_id END as other_user_id
     FROM matches m
     WHERE m.user1_id = $1 OR m.user2_id = $1
     ORDER BY m.created_at DESC`,
    [userId]
  );

  const result = await Promise.all(matchesResult.rows.map(async (match: any) => {
    const userResult = await pool.query(
      `SELECT id, name, age, location, bio, images, is_verified, interests, languages
       FROM users WHERE id = $1`,
      [match.other_user_id]
    );

    const user = userResult.rows[0];

    const lastMsgResult = await pool.query(
      `SELECT text, created_at FROM messages WHERE match_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [match.id]
    );

    const unreadResult = await pool.query(
      `SELECT COUNT(*) as count FROM messages WHERE match_id = $1 AND sender_id != $2 AND read = false`,
      [match.id, userId]
    );

    return {
      id: match.id,
      user: {
        id: user.id,
        name: user.name,
        age: user.age,
        location: user.location || 'Unknown',
        distance: 'Distance unknown',
        bio: user.bio || '',
        images: user.images || [],
        isVerified: user.is_verified,
        interests: user.interests || [],
        languages: user.languages || []
      },
      lastMessage: lastMsgResult.rows[0]?.text || null,
      timestamp: lastMsgResult.rows[0]?.created_at || null,
      unreadCount: parseInt(unreadResult.rows[0]?.count || '0')
    };
  }));

  res.json(result);
});

router.post('/report', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { reported_user_id, category, description } = req.body;

  if (!reported_user_id || !category) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO reports (reporter_id, reported_id, category, description)
     VALUES ($1, $2, $3, $4)`,
    [userId, reported_user_id, category, description || null]
  );

  res.json({ success: true });
});

router.post('/unlock-super-like', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pool = getPool();
  
  const userResult = await pool.query(
    'SELECT is_premium, premium_expires_at FROM users WHERE id = $1',
    [userId]
  );

  if (userResult.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const user = userResult.rows[0];
  const isPremium = user.is_premium && (!user.premium_expires_at || new Date(user.premium_expires_at) > new Date());

  if (isPremium) {
    return res.status(400).json({ error: 'Premium users do not need to watch ads for super likes' });
  }

  await pool.query(
    `INSERT INTO super_like_credits (user_id, credits, last_sunday)
     VALUES ($1, 1, NULL)
     ON CONFLICT (user_id) DO UPDATE SET 
       credits = super_like_credits.credits + 1,
       updated_at = CURRENT_TIMESTAMP`,
    [userId]
  );

  res.json({ 
    success: true, 
    message: 'Super like credit unlocked! Use it anytime.',
    credits: 1
  });
});

router.post('/upgrade-premium', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { durationDays = 30 } = req.body;
  const pool = getPool();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + durationDays);

  await pool.query(
    `INSERT INTO users (id, is_premium, premium_expires_at)
     VALUES ($1, true, $2)
     ON CONFLICT (id) DO UPDATE SET 
       is_premium = true,
       premium_expires_at = CASE 
         WHEN users.premium_expires_at > CURRENT_TIMESTAMP THEN users.premium_expires_at + INTERVAL '1 day' * $3
         ELSE $2
       END`,
    [userId, expiresAt, durationDays]
  );

  res.json({ 
    success: true, 
    message: 'Premium activated!',
    premiumExpiresAt: expiresAt
  });
});

router.get('/super-like-status', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pool = getPool();
  const { isPremium } = await getUserPremiumStatus(pool, userId);

  if (isPremium) {
    const today = new Date().toISOString().split('T')[0];
    const usedResult = await pool.query(
      `SELECT COUNT(*) as count FROM super_likes WHERE sender_id = $1 AND created_at >= $2`,
      [userId, today]
    );
    
    return res.json({
      isPremium: true,
      superLikeAvailable: parseInt(usedResult.rows[0].count) === 0,
      isSunday: isSunday(),
      canWatchAd: false
    });
  }

  const creditResult = await pool.query(
    'SELECT credits FROM super_like_credits WHERE user_id = $1',
    [userId]
  );

  const credits = creditResult.rows[0]?.credits || 0;

  return res.json({
    isPremium: false,
    superLikeAvailable: credits > 0 || isSunday(),
    isSunday: isSunday(),
    canWatchAd: true,
    credits
  });
});

export default router;
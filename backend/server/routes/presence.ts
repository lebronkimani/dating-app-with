import { Router, Request, Response } from 'express';
import { redisService } from '../services/redis';
import { wsService } from '../services/websocket';

const router = Router();

const requireAuth = (req: Request, res: Response, next: Function) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

router.post('/online', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await redisService.setUserOnline(userId);
    await redisService.updateLastSeen(userId);

    res.json({ success: true });
  } catch (error) {
    console.error('Set online error:', error);
    res.status(500).json({ error: 'Failed to update presence' });
  }
});

router.post('/offline', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await redisService.setUserOffline(userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Set offline error:', error);
    res.status(500).json({ error: 'Failed to update presence' });
  }
});

router.get('/status/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const currentUserId = req.headers['x-user-id'] as string;
    const { userId } = req.params;

    const pool = (await import('../db/init')).getPool();
    
    const matchCheck = await pool.query(
      `SELECT id FROM matches WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`,
      [currentUserId, userId]
    );

    if (matchCheck.rows.length === 0 && currentUserId !== userId) {
      return res.status(403).json({ error: 'Can only check status for matches or yourself' });
    }

    const wsOnline = wsService.isUserOnline(userId);
    const redisOnline = await redisService.isUserOnline(userId);
    const isOnline = wsOnline || redisOnline;
    
    const lastSeen = await redisService.getLastSeen(userId);

    res.json({
      online: isOnline,
      lastSeen: lastSeen
    });
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: 'Failed to get presence status' });
  }
});

router.get('/online/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const currentUserId = req.headers['x-user-id'] as string;
    const { userId } = req.params;

    if (currentUserId !== userId) {
      return res.status(403).json({ error: 'Can only check your own online status' });
    }

    const isOnline = wsService.isUserOnline(userId);
    res.json({ online: isOnline });
  } catch (error) {
    console.error('Online check error:', error);
    res.status(500).json({ error: 'Failed to check online status' });
  }
});

router.get('/who-online', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const pool = (await import('../db/init')).getPool();
    
    const result = await pool.query(
      `SELECT u.id, u.name, u.images 
       FROM users u 
       WHERE u.id IN (
         SELECT DISTINCT CASE 
           WHEN user1_id = $1 THEN user2_id 
           ELSE user1_id 
         END as other_user
         FROM matches 
         WHERE user1_id = $1 OR user2_id = $1
       )`,
      [userId]
    );

    const onlineWithStatus = await Promise.all(
      result.rows.map(async (user: any) => {
        const wsOnline = wsService.isUserOnline(user.id);
        const redisOnline = await redisService.isUserOnline(user.id);
        const isOnline = wsOnline || redisOnline;
        const lastSeen = await redisService.getLastSeen(user.id);
        return {
          id: user.id,
          name: user.name,
          images: user.images,
          online: isOnline,
          lastSeen: lastSeen
        };
      })
    );

    res.json({ users: onlineWithStatus });
  } catch (error) {
    console.error('Who online error:', error);
    res.status(500).json({ error: 'Failed to get online matches' });
  }
});

export default router;
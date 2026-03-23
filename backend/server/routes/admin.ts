import { Router, Request, Response } from 'express';
import { redisService } from '../services/redis';
import { rateLimitService } from '../services/rateLimit';
import { lockService } from '../services/lock';
import { shardingService } from '../services/sharding';
import { requireRole } from '../middleware/security';

const router = Router();

const requireAdmin = requireRole('admin');

router.use(requireAdmin);

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../db/init')).getPool();
    
    const [userCount, matchCount, messageCount, swipeCount, onlineCount] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM users'),
      pool.query('SELECT COUNT(*) as count FROM matches'),
      pool.query('SELECT COUNT(*) as count FROM messages'),
      pool.query('SELECT COUNT(*) as count FROM swipes'),
      redisService.getOnlineUsersCount()
    ]);

    res.json({
      users: parseInt(userCount.rows[0].count),
      matches: parseInt(matchCount.rows[0].count),
      messages: parseInt(messageCount.rows[0].count),
      swipes: parseInt(swipeCount.rows[0].count),
      onlineUsers: onlineCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

router.get('/performance', async (req: Request, res: Response) => {
  try {
    const start = Date.now();
    const pool = (await import('../db/init')).getPool();
    
    await pool.query('SELECT 1');
    
    const dbLatency = Date.now() - start;
    
    let redisLatency = 0;
    const redisStart = Date.now();
    try {
      await redisService.redis.ping();
      redisLatency = Date.now() - redisStart;
    } catch (e) {
      redisLatency = -1;
    }

    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    res.json({
      database: {
        latency: dbLatency,
        status: 'healthy'
      },
      redis: {
        latency: redisLatency,
        status: redisLatency > 0 ? 'healthy' : 'disconnected'
      },
      server: {
        uptime: process.uptime(),
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024)
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        }
      }
    });
  } catch (error) {
    console.error('Performance error:', error);
    res.status(500).json({ error: 'Failed to get performance data' });
  }
});

router.get('/rate-limits/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    const [swipe, message, superlike] = await Promise.all([
      rateLimitService.getRateLimitStatus(userId, 'swipe'),
      rateLimitService.getRateLimitStatus(userId, 'message'),
      rateLimitService.getRateLimitStatus(userId, 'superlike')
    ]);

    res.json({
      swipe,
      message,
      superlike
    });
  } catch (error) {
    console.error('Rate limits error:', error);
    res.status(500).json({ error: 'Failed to get rate limits' });
  }
});

router.get('/locks', async (req: Request, res: Response) => {
  try {
    const locks = await lockService.getActiveLocks();
    res.json({ locks, count: locks.length });
  } catch (error) {
    console.error('Locks error:', error);
    res.status(500).json({ error: 'Failed to get locks' });
  }
});

router.get('/shards', async (req: Request, res: Response) => {
  try {
    const shards = shardingService.getAllShards();
    const stats = await shardingService.getShardStats();
    
    res.json({
      shards,
      stats,
      shardCount: shards.length
    });
  } catch (error) {
    console.error('Shards error:', error);
    res.status(500).json({ error: 'Failed to get shard info' });
  }
});

router.get('/cache-stats', async (req: Request, res: Response) => {
  try {
    const info = await redisService.redis.info('stats');
    const memory = await redisService.redis.info('memory');
    
    res.json({
      info,
      memory,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cache stats error:', error);
    res.status(500).json({ error: 'Failed to get cache stats' });
  }
});

router.post('/clear-cache', async (req: Request, res: Response) => {
  try {
    const userRole = req.headers['x-user-role'] as string;
    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { pattern } = req.body;
    
    if (!pattern) {
      return res.status(400).json({ error: 'Pattern required' });
    }

    const sanitizedPattern = pattern.replace(/[^a-zA-Z0-9:_*-]/g, '');
    
    if (sanitizedPattern.length > 100) {
      return res.status(400).json({ error: 'Pattern too long' });
    }

    const keys = await redisService.redis.keys(sanitizedPattern);
    
    const dangerousPatterns = ['*', 'flushall', 'flushdb'];
    if (dangerousPatterns.includes(sanitizedPattern.toLowerCase())) {
      return res.status(400).json({ error: 'Dangerous pattern not allowed' });
    }
    
    if (keys.length > 1000) {
      return res.status(400).json({ error: 'Too many keys to delete' });
    }
    
    if (keys.length > 0) {
      await redisService.redis.del(...keys);
    }

    res.json({ success: true, deleted: keys.length });
  } catch (error) {
    console.error('Clear cache error:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

export default router;

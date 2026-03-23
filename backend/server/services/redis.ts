import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  lazyConnect: true,
  enableReadyCheck: false,
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

redis.on('connect', () => {
  console.log('Redis connected');
});

export async function initRedis() {
  try {
    await redis.connect();
    console.log('Redis initialized');
  } catch (e) {
    console.log('Redis not available, continuing without it');
  }
}

export class RedisService {
  
  // ============ RATE LIMITING ============
  
  async checkRateLimit(userId: string, action: string, limit: number, windowSeconds: number): Promise<boolean> {
    const key = `rate_limit:${userId}:${action}`;
    
    try {
      const current = await redis.incr(key);
      
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }
      
      return current <= limit;
    } catch (e) {
      console.error('Rate limit check failed:', e);
      return true;
    }
  }

  async getRateLimitRemaining(userId: string, action: string): Promise<number> {
    const key = `rate_limit:${userId}:${action}`;
    
    try {
      const current = await redis.get(key);
      return current ? parseInt(current) : 0;
    } catch (e) {
      return 0;
    }
  }

  async resetRateLimit(userId: string, action: string): Promise<void> {
    const key = `rate_limit:${userId}:${action}`;
    await redis.del(key);
  }

  // ============ ONLINE PRESENCE ============

  async setUserOnline(userId: string): Promise<void> {
    const key = `online:${userId}`;
    await redis.set(key, Date.now().toString(), 'EX', 300);
  }

  async setUserOffline(userId: string): Promise<void> {
    const key = `online:${userId}`;
    await redis.del(key);
  }

  async isUserOnline(userId: string): Promise<boolean> {
    const key = `online:${userId}`;
    const exists = await redis.exists(key);
    return exists === 1;
  }

  async getLastActive(userId: string): Promise<number | null> {
    const key = `online:${userId}`;
    const value = await redis.get(key);
    return value ? parseInt(value) : null;
  }

  async getOnlineUsers(): Promise<string[]> {
    const keys = await redis.keys('online:*');
    return keys.map(key => key.replace('online:', ''));
  }

  async updateLastSeen(userId: string): Promise<void> {
    const key = `last_seen:${userId}`;
    await redis.set(key, Date.now().toString(), 'EX', 86400);
  }

  async getLastSeen(userId: string): Promise<Date | null> {
    const key = `last_seen:${userId}`;
    const value = await redis.get(key);
    return value ? new Date(parseInt(value)) : null;
  }

  // ============ CACHING ============

  async cacheSet(key: string, value: any, ttlSeconds: number = 3600): Promise<void> {
    try {
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (e) {
      console.error('Cache set error:', e);
    }
  }

  async cacheGet<T>(key: string): Promise<T | null> {
    try {
      const value = await redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (e) {
      console.error('Cache get error:', e);
      return null;
    }
  }

  async cacheDelete(key: string): Promise<void> {
    await redis.del(key);
  }

  async cacheDeletePattern(pattern: string): Promise<void> {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  // ============ USER LOCATION CACHE ============

  async cacheUserLocation(userId: string, lat: number, lng: number): Promise<void> {
    const key = `location:${userId}`;
    await redis.set(key, `${lat},${lng}`, 'EX', 3600);
  }

  async getCachedUserLocation(userId: string): Promise<{ lat: number; lng: number } | null> {
    const key = `location:${userId}`;
    const value = await redis.get(key);
    
    if (!value) return null;
    
    const [lat, lng] = value.split(',').map(Number);
    return { lat, lng };
  }

  // ============ MATCH CACHE ============

  async cacheMatches(userId: string, matches: any[]): Promise<void> {
    const key = `matches:${userId}`;
    await redis.set(key, JSON.stringify(matches), 'EX', 300);
  }

  async getCachedMatches(userId: string): Promise<any[] | null> {
    const key = `matches:${userId}`;
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async invalidateMatches(userId: string): Promise<void> {
    await redis.del(`matches:${userId}`);
  }

  // ============ DISCOVERY CACHE ============

  async cacheDiscovery(userId: string, users: any[]): Promise<void> {
    const key = `discovery:${userId}`;
    await redis.set(key, JSON.stringify(users), 'EX', 600);
  }

  async getCachedDiscovery(userId: string): Promise<any[] | null> {
    const key = `discovery:${userId}`;
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async invalidateDiscovery(userId: string): Promise<void> {
    await redis.del(`discovery:${userId}`);
  }

  // ============ SWIPE COOLDOWN ============

  async setSwipeCooldown(userId: string, targetUserId: string): Promise<void> {
    const key = `cooldown:${userId}:${targetUserId}`;
    await redis.set(key, '1', 'EX', 86400);
  }

  async hasSwiped(userId: string, targetUserId: string): Promise<boolean> {
    const key = `cooldown:${userId}:${targetUserId}`;
    const exists = await redis.exists(key);
    return exists === 1;
  }

  // ============ ANALYTICS ============

  async incrementMetric(metric: string): Promise<void> {
    const key = `metrics:${metric}`;
    await redis.incr(key);
  }

  async getMetric(metric: string): Promise<number> {
    const key = `metrics:${metric}`;
    const value = await redis.get(key);
    return value ? parseInt(value) : 0;
  }
}

export const redisService = new RedisService();
export default redis;
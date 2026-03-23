import { redisService } from './redis';

interface RateLimitConfig {
  windowSeconds: number;
  maxRequests: number;
}

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  swipe: { windowSeconds: 60, maxRequests: 100 },
  message: { windowSeconds: 60, maxRequests: 50 },
  superlike: { windowSeconds: 86400, maxRequests: 10 },
  report: { windowSeconds: 3600, maxRequests: 10 },
  otp: { windowSeconds: 3600, maxRequests: 5 },
  login: { windowSeconds: 300, maxRequests: 10 },
};

export class RateLimitService {
  async checkRateLimit(userId: string, action: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
  }> {
    const config = DEFAULT_CONFIGS[action] || { windowSeconds: 60, maxRequests: 100 };
    const key = `ratelimit:${action}:${userId}`;
    
    const current = await redisService.get(key);
    const count = current ? parseInt(current) : 0;
    
    const ttl = await redisService.redis.ttl(key);
    const resetAt = ttl > 0 ? Date.now() + (ttl * 1000) : Date.now() + (config.windowSeconds * 1000);
    
    if (count >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt
      };
    }
    
    if (count === 0) {
      await redisService.set(key, '1', config.windowSeconds);
    } else {
      await redisService.redis.incr(key);
    }
    
    return {
      allowed: true,
      remaining: config.maxRequests - count - 1,
      resetAt: Date.now() + (config.windowSeconds * 1000)
    };
  }

  async getRateLimitStatus(userId: string, action: string): Promise<{
    limit: number;
    remaining: number;
    resetAt: number;
  }> {
    const config = DEFAULT_CONFIGS[action] || { windowSeconds: 60, maxRequests: 100 };
    const key = `ratelimit:${action}:${userId}`;
    
    const current = await redisService.get(key);
    const count = current ? parseInt(current) : 0;
    
    const ttl = await redisService.redis.ttl(key);
    const resetAt = ttl > 0 ? Date.now() + (ttl * 1000) : Date.now() + (config.windowSeconds * 1000);
    
    return {
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - count),
      resetAt
    };
  }

  async resetRateLimit(userId: string, action: string): Promise<void> {
    const key = `ratelimit:${action}:${userId}`;
    await redisService.redis.del(key);
  }

  async checkGlobalRateLimit(ip: string, action: string): Promise<{
    allowed: boolean;
    remaining: number;
  }> {
    const config = DEFAULT_CONFIGS[action] || { windowSeconds: 60, maxRequests: 100 };
    const globalLimit = config.maxRequests * 10;
    const key = `global:ratelimit:${action}:${ip}`;
    
    const current = await redisService.get(key);
    const count = current ? parseInt(current) : 0;
    
    if (count >= globalLimit) {
      return { allowed: false, remaining: 0 };
    }
    
    if (count === 0) {
      await redisService.set(key, '1', config.windowSeconds);
    } else {
      await redisService.redis.incr(key);
    }
    
    return {
      allowed: true,
      remaining: globalLimit - count - 1
    };
  }
}

export const rateLimitService = new RateLimitService();

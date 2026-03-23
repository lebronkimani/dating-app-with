import { redisService } from './redis';

export class CacheService {
  private readonly DEFAULT_TTL = 300;

  async cacheSwipe(userId: string, targetUserId: string, action: 'like' | 'dislike' | 'superlike'): Promise<void> {
    const key = `swipes:${userId}`;
    const timestamp = Date.now();
    
    await redisService.redis.zadd(key, timestamp, targetUserId);
    await redisService.redis.expire(key, 3600);
    
    const actionKey = `swipe:action:${userId}:${targetUserId}`;
    await redisService.set(actionKey, action, 3600);
  }

  async hasSwiped(userId: string, targetUserId: string): Promise<boolean> {
    const actionKey = `swipe:action:${userId}:${targetUserId}`;
    const action = await redisService.get(actionKey);
    return action !== null;
  }

  async getSwipeAction(userId: string, targetUserId: string): Promise<string | null> {
    const actionKey = `swipe:action:${userId}:${targetUserId}`;
    return await redisService.get(actionKey);
  }

  async cacheDiscoveryProfiles(userId: string, profiles: any[]): Promise<void> {
    const key = `discovery:${userId}`;
    await redisService.set(key, JSON.stringify(profiles), 300);
  }

  async getCachedDiscoveryProfiles(userId: string): Promise<any[] | null> {
    const key = `discovery:${userId}`;
    const data = await redisService.get(key);
    return data ? JSON.parse(data) : null;
  }

  async invalidateDiscoveryCache(userId: string): Promise<void> {
    const key = `discovery:${userId}`;
    await redisService.redis.del(key);
  }

  async cacheUserProfile(userId: string, profile: any): Promise<void> {
    const key = `profile:${userId}`;
    await redisService.set(key, JSON.stringify(profile), 600);
  }

  async getCachedUserProfile(userId: string): Promise<any | null> {
    const key = `profile:${userId}`;
    const data = await redisService.get(key);
    return data ? JSON.parse(data) : null;
  }

  async cacheMatch(userId: string, matchId: string, data: any): Promise<void> {
    const key = `match:${userId}:${matchId}`;
    await redisService.set(key, JSON.stringify(data), 3600);
  }

  async getCachedMatch(userId: string, matchId: string): Promise<any | null> {
    const key = `match:${userId}:${matchId}`;
    const data = await redisService.get(key);
    return data ? JSON.parse(data) : null;
  }

  async cacheMessages(matchId: string, messages: any[]): Promise<void> {
    const key = `messages:${matchId}`;
    await redisService.set(key, JSON.stringify(messages), 60);
  }

  async getCachedMessages(matchId: string): Promise<any[] | null> {
    const key = `messages:${matchId}`;
    const data = await redisService.get(key);
    return data ? JSON.parse(data) : null;
  }

  async invalidateMessages(matchId: string): Promise<void> {
    const key = `messages:${matchId}`;
    await redisService.redis.del(key);
  }

  async incrementLikeCount(userId: string): Promise<number> {
    const key = `likes:received:${userId}`;
    return await redisService.redis.incr(key);
  }

  async getLikeCount(userId: string): Promise<number> {
    const key = `likes:received:${userId}`;
    const count = await redisService.get(key);
    return count ? parseInt(count) : 0;
  }

  async cacheRecommendationScore(userId: string, targetUserId: string, score: number): Promise<void> {
    const key = `rec:score:${userId}`;
    await redisService.redis.zadd(key, score, targetUserId);
    await redisService.redis.expire(key, 3600);
  }

  async getRecommendationScores(userId: string, limit: number = 50): Promise<string[]> {
    const key = `rec:score:${userId}`;
    return await redisService.redis.zrevrange(key, 0, limit - 1);
  }
}

export const cacheService = new CacheService();

import { redisService } from './redis';

export class LockService {
  private readonly DEFAULT_TIMEOUT = 30000;
  private readonly DEFAULT_RETRY_DELAY = 50;
  private readonly DEFAULT_RETRY_COUNT = 10;

  async acquireLock(
    resourceId: string,
    ownerId: string,
    timeout: number = this.DEFAULT_TIMEOUT
  ): Promise<boolean> {
    const lockKey = `lock:${resourceId}`;
    
    const result = await redisService.redis.set(lockKey, ownerId, 'EX', Math.ceil(timeout / 1000), 'NX');
    return result === 'OK';
  }

  async releaseLock(resourceId: string, ownerId: string): Promise<boolean> {
    const lockKey = `lock:${resourceId}`;
    
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    
    const result = await redisService.redis.eval(script, 1, lockKey, ownerId);
    return result === 1;
  }

  async withLock<T>(
    resourceId: string,
    ownerId: string,
    callback: () => Promise<T>,
    timeout: number = this.DEFAULT_TIMEOUT
  ): Promise<T> {
    const acquired = await this.acquireLock(resourceId, ownerId, timeout);
    
    if (!acquired) {
      throw new Error(`Failed to acquire lock for resource: ${resourceId}`);
    }
    
    try {
      return await callback();
    } finally {
      await this.releaseLock(resourceId, ownerId);
    }
  }

  async acquireLockWithRetry(
    resourceId: string,
    ownerId: string,
    timeout: number = this.DEFAULT_TIMEOUT,
    retryCount: number = this.DEFAULT_RETRY_COUNT,
    retryDelay: number = this.DEFAULT_RETRY_DELAY
  ): Promise<boolean> {
    for (let i = 0; i < retryCount; i++) {
      const acquired = await this.acquireLock(resourceId, ownerId, timeout);
      if (acquired) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
    return false;
  }

  async extendLock(resourceId: string, ownerId: string, additionalTime: number): Promise<boolean> {
    const lockKey = `lock:${resourceId}`;
    
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("expire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;
    
    const result = await redisService.redis.eval(
      script,
      1,
      lockKey,
      ownerId,
      Math.ceil(additionalTime / 1000)
    );
    return result === 1;
  }

  async getLockInfo(resourceId: string): Promise<{ locked: boolean; ownerId?: string; ttl?: number }> {
    const lockKey = `lock:${resourceId}`;
    
    const [ownerId, ttl] = await Promise.all([
      redisService.redis.get(lockKey),
      redisService.redis.ttl(lockKey)
    ]);
    
    return {
      locked: ownerId !== null,
      ownerId: ownerId || undefined,
      ttl: ttl > 0 ? ttl : undefined
    };
  }

  async getActiveLocks(pattern: string = 'lock:*'): Promise<string[]> {
    const keys = await redisService.redis.keys(pattern);
    return keys;
  }
}

export const lockService = new LockService();

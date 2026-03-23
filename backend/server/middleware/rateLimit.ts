import { Request, Response, NextFunction } from 'express';
import { RateLimitService } from '../services/rateLimit';

export interface RateLimitRequest extends Request {
  rateLimit?: {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  };
}

const rateLimitService = new RateLimitService();

export const rateLimit = (action: string) => {
  return async (req: RateLimitRequest, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.headers['x-user-id'] as string || req.ip || 'anonymous';
    
    const result = await rateLimitService.checkRateLimit(userId, action);
    
    res.setHeader('X-RateLimit-Limit', result.remaining + (result.allowed ? 1 : 0));
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
    
    if (!result.allowed) {
      res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000)
      });
      return;
    }
    
    req.rateLimit = result;
    next();
  };
};

export const globalRateLimit = rateLimitService.checkRateLimit.bind(rateLimitService);

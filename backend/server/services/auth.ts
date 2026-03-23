import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getPool } from '../db/init';
import { redisService } from './redis';

interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

interface RefreshToken {
  token: string;
  userId: string;
  expiresAt: Date;
  rotatedAt?: Date;
}

export class AuthService {
  private readonly ACCESS_TOKEN_SECRET: string;
  private readonly REFRESH_TOKEN_SECRET: string;
  private readonly ACCESS_TOKEN_EXPIRY = '15m';
  private readonly REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000;

  constructor() {
    this.ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET || crypto.randomBytes(32).toString('hex');
    this.REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');
  }

  generateAccessToken(userId: string, email: string, role: string = 'user'): string {
    return jwt.sign(
      { userId, email, role },
      this.ACCESS_TOKEN_SECRET,
      { expiresIn: this.ACCESS_TOKEN_EXPIRY }
    );
  }

  generateRefreshToken(userId: string): RefreshToken {
    const token = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_EXPIRY);

    return { token, userId, expiresAt };
  }

  async storeRefreshToken(refreshToken: RefreshToken): Promise<void> {
    const key = `refresh:${refreshToken.token}`;
    await redisService.set(key, refreshToken.userId, 7 * 24 * 60 * 60);
  }

  async verifyAccessToken(token: string): Promise<TokenPayload | null> {
    try {
      return jwt.verify(token, this.ACCESS_TOKEN_SECRET) as TokenPayload;
    } catch (error) {
      return null;
    }
  }

  async verifyRefreshToken(token: string): Promise<string | null> {
    const userId = await redisService.get(`refresh:${token}`);
    return userId;
  }

  async rotateRefreshToken(oldToken: string, userId: string): Promise<RefreshToken | null> {
    const existingUserId = await this.verifyRefreshToken(oldToken);
    if (existingUserId !== userId) {
      return null;
    }

    await this.revokeRefreshToken(oldToken);
    return this.generateRefreshToken(userId);
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const key = `refresh:${token}`;
    await redisService.redis.del(key);
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    const pattern = `refresh:*`;
    const keys = await redisService.redis.keys(pattern);
    
    for (const key of keys) {
      const token = key.replace('refresh:', '');
      const tokenUserId = await redisService.get(key);
      if (tokenUserId === userId) {
        await redisService.redis.del(key);
      }
    }
  }

  async getActiveSessions(userId: string): Promise<number> {
    const pattern = `refresh:*`;
    const keys = await redisService.redis.keys(pattern);
    let count = 0;

    for (const key of keys) {
      const tokenUserId = await redisService.get(key);
      if (tokenUserId === userId) {
        count++;
      }
    }

    return count;
  }

  decodeToken(token: string): TokenPayload | null {
    try {
      return jwt.decode(token) as TokenPayload;
    } catch {
      return null;
    }
  }
}

export const authService = new AuthService();

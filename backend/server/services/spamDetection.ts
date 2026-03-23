import { getPool } from '../db/init';
import { redisService } from './redis';
import { moderationService } from './moderation';

interface SpamConfig {
  maxMessagesPerMinute: number;
  maxSwipesPerMinute: number;
  maxReportsBeforeFlag: number;
  linkPattern: RegExp;
}

const DEFAULT_SPAM_CONFIG: SpamConfig = {
  maxMessagesPerMinute: 20,
  maxSwipesPerMinute: 30,
  maxReportsBeforeFlag: 3,
  linkPattern: /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9]+\.com[^\s]*)/gi
};

export class SpamDetectionService {
  private config: SpamConfig;

  constructor(config: Partial<SpamConfig> = {}) {
    this.config = { ...DEFAULT_SPAM_CONFIG, ...config };
  }

  async checkMessageSpam(userId: string, message: string, recipientId: string): Promise<{ isSpam: boolean; reason?: string }> {
    const pool = getPool();

    const messagesCountKey = `spam:messages:${userId}`;
    const currentCount = await redisService.get(messagesCountKey);
    const messageCount = currentCount ? parseInt(currentCount) : 0;

    if (messageCount >= this.config.maxMessagesPerMinute) {
      await this.logSpamEvent(userId, 'message_rate_exceeded', messageCount, this.config.maxMessagesPerMinute);
      return { isSpam: true, reason: 'Too many messages per minute' };
    }

    await redisService.set(messagesCountKey, (messageCount + 1).toString(), 60);

    if (this.hasLinks(message)) {
      const userWarnings = await this.getUserSpamWarnings(userId);
      if (userWarnings > 2) {
        await this.logSpamEvent(userId, 'links_in_message', messageCount);
        await moderationService.handleViolation({
          userId,
          type: 'spam_links',
          severity: 'medium',
          source: 'spam_detection',
          description: 'User sent links in messages after warnings'
        });
        return { isSpam: true, reason: 'Links not allowed in messages' };
      }
    }

    if (this.isRepeatedMessage(userId, message, recipientId)) {
      await this.logSpamEvent(userId, 'repeated_message', 1);
      return { isSpam: true, reason: 'Repeated messages detected' };
    }

    return { isSpam: false };
  }

  async checkSwipeSpam(userId: string): Promise<{ isSpam: boolean; reason?: string }> {
    const swipesKey = `spam:swipes:${userId}`;
    const currentCount = await redisService.get(swipesKey);
    const swipeCount = currentCount ? parseInt(currentCount) : 0;

    if (swipeCount >= this.config.maxSwipesPerMinute) {
      await this.logSpamEvent(userId, 'swipe_rate_exceeded', swipeCount, this.config.maxSwipesPerMinute);
      return { isSpam: true, reason: 'Swiping too fast' };
    }

    await redisService.set(swipesKey, (swipeCount + 1).toString(), 60);

    return { isSpam: false };
  }

  async checkProfileSpam(userId: string): Promise<{ isSpam: boolean; reason?: string }> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT name, bio, images FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return { isSpam: true, reason: 'User not found' };
    }

    const profile = result.rows[0];

    if (profile.name && this.hasLinks(profile.name)) {
      return { isSpam: true, reason: 'Links in profile name' };
    }

    if (profile.bio && this.hasLinks(profile.bio)) {
      return { isSpam: true, reason: 'Links in bio' };
    }

    return { isSpam: false };
  }

  async checkReportSpam(reporterUserId: string, reportedUserId: string): Promise<void> {
    const pool = getPool();
    const reportsKey = `spam:reports:${reporterUserId}`;
    const currentCount = await redisService.get(reportsKey);
    const reportCount = currentCount ? parseInt(currentCount) : 0;

    if (reportCount >= this.config.maxReportsBeforeFlag) {
      await moderationService.handleViolation({
        userId: reporterUserId,
        type: 'excessive_reports',
        severity: 'medium',
        source: 'spam_detection',
        description: 'User submitted too many reports'
      });
    }

    await redisService.set(reportsKey, (reportCount + 1).toString(), 3600);
  }

  async checkMultipleAccounts(ipAddress: string): Promise<{ isSuspicious: boolean; accountCount: number }> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT COUNT(DISTINCT id) as count FROM users WHERE created_at > NOW() - INTERVAL '1 hour' AND ip_address = $1`,
      [ipAddress]
    );

    const count = parseInt(result.rows[0].count);
    return { isSuspicious: count > 3, accountCount: count };
  }

  private hasLinks(text: string): boolean {
    return this.config.linkPattern.test(text);
  }

  private async isRepeatedMessage(userId: string, message: string, recipientId: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT text FROM messages 
       WHERE sender_id = $1 AND match_id IN (
         SELECT id FROM matches WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
       )
       ORDER BY created_at DESC LIMIT 5`,
      [userId, recipientId]
    );

    const recentMessages = result.rows.map(r => r.text);
    const repeatCount = recentMessages.filter(m => m === message).length;
    return repeatCount >= 3;
  }

  private async getUserSpamWarnings(userId: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM violations 
       WHERE user_id = $1 AND type = 'spam_links' AND created_at > NOW() - INTERVAL '7 days'`,
      [userId]
    );
    return parseInt(result.rows[0].count);
  }

  private async logSpamEvent(userId: string, eventType: string, eventCount: number, threshold?: number): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO spam_logs (user_id, event_type, event_count, time_window_seconds, flagged)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, eventType, eventCount, threshold ? 60 : null, true]
    );
  }

  async getSpamLogs(userId: string, limit: number = 50): Promise<any[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM spam_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }
}

export const spamDetectionService = new SpamDetectionService();

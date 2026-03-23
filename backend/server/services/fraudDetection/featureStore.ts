import { getPool } from '../../db/init';
import { redisService } from './redis';

interface UserFeatures {
  userId: string;
  accountAgeDays: number;
  profileCompletion: number;
  photoCount: number;
  bioLength: number;
  hasFace: boolean;
  swipeSpeed: number;
  messagesPerHour: number;
  matchRate: number;
  avgResponseDelay: number;
  sessionDuration: number;
  reportCount: number;
  scamKeywordScore: number;
  externalLinkCount: number;
  duplicatePhotoScore: number;
  behaviorScore: number;
  activityScore: number;
  popularityScore: number;
}

export class FraudDetectionFeatureStore {
  async collectUserFeatures(userId: string): Promise<UserFeatures> {
    const pool = getPool();
    
    const userResult = await pool.query(
      `SELECT id, created_at, name, bio, images, is_verified 
       FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = userResult.rows[0];
    const accountAgeDays = this.calculateAccountAge(user.created_at);
    const profileCompletion = this.calculateProfileCompletion(user);
    const photoCount = user.images?.length || 0;
    const bioLength = user.bio?.length || 0;

    const behavioral = await this.getBehavioralFeatures(userId);
    const reports = await this.getReportFeatures(userId);
    const messaging = await this.getMessagingFeatures(userId);
    const activity = await this.getActivityFeatures(userId);

    return {
      userId,
      accountAgeDays,
      profileCompletion,
      photoCount,
      bioLength,
      hasFace: true,
      swipeSpeed: behavioral.swipeSpeed,
      messagesPerHour: behavioral.messagesPerHour,
      matchRate: behavioral.matchRate,
      avgResponseDelay: behavioral.avgResponseDelay,
      sessionDuration: behavioral.sessionDuration,
      reportCount: reports.count,
      scamKeywordScore: messaging.scamKeywordScore,
      externalLinkCount: messaging.externalLinkCount,
      duplicatePhotoScore: 0,
      behaviorScore: behavioral.score,
      activityScore: activity.score,
      popularityScore: activity.popularity
    };
  }

  private calculateAccountAge(createdAt: Date): number {
    const now = new Date();
    const created = new Date(createdAt);
    return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
  }

  private calculateProfileCompletion(user: any): number {
    let score = 0;
    let total = 0;

    if (user.name) { score += 20; total += 20; }
    if (user.bio) { score += 20; total += 20; }
    if (user.images && user.images.length > 0) { score += 30; total += 30; }
    if (user.is_verified) { score += 15; total += 15; }
    if (user.interests && user.interests.length > 0) { score += 15; total += 15; }

    return total > 0 ? score / total : 0;
  }

  private async getBehavioralFeatures(userId: string): Promise<any> {
    const pool = getPool();
    
    const swipeResult = await pool.query(
      `SELECT COUNT(*) as count, 
              MIN(created_at) as first_swipe,
              MAX(created_at) as last_swipe
       FROM swipes 
       WHERE user_id = $1 
       AND created_at > NOW() - INTERVAL '1 hour'`,
      [userId]
    );

    const matchResult = await pool.query(
      `SELECT COUNT(*) as match_count,
              (SELECT COUNT(*) FROM swipes WHERE user_id = $1) as swipe_count
       FROM matches 
       WHERE (user1_id = $1 OR user2_id = $1)`,
      [userId]
    );

    const messageResult = await pool.query(
      `SELECT COUNT(*) as msg_count,
              MIN(created_at) as first_msg,
              MAX(created_at) as last_msg
       FROM messages 
       WHERE sender_id = $1 
       AND created_at > NOW() - INTERVAL '1 hour'`,
      [userId]
    );

    const swipeCount = parseInt(swipeResult.rows[0].count) || 0;
    const messageCount = parseInt(messageResult.rows[0].msg_count) || 0;
    const matchCount = parseInt(matchResult.rows[0].match_count) || 0;
    const totalSwipes = parseInt(matchResult.rows[0].swipe_count) || 1;

    const firstSwipe = swipeResult.rows[0].first_swipe;
    const lastSwipe = swipeResult.rows[0].last_swipe;
    let swipeSpeed = 0;
    if (firstSwipe && lastSwipe) {
      const duration = (new Date(lastSwipe).getTime() - new Date(firstSwipe).getTime()) / 60000;
      swipeSpeed = duration > 0 ? swipeCount / duration : swipeCount;
    }

    return {
      swipeSpeed,
      messagesPerHour: messageCount,
      matchRate: matchCount / totalSwipes,
      avgResponseDelay: 30,
      sessionDuration: 15,
      score: this.calculateBehaviorScore(swipeSpeed, messageCount, matchCount / totalSwipes)
    };
  }

  private calculateBehaviorScore(swipeSpeed: number, messagesPerHour: number, matchRate: number): number {
    let score = 0;
    
    if (swipeSpeed < 30) score += 0.4;
    else if (swipeSpeed < 60) score += 0.2;
    
    if (messagesPerHour < 50) score += 0.3;
    else if (messagesPerHour < 100) score += 0.15;
    
    if (matchRate > 0.1) score += 0.3;
    else if (matchRate > 0.05) score += 0.15;

    return score;
  }

  private async getReportFeatures(userId: string): Promise<any> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT COUNT(*) as count,
              SUM(CASE WHEN reason = 'scam' THEN 1 ELSE 0 END) as scam_count,
              SUM(CASE WHEN reason = 'fake_profile' THEN 1 ELSE 0 END) as fake_count,
              SUM(CASE WHEN reason = 'harassment' THEN 1 ELSE 0 END) as harassment_count
       FROM reports 
       WHERE reported_user_id = $1`,
      [userId]
    );

    const row = result.rows[0];
    return {
      count: parseInt(row.count) || 0,
      scamCount: parseInt(row.scam_count) || 0,
      fakeCount: parseInt(row.fake_count) || 0,
      harassmentCount: parseInt(row.harassment_count) || 0
    };
  }

  private async getMessagingFeatures(userId: string): Promise<any> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT text FROM messages 
       WHERE sender_id = $1 
       AND created_at > NOW() - INTERVAL '7 days'`,
      [userId]
    );

    const scamKeywords = [
      'send money', 'western union', 'gift card', 'bitcoin', 'crypto',
      'invest', 'profit', 'bank account', 'wire transfer', 'sugar daddy',
      'allowance', 'ppm', 'telegram', 'whatsapp', 'move to',
      'love you', 'marry', 'visa', 'flight', 'emergency'
    ];

    let scamScore = 0;
    let linkCount = 0;
    let totalMessages = result.rows.length;

    for (const msg of result.rows) {
      const text = msg.text.toLowerCase();
      
      for (const keyword of scamKeywords) {
        if (text.includes(keyword)) {
          scamScore++;
          break;
        }
      }

      if (text.includes('http') || text.includes('www.') || text.includes('.com')) {
        linkCount++;
      }
    }

    return {
      scamKeywordScore: totalMessages > 0 ? scamScore / totalMessages : 0,
      externalLinkCount: linkCount
    };
  }

  private async getActivityFeatures(userId: string): Promise<any> {
    const pool = getPool();
    
    const loginResult = await pool.query(
      `SELECT COUNT(*) as sessions,
              AVG(EXTRACT(EPOCH FROM (last_active - created_at))) as avg_session_duration
       FROM users WHERE id = $1`,
      [userId]
    );

    const messageResult = await pool.query(
      `SELECT COUNT(*) as total_messages FROM messages WHERE sender_id = $1`,
      [userId]
    );

    const sessions = parseInt(loginResult.rows[0].sessions) || 1;
    const totalMessages = parseInt(messageResult.rows[0].total_messages) || 0;

    return {
      score: Math.min(sessions / 30, 1),
      popularity: Math.min(totalMessages / 100, 1)
    };
  }

  async getFeatureVector(userId: string): Promise<number[]> {
    const features = await this.collectUserFeatures(userId);
    
    return [
      features.accountAgeDays / 365,
      features.profileCompletion,
      Math.min(features.photoCount / 5, 1),
      Math.min(features.bioLength / 500, 1),
      features.hasFace ? 1 : 0,
      Math.min(features.swipeSpeed / 100, 1),
      Math.min(features.messagesPerHour / 200, 1),
      features.matchRate,
      Math.min(features.avgResponseDelay / 300, 1),
      Math.min(features.sessionDuration / 60, 1),
      Math.min(features.reportCount / 10, 1),
      features.scamKeywordScore,
      Math.min(features.externalLinkCount / 5, 1),
      features.duplicatePhotoScore,
      features.behaviorScore,
      features.activityScore,
      features.popularityScore
    ];
  }

  async cacheFeatures(userId: string): Promise<void> {
    const features = await this.collectUserFeatures(userId);
    const key = `fraud:features:${userId}`;
    await redisService.set(key, JSON.stringify(features), 3600);
  }

  async getCachedFeatures(userId: string): Promise<UserFeatures | null> {
    const key = `fraud:features:${userId}`;
    const data = await redisService.get(key);
    return data ? JSON.parse(data) : null;
  }
}

export const fraudFeatureStore = new FraudDetectionFeatureStore();

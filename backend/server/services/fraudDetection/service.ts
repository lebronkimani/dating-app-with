import { fraudFeatureStore } from './featureStore';
import { fraudDetectionModels } from './models';
import { moderationService } from '../moderation';
import { redisService } from '../redis';
import { getPool } from '../../db/init';

interface ModerationAction {
  action: 'allow' | 'warning' | 'restriction' | 'temporary_ban' | 'permanent_ban' | 'shadow_ban';
  reason: string;
  details: string[];
  automatic: boolean;
}

export class FraudDetectionService {
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL = 60000;
  private readonly HIGH_RISK_THRESHOLD = 0.7;
  private readonly MODERATE_RISK_THRESHOLD = 0.4;

  async initialize() {
    console.log('Fraud Detection Service initialized');
    await this.startPeriodicChecks();
  }

  async analyzeUser(userId: string): Promise<{
    riskScore: number;
    action: ModerationAction;
    factors: string[];
  }> {
    const riskScore = await fraudDetectionModels.getCombinedRiskScore(userId);
    
    let action: ModerationAction;

    switch (riskScore.recommendation) {
      case 'allow':
        action = {
          action: 'allow',
          reason: 'User appears legitimate',
          details: [],
          automatic: false
        };
        break;
      
      case 'monitor':
        action = {
          action: 'allow',
          reason: 'User flagged for monitoring',
          details: riskScore.factors,
          automatic: true
        };
        await this.logMonitoring(userId, riskScore);
        break;
      
      case 'warning':
        action = {
          action: 'warning',
          reason: 'Suspicious activity detected',
          details: riskScore.factors,
          automatic: true
        };
        await moderationService.handleViolation({
          userId,
          type: 'automated_detection',
          severity: 'medium',
          source: 'ai_detection',
          description: `Risk score: ${riskScore.overallScore}. Factors: ${riskScore.factors.join(', ')}`
        });
        break;
      
      case 'shadow_ban':
        action = {
          action: 'shadow_ban',
          reason: 'High-risk user detected',
          details: riskScore.factors,
          automatic: true
        };
        await moderationService.shadowBan(userId, `Auto-detected: ${riskScore.factors.join(', ')}`);
        break;
      
      case 'permanent_ban':
        action = {
          action: 'permanent_ban',
          reason: 'Critical fraud detected',
          details: riskScore.factors,
          automatic: true
        };
        await moderationService.permanentBan(userId, `Auto-detected fraud: ${riskScore.factors.join(', ')}`);
        break;
    }

    await this.cacheRiskScore(userId, riskScore.overallScore, riskScore.recommendation);

    return {
      riskScore: riskScore.overallScore,
      action,
      factors: riskScore.factors
    };
  }

  async checkMessage(userId: string, message: string): Promise<{
    allowed: boolean;
    reason?: string;
    riskIncrease: number;
  }> {
    const features = await fraudFeatureStore.collectUserFeatures(userId);
    
    const scamKeywords = [
      'send money', 'western union', 'gift card', 'bitcoin', 'crypto',
      'invest', 'profit', 'bank account', 'wire transfer', 'sugar daddy',
      'allowance', 'ppm', 'telegram', 'whatsapp', 'move to',
      'love you', 'marry', 'visa', 'flight', 'emergency'
    ];

    const text = message.toLowerCase();
    let keywordMatch = false;
    let matchedKeyword = '';

    for (const keyword of scamKeywords) {
      if (text.includes(keyword)) {
        keywordMatch = true;
        matchedKeyword = keyword;
        break;
      }
    }

    if (keywordMatch) {
      const currentScore = await this.getCachedRiskScore(userId);
      const newScore = currentScore + 0.15;
      
      await this.cacheRiskScore(userId, newScore, newScore > 0.7 ? 'shadow_ban' : 'warning');
      
      return {
        allowed: false,
        reason: `Message contains suspicious keyword: ${matchedKeyword}`,
        riskIncrease: 0.15
      };
    }

    const hasLink = text.includes('http') || text.includes('www.');
    if (hasLink) {
      const currentScore = await this.getCachedRiskScore(userId);
      const newScore = currentScore + 0.05;
      await this.cacheRiskScore(userId, newScore, 'monitor');
      
      return {
        allowed: true,
        reason: undefined,
        riskIncrease: 0.05
      };
    }

    return { allowed: true, riskIncrease: 0 };
  }

  async checkSwipe(userId: string): Promise<{ allowed: boolean; reason?: string }> {
    const cacheKey = `fraud:swipes:${userId}`;
    const currentCount = await redisService.get(cacheKey);
    const count = currentCount ? parseInt(currentCount) : 0;

    if (count > 50) {
      return {
        allowed: false,
        reason: 'Too many swipes. Please slow down.'
      };
    }

    await redisService.set(cacheKey, (count + 1).toString(), 60);
    
    return { allowed: true };
  }

  async checkProfileCreation(ipAddress: string, deviceId?: string): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    const pool = getPool();
    
    const ipResult = await pool.query(
      `SELECT COUNT(*) as count FROM users 
       WHERE created_at > NOW() - INTERVAL '1 hour' 
       AND ip_address = $1`,
      [ipAddress]
    );

    const ipCount = parseInt(ipResult.rows[0].count);
    
    if (ipCount > 3) {
      return {
        allowed: false,
        reason: 'Too many accounts from this IP address'
      };
    }

    if (deviceId) {
      const deviceResult = await pool.query(
        `SELECT COUNT(*) as count FROM users 
         WHERE created_at > NOW() - INTERVAL '24 hours' 
         AND device_id = $1`,
        [deviceId]
      );

      const deviceCount = parseInt(deviceResult.rows[0].count);
      
      if (deviceCount > 2) {
        return {
          allowed: false,
          reason: 'Too many accounts from this device'
        };
      }
    }

    return { allowed: true };
  }

  async getRiskScore(userId: string): Promise<number> {
    const cached = await this.getCachedRiskScore(userId);
    if (cached !== null) {
      return cached;
    }

    const result = await fraudDetectionModels.getCombinedRiskScore(userId);
    await this.cacheRiskScore(userId, result.overallScore, result.recommendation);
    return result.overallScore;
  }

  async getRiskProfile(userId: string): Promise<any> {
    const [bot, fakeProfile, scam, reports, combined] = await Promise.all([
      fraudDetectionModels.detectBot(userId),
      fraudDetectionModels.detectFakeProfile(userId),
      fraudDetectionModels.detectScam(userId),
      fraudDetectionModels.calculateReportScore(userId),
      fraudDetectionModels.getCombinedRiskScore(userId)
    ]);

    return {
      userId,
      overallScore: combined.overallScore,
      recommendation: combined.recommendation,
      scores: {
        botDetection: { score: bot.score, confidence: bot.confidence, factors: bot.factors },
        fakeProfile: { score: fakeProfile.score, confidence: fakeProfile.confidence, factors: fakeProfile.factors },
        scamDetection: { score: scam.score, confidence: scam.confidence, factors: scam.factors },
        reportScore: { score: reports.score, confidence: reports.confidence, factors: reports.factors }
      },
      factors: combined.factors
    };
  }

  async getHighRiskUsers(limit: number = 100): Promise<any[]> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.created_at, u.last_active,
              rm.risk_score
       FROM users u
       LEFT JOIN user_moderation rm ON u.id = rm.user_id
       WHERE u.is_banned = false
       AND (rm.risk_score > $1 OR rm.risk_score IS NULL)
       ORDER BY rm.risk_score DESC NULLS LAST
       LIMIT $2`,
      [this.MODERATE_RISK_THRESHOLD, limit]
    );

    return result.rows;
  }

  private async cacheRiskScore(userId: string, score: number, recommendation: string): Promise<void> {
    const key = `fraud:score:${userId}`;
    await redisService.set(key, JSON.stringify({ score, recommendation, updatedAt: Date.now() }), 3600);
  }

  private async getCachedRiskScore(userId: string): Promise<number | null> {
    const key = `fraud:score:${userId}`;
    const data = await redisService.get(key);
    if (data) {
      const parsed = JSON.parse(data);
      if (Date.now() - parsed.updatedAt < 300000) {
        return parsed.score;
      }
    }
    return null;
  }

  private async logMonitoring(userId: string, riskScore: any): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO violations (user_id, type, severity, source, description)
       VALUES ($1, 'automated_monitoring', 'low', 'ai_detection', $2)`,
      [userId, JSON.stringify(riskScore)]
    );
  }

  private async startPeriodicChecks(): Promise<void> {
    this.checkInterval = setInterval(async () => {
      try {
        await this.runPeriodicRiskAssessment();
      } catch (error) {
        console.error('Periodic fraud check error:', error);
      }
    }, this.CHECK_INTERVAL);
  }

  private async runPeriodicRiskAssessment(): Promise<void> {
    const highRiskUsers = await this.getHighRiskUsers(50);
    
    for (const user of highRiskUsers) {
      try {
        await this.analyzeUser(user.id);
      } catch (error) {
        console.error(`Error analyzing user ${user.id}:`, error);
      }
    }
  }

  destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

export const fraudDetectionService = new FraudDetectionService();

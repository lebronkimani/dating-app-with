import { underageDetectionService } from './underageDetection';
import { nudityDetectionService } from './nudityDetection';
import { harassmentDetectionService } from './harassmentDetection';
import { fakeLocationDetectionService } from './fakeLocationDetection';
import { impersonationDetectionService } from './impersonationDetection';
import { moderationService } from '../moderation';
import { redisService } from '../redis';

interface UnifiedRiskScore {
  overallScore: number;
  underageScore: number;
  nudityScore: number;
  harassmentScore: number;
  impersonationScore: number;
  locationScore: number;
  recommendation: 'allow' | 'monitor' | 'warning' | 'shadow_ban' | 'permanent_ban';
  actions: string[];
  details: {
    underage?: any;
    nudity?: any;
    harassment?: any;
    impersonation?: any;
    location?: any;
  };
}

export class SafetyRiskScoreService {
  private readonly WEIGHTS = {
    underage: 0.30,
    nudity: 0.20,
    harassment: 0.20,
    impersonation: 0.15,
    location: 0.15
  };

  async calculateUnifiedScore(userId: string): Promise<UnifiedRiskScore> {
    const [underageResult, nudityResult, harassmentResult, impersonationResult, locationResult] = await Promise.allSettled([
      underageDetectionService.checkAge(userId),
      underageDetectionService.checkBehavioralAge(userId),
      this.getPlaceholderResult(),
      this.getPlaceholderResult(),
      this.getPlaceholderResult()
    ]);

    let underageScore = 0;
    let nudityScore = 0;
    let harassmentScore = 0;
    let impersonationScore = 0;
    let locationScore = 0;

    const details: UnifiedRiskScore['details'] = {};

    if (underageResult.status === 'fulfilled' && underageResult.value?.detected) {
      underageScore = underageResult.value.confidence;
      details.underage = underageResult.value;
    }

    if (nudityResult.status === 'fulfilled' && nudityResult.value?.detected) {
      nudityScore = nudityResult.value.confidence;
      details.nudity = nudityResult.value;
    }

    if (harassmentResult.status === 'fulfilled' && harassmentResult.value?.detected) {
      harassmentScore = harassmentResult.value.confidence;
      details.harassment = harassmentResult.value;
    }

    if (impersonationResult.status === 'fulfilled' && impersonationResult.value?.isImpersonating) {
      impersonationScore = impersonationResult.value.confidence;
      details.impersonation = impersonationResult.value;
    }

    if (locationResult.status === 'fulfilled' && locationResult.value?.isFake) {
      locationScore = locationResult.value.confidence;
      details.location = locationResult.value;
    }

    const overallScore = 
      underageScore * this.WEIGHTS.underage +
      nudityScore * this.WEIGHTS.nudity +
      harassmentScore * this.WEIGHTS.harassment +
      impersonationScore * this.WEIGHTS.impersonation +
      locationScore * this.WEIGHTS.location;

    const actions: string[] = [];
    let recommendation: UnifiedRiskScore['recommendation'];

    if (overallScore < 0.3) {
      recommendation = 'allow';
    } else if (overallScore < 0.5) {
      recommendation = 'monitor';
    } else if (overallScore < 0.7) {
      recommendation = 'warning';
      actions.push('Send warning notification');
    } else if (overallScore < 0.85) {
      recommendation = 'shadow_ban';
      actions.push('Apply shadow ban');
      actions.push('Reduce visibility in discovery');
    } else {
      recommendation = 'permanent_ban';
      actions.push('Permanently ban user');
      actions.push('Add to blacklist');
    }

    if (underageScore > 0.5) {
      actions.push('Require ID verification');
    }

    if (nudityScore > 0.5) {
      actions.push('Remove explicit content');
    }

    if (harassmentScore > 0.5) {
      actions.push('Restrict messaging');
    }

    await this.cacheRiskScore(userId, overallScore, recommendation);

    return {
      overallScore: Math.round(overallScore * 100) / 100,
      underageScore: Math.round(underageScore * 100) / 100,
      nudityScore: Math.round(nudityScore * 100) / 100,
      harassmentScore: Math.round(harassmentScore * 100) / 100,
      impersonationScore: Math.round(impersonationScore * 100) / 100,
      locationScore: Math.round(locationScore * 100) / 100,
      recommendation,
      actions,
      details
    };
  }

  private getPlaceholderResult(): any {
    return { detected: false, confidence: 0 };
  }

  async applyAutomatedActions(userId: string, riskScore: UnifiedRiskScore): Promise<void> {
    if (riskScore.underageScore > 0.5) {
      await moderationService.permanentBan(userId, 'Underage user detected via risk assessment');
      return;
    }

    if (riskScore.nudityScore > 0.7) {
      await moderationService.permanentBan(userId, 'Explicit content detected via risk assessment');
      return;
    }

    if (riskScore.nudityScore > 0.5) {
      await moderationService.handleViolation({
        userId,
        type: 'explicit_content',
        severity: 'high',
        source: 'ai_detection',
        description: 'Nudity detected via unified risk assessment'
      });
    }

    if (riskScore.recommendation === 'shadow_ban') {
      await moderationService.shadowBan(userId, `High risk score: ${riskScore.overallScore}`);
    }

    if (riskScore.recommendation === 'permanent_ban') {
      await moderationService.permanentBan(userId, `Critical risk score: ${riskScore.overallScore}`);
    }

    if (riskScore.recommendation === 'warning' || riskScore.overallScore > 0.4) {
      await moderationService.handleViolation({
        userId,
        type: 'automated_warning',
        severity: 'low',
        source: 'ai_detection',
        description: `Risk score warning: ${riskScore.overallScore}`
      });
    }
  }

  async getCachedScore(userId: string): Promise<UnifiedRiskScore | null> {
    const key = `safety:risk:${userId}`;
    const data = await redisService.get(key);
    return data ? JSON.parse(data) : null;
  }

  private async cacheRiskScore(userId: string, score: number, recommendation: string): Promise<void> {
    const key = `safety:risk:${userId}`;
    await redisService.set(key, JSON.stringify({ score, recommendation, updatedAt: Date.now() }), 3600);
  }

  async analyzeMessage(userId: string, message: string, recipientId: string): Promise<{
    allowed: boolean;
    reason?: string;
    toxicityScores?: any;
  }> {
    const harassmentResult = await harassmentDetectionService.analyzeMessage(message, userId, recipientId);

    if (harassmentResult.detected) {
      if (harassmentResult.action === 'ban') {
        await moderationService.permanentBan(userId, 'Harassment detected via message analysis');
        return {
          allowed: false,
          reason: 'Your account has been banned due to harassment',
          toxicityScores: harassmentResult.toxicityScores
        };
      }

      return {
        allowed: false,
        reason: 'Message blocked due to harassment detection',
        toxicityScores: harassmentResult.toxicityScores
      };
    }

    return { allowed: true };
  }

  async analyzeLocation(userId: string, latitude: number, longitude: number, ipAddress?: string): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    const locationResult = await fakeLocationDetectionService.analyzeLocation(userId, latitude, longitude, ipAddress);

    if (locationResult.isFake && locationResult.action === 'restrict') {
      return {
        allowed: false,
        reason: 'Suspicious location detected'
      };
    }

    return { allowed: true };
  }
}

export const safetyRiskScoreService = new SafetyRiskScoreService();

import { getPool, generateId } from '../db/init';
import { redisService } from './redis';
import { notificationService } from './notification/NotificationService';

interface ModerationConfig {
  warningThreshold: number;
  restrictionThreshold: number;
  tempBanThreshold: number;
  permanentBanThreshold: number;
  restrictionDuration: number;
  tempBanDurations: number[];
}

const DEFAULT_CONFIG: ModerationConfig = {
  warningThreshold: 1,
  restrictionThreshold: 2,
  tempBanThreshold: 3,
  permanentBanThreshold: 4,
  restrictionDuration: 24 * 60 * 60 * 1000,
  tempBanDurations: [3, 7, 30]
};

type ModerationStatus = 'active' | 'warning' | 'restricted' | 'temporary_ban' | 'permanent_ban' | 'shadow_banned';
type ViolationSource = 'ai_detection' | 'user_report' | 'moderator' | 'spam_detection';
type ViolationSeverity = 'low' | 'medium' | 'high' | 'critical';

interface ViolationRecord {
  userId: string;
  type: string;
  severity: ViolationSeverity;
  source: ViolationSource;
  description?: string;
  evidence?: any;
  reportId?: string;
}

export class ModerationService {
  private config: ModerationConfig;

  constructor(config: Partial<ModerationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async getModerationStatus(userId: string): Promise<any> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM user_moderation WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return {
        userId,
        status: 'active',
        warningCount: 0,
        strikeCount: 0,
        riskScore: 0,
        banUntil: null,
        restrictedUntil: null
      };
    }

    const mod = result.rows[0];
    return {
      userId: mod.user_id,
      status: mod.status,
      warningCount: mod.warning_count,
      strikeCount: mod.strike_count,
      riskScore: mod.risk_score,
      banUntil: mod.ban_until,
      restrictedUntil: mod.restricted_until,
      restrictedFeatures: mod.restricted_features,
      lastWarningDate: mod.last_warning_date
    };
  }

  async canUserSwipe(userId: string): Promise<boolean> {
    const status = await this.getModerationStatus(userId);
    if (status.status === 'permanent_ban') return false;
    if (status.status === 'temporary_ban' && status.banUntil > new Date()) return false;
    if (status.status === 'restricted') {
      const features = status.restrictedFeatures || {};
      if (features.swipe === false) return false;
    }
    return true;
  }

  async canUserMessage(userId: string): Promise<boolean> {
    const status = await this.getModerationStatus(userId);
    if (status.status === 'permanent_ban') return false;
    if (status.status === 'temporary_ban' && status.banUntil > new Date()) return false;
    if (status.status === 'restricted') {
      const features = status.restrictedFeatures || {};
      if (features.messages === false) return false;
    }
    return true;
  }

  async canUserUploadPhotos(userId: string): Promise<boolean> {
    const status = await this.getModerationStatus(userId);
    if (status.status === 'permanent_ban') return false;
    if (status.status === 'temporary_ban' && status.banUntil > new Date()) return false;
    if (status.status === 'restricted') {
      const features = status.restrictedFeatures || {};
      if (features.photos === false) return false;
    }
    return true;
  }

  async isInDiscovery(userId: string): Promise<boolean> {
    const status = await this.getModerationStatus(userId);
    if (status.status === 'permanent_ban') return false;
    if (status.status === 'temporary_ban' && status.banUntil > new Date()) return false;
    if (status.status === 'shadow_banned') return false;
    return true;
  }

  async isUserBanned(userId: string): Promise<boolean> {
    const status = await this.getModerationStatus(userId);
    if (status.status === 'permanent_ban') return true;
    if (status.status === 'temporary_ban' && status.banUntil > new Date()) return true;
    
    const pool = getPool();
    const bannedResult = await pool.query(
      `SELECT id FROM banned_users WHERE original_user_id = $1`,
      [userId]
    );
    return bannedResult.rows.length > 0;
  }

  async handleViolation(violation: ViolationRecord): Promise<void> {
    const pool = getPool();
    const { userId, type, severity, source, description, evidence, reportId } = violation;

    await pool.query(
      `INSERT INTO violations (user_id, type, severity, source, description, evidence, report_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, type, severity, source, description, JSON.stringify(evidence), reportId]
    );

    const modStatus = await this.getModerationStatus(userId);
    const newStrikeCount = modStatus.strikeCount + 1;
    const riskIncrease = this.getRiskIncrease(severity);
    const newRiskScore = modStatus.riskScore + riskIncrease;

    let newStatus: ModerationStatus = modStatus.status;
    let banUntil: Date | null = null;
    let restrictedUntil: Date | null = null;
    let restrictedFeatures: any = {};

    if (newStrikeCount === 1) {
      newStatus = 'warning';
      await this.sendWarning(userId, type, description);
    } else if (newStrikeCount === 2) {
      newStatus = 'restricted';
      restrictedUntil = new Date(Date.now() + this.config.restrictionDuration);
      restrictedFeatures = { swipe: false, messages: false, photos: false };
      await this.sendRestrictionNotification(userId, restrictedUntil);
    } else if (newStrikeCount === 3) {
      const banDays = this.config.tempBanDurations[0];
      newStatus = 'temporary_ban';
      banUntil = new Date(Date.now() + banDays * 24 * 60 * 60 * 1000);
      await this.sendTempBanNotification(userId, banDays);
    } else if (newStrikeCount >= this.config.permanentBanThreshold) {
      newStatus = 'permanent_ban';
      await this.permanentBan(userId, type);
      return;
    }

    await pool.query(
      `INSERT INTO user_moderation (user_id, strike_count, risk_score, status, ban_until, restricted_until, restricted_features, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         strike_count = $2,
         risk_score = $3,
         status = $4,
         ban_until = $5,
         restricted_until = $6,
         restricted_features = $7,
         updated_at = NOW()`,
      [userId, newStrikeCount, newRiskScore, newStatus, banUntil, restrictedUntil, JSON.stringify(restrictedFeatures)]
    );

    await this.logModerationAction(null, userId, this.getActionForStatus(newStatus), description, modStatus.status, newStatus);
  }

  async issueWarning(userId: string, reason: string, moderatorId?: string): Promise<void> {
    const pool = getPool();
    const modStatus = await this.getModerationStatus(userId);
    const newWarningCount = modStatus.warningCount + 1;

    await pool.query(
      `INSERT INTO user_moderation (user_id, warning_count, status, last_warning_date, updated_at)
       VALUES ($1, $2, 'warning', NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         warning_count = $2,
         status = 'warning',
         last_warning_date = NOW(),
         updated_at = NOW()`,
      [userId, newWarningCount]
    );

    await this.sendWarning(userId, 'moderator', reason);
    await this.logModerationAction(moderatorId, userId, 'warning', reason, modStatus.status, 'warning');
  }

  async restrictUser(userId: string, duration: number, features: any, reason: string, moderatorId?: string): Promise<void> {
    const pool = getPool();
    const restrictedUntil = new Date(Date.now() + duration);
    const modStatus = await this.getModerationStatus(userId);

    await pool.query(
      `INSERT INTO user_moderation (user_id, status, restricted_until, restricted_features, updated_at)
       VALUES ($1, 'restricted', $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         status = 'restricted',
         restricted_until = $2,
         restricted_features = $3,
         updated_at = NOW()`,
      [userId, restrictedUntil, JSON.stringify(features)]
    );

    await this.sendRestrictionNotification(userId, restrictedUntil);
    await this.logModerationAction(moderatorId, userId, 'restriction', reason, modStatus.status, 'restricted');
  }

  async temporaryBan(userId: string, days: number, reason: string, moderatorId?: string): Promise<void> {
    const pool = getPool();
    const banUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const modStatus = await this.getModerationStatus(userId);

    await pool.query(
      `INSERT INTO user_moderation (user_id, status, ban_until, strike_count, updated_at)
       VALUES ($1, 'temporary_ban', $2, 3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         status = 'temporary_ban',
         ban_until = $2,
         strike_count = 3,
         updated_at = NOW()`,
      [userId, banUntil]
    );

    await this.sendTempBanNotification(userId, days);
    await this.logModerationAction(moderatorId, userId, 'temporary_ban', reason, modStatus.status, 'temporary_ban', `${days} days`);
  }

  async permanentBan(userId: string, reason: string, moderatorId?: string): Promise<void> {
    const pool = getPool();
    const modStatus = await this.getModerationStatus(userId);

    await pool.query(
      `INSERT INTO user_moderation (user_id, status, updated_at)
       VALUES ($1, 'permanent_ban', NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         status = 'permanent_ban',
         updated_at = NOW()`,
      [userId]
    );

    const userResult = await pool.query('SELECT email, phone, device_id FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      await pool.query(
        `INSERT INTO banned_users (original_user_id, email, phone, device_id, reason, banned_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO NOTHING
         ON CONFLICT (phone) DO NOTHING`,
        [userId, user.email, user.phone, user.device_id, reason, moderatorId]
      );
    }

    await pool.query('UPDATE users SET is_banned = true WHERE id = $1', [userId]);

    await this.sendPermanentBanNotification(userId);
    await this.logModerationAction(moderatorId, userId, 'permanent_ban', reason, modStatus.status, 'permanent_ban');
  }

  async shadowBan(userId: string, reason: string, moderatorId?: string): Promise<void> {
    const pool = getPool();
    const modStatus = await this.getModerationStatus(userId);

    await pool.query(
      `INSERT INTO user_moderation (user_id, status, updated_at)
       VALUES ($1, 'shadow_banned', NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         status = 'shadow_banned',
         updated_at = NOW()`,
      [userId]
    );

    await this.logModerationAction(moderatorId, userId, 'shadow_ban', reason, modStatus.status, 'shadow_banned');
  }

  async liftRestriction(userId: string, moderatorId?: string): Promise<void> {
    const pool = getPool();
    const modStatus = await this.getModerationStatus(userId);

    await pool.query(
      `UPDATE user_moderation SET status = 'active', restricted_until = NULL, restricted_features = '{}', updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    );

    await this.logModerationAction(moderatorId, userId, 'lift_restriction', 'Restriction lifted', modStatus.status, 'active');
  }

  async liftBan(userId: string, moderatorId?: string): Promise<void> {
    const pool = getPool();
    const modStatus = await this.getModerationStatus(userId);

    await pool.query(
      `UPDATE user_moderation SET status = 'active', ban_until = NULL, strike_count = 0, updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    );

    await this.logModerationAction(moderatorId, userId, 'lift_ban', 'Ban lifted', modStatus.status, 'active');
  }

  async blockUser(blockerUserId: string, blockedUserId: string, reason?: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO blocks (blocker_user_id, blocked_user_id, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING`,
      [blockerUserId, blockedUserId, reason]
    );

    await pool.query(
      `DELETE FROM matches WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`,
      [blockerUserId, blockedUserId]
    );
  }

  async unblockUser(blockerUserId: string, blockedUserId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `DELETE FROM blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2`,
      [blockerUserId, blockedUserId]
    );
  }

  async isBlocked(blockerUserId: string, targetUserId: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id FROM blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2`,
      [blockerUserId, targetUserId]
    );
    return result.rows.length > 0;
  }

  async reportUser(reporterUserId: string, reportedUserId: string, reason: string, description?: string): Promise<string> {
    const pool = getPool();
    const reportId = generateId();

    await pool.query(
      `INSERT INTO reports (id, reporter_user_id, reported_user_id, reason, description, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [reportId, reporterUserId, reportedUserId, reason, description]
    );

    return reportId;
  }

  async getReportQueue(status: string = 'pending', limit: number = 50): Promise<any[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT r.*, 
              reporter.name as reporter_name,
              reported.name as reported_name,
              reported.images as reported_images
       FROM reports r
       JOIN users reporter ON r.reporter_user_id = reporter.id
       JOIN users reported ON r.reported_user_id = reported.id
       WHERE r.status = $1
       ORDER BY r.created_at DESC
       LIMIT $2`,
      [status, limit]
    );
    return result.rows;
  }

  async resolveReport(reportId: string, resolution: string, reviewerId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE reports SET status = 'resolved', resolution = $1, reviewed_by = $2, resolved_at = NOW() WHERE id = $3`,
      [resolution, reviewerId, reportId]
    );
  }

  async getUserReports(userId: string): Promise<any[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM reports WHERE reported_user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  async getBlockedUsers(userId: string): Promise<any[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT u.id, u.name, u.images 
       FROM blocks b
       JOIN users u ON b.blocked_user_id = u.id
       WHERE b.blocker_user_id = $1`,
      [userId]
    );
    return result.rows;
  }

  private getRiskIncrease(severity: ViolationSeverity): number {
    switch (severity) {
      case 'low': return 2;
      case 'medium': return 5;
      case 'high': return 10;
      case 'critical': return 20;
      default: return 5;
    }
  }

  private getActionForStatus(status: ModerationStatus): string {
    switch (status) {
      case 'warning': return 'warning';
      case 'restricted': return 'restriction';
      case 'temporary_ban': return 'temporary_ban';
      case 'permanent_ban': return 'permanent_ban';
      case 'shadow_banned': return 'shadow_ban';
      default: return 'warning';
    }
  }

  private async sendWarning(userId: string, type: string, description?: string): Promise<void> {
    try {
      await notificationService.send(userId, {
        title: '⚠️ Community Warning',
        body: `Your recent activity violated our community guidelines. Reason: ${type}${description ? '. ' + description : ''}. Further violations may lead to account suspension.`,
        data: { type: 'moderation_warning' }
      });
    } catch (e) {
      console.log(`[DEV] Warning notification for user ${userId}: ${type}`);
    }
  }

  private async sendRestrictionNotification(userId: string, until: Date): Promise<void> {
    try {
      await notificationService.send(userId, {
        title: '🔒 Account Restricted',
        body: `Your account has been restricted for 24 hours due to community guidelines violations. Some features are temporarily disabled.`,
        data: { type: 'moderation_restriction' }
      });
    } catch (e) {
      console.log(`[DEV] Restriction notification for user ${userId}`);
    }
  }

  private async sendTempBanNotification(userId: string, days: number): Promise<void> {
    try {
      await notificationService.send(userId, {
        title: '⛔ Account Temporarily Banned',
        body: `Your account has been banned for ${days} days due to repeated violations. You can appeal after the ban period.`,
        data: { type: 'moderation_temp_ban' }
      });
    } catch (e) {
      console.log(`[DEV] Temp ban notification for user ${userId}: ${days} days`);
    }
  }

  private async sendPermanentBanNotification(userId: string): Promise<void> {
    try {
      await notificationService.send(userId, {
        title: '⛔ Account Permanently Banned',
        body: 'Your account has been permanently banned due to severe violations of our community guidelines.',
        data: { type: 'moderation_permanent_ban' }
      });
    } catch (e) {
      console.log(`[DEV] Permanent ban notification for user ${userId}`);
    }
  }

  private async logModerationAction(
    moderatorId: string | null,
    targetUserId: string,
    action: string,
    reason: string,
    previousStatus: string,
    newStatus: string,
    duration?: string
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO moderation_logs (moderator_id, target_user_id, action, reason, previous_status, new_status, duration)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [moderatorId, targetUserId, action, reason, previousStatus, newStatus, duration]
    );
  }
}

export const moderationService = new ModerationService();

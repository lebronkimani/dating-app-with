import { getPool } from '../db/init';
import { redisService } from '../redis';

interface DeviceFingerprint {
  fingerprint: string;
  userId: string;
  ipAddress: string;
  userAgent: string;
  screenResolution: string;
  timezone: string;
  language: string;
  platform: string;
  cookiesEnabled: boolean;
  doNotTrack: boolean;
  hardwareConcurrency: number;
  deviceMemory: number;
}

export class DeviceFingerprintService {
  private readonly FINGERPRINT_VERSION = '1.0';

  async createFingerprint(
    userId: string,
    signals: {
      userAgent?: string;
      screenResolution?: string;
      timezone?: string;
      language?: string;
      platform?: string;
      cookiesEnabled?: boolean;
      doNotTrack?: boolean;
      hardwareConcurrency?: number;
      deviceMemory?: number;
      ipAddress?: string;
    }
  ): Promise<string> {
    const fingerprint = this.generateFingerprint(userId, signals);
    
    const pool = getPool();
    await pool.query(
      `INSERT INTO device_fingerprints (fingerprint, user_id, user_agent, screen_resolution, timezone, language, platform, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (fingerprint) DO NOTHING`,
      [
        fingerprint,
        userId,
        signals.userAgent,
        signals.screenResolution,
        signals.timezone,
        signals.language,
        signals.platform,
        signals.ipAddress
      ]
    );

    await redisService.set(`fingerprint:${userId}`, fingerprint, 86400 * 30);

    return fingerprint;
  }

  private generateFingerprint(
    userId: string,
    signals: Record<string, any>
  ): string {
    const components = [
      signals.userAgent || '',
      signals.screenResolution || '',
      signals.timezone || '',
      signals.language || '',
      signals.platform || '',
      signals.hardwareConcurrency || '',
      signals.deviceMemory || '',
      userId
    ];

    return this.hashComponents(components);
  }

  private hashComponents(components: string[][] | string[]): string {
    let hash = 0;
    const str = Array.isArray(components) ? components.join('|') : components;
    
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    return `${this.FINGERPRINT_VERSION}_${Math.abs(hash).toString(36)}`;
  }

  async getFingerprint(userId: string): Promise<string | null> {
    const cached = await redisService.get(`fingerprint:${userId}`);
    if (cached) return cached;

    const pool = getPool();
    const result = await pool.query(
      `SELECT fingerprint FROM device_fingerprints WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    return result.rows[0]?.fingerprint || null;
  }

  async isKnownDevice(userId: string, fingerprint: string): Promise<boolean> {
    const knownFingerprint = await this.getFingerprint(userId);
    return knownFingerprint === fingerprint;
  }

  async getDeviceHistory(userId: string): Promise<any[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM device_fingerprints WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );
    return result.rows;
  }

  async detectAccountSharing(userId: string): Promise<{
    isShared: boolean;
    otherUserIds: string[];
  }> {
    const currentFingerprint = await this.getFingerprint(userId);
    if (!currentFingerprint) {
      return { isShared: false, otherUserIds: [] };
    }

    const pool = getPool();
    const result = await pool.query(
      `SELECT DISTINCT user_id FROM device_fingerprints 
       WHERE fingerprint = $1 AND user_id != $2`,
      [currentFingerprint, userId]
    );

    const otherUserIds = result.rows.map(r => r.user_id);
    
    return {
      isShared: otherUserIds.length > 0,
      otherUserIds
    };
  }

  async detectVPNByBehavior(userId: string): Promise<{
    isSuspicious: boolean;
    reasons: string[];
  }> {
    const pool = getPool();
    const reasons: string[] = [];

    const ipResult = await pool.query(
      `SELECT COUNT(DISTINCT ip_address) as unique_ips,
              COUNT(*) as total_logins
       FROM device_fingerprints 
       WHERE user_id = $1 
       AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );

    const uniqueIPs = parseInt(ipResult.rows[0]?.unique_ips || 0);
    const totalLogins = parseInt(ipResult.rows[0]?.total_logins || 0);

    if (uniqueIPs > 5) {
      reasons.push(`${uniqueIPs} different IPs in 24 hours`);
    }

    const countryResult = await pool.query(
      `SELECT COUNT(DISTINCT country) as unique_countries
       FROM device_fingerprints 
       WHERE user_id = $1 
       AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );

    const uniqueCountries = parseInt(countryResult.rows[0]?.unique_countries || 0);
    
    if (uniqueCountries > 2) {
      reasons.push(`${uniqueCountries} different countries in 24 hours`);
    }

    return {
      isSuspicious: reasons.length > 0,
      reasons
    };
  }
}

export const deviceFingerprintService = new DeviceFingerprintService();

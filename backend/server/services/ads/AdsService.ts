import { getPool } from '../../db/init';
import { eventQueue, Events } from '../services/eventQueue';

interface Ad {
  id: string;
  adNetwork: string;
  adType: 'rewarded' | 'banner' | 'interstitial' | 'native';
  rewardType?: string;
  contentUrl?: string;
  destinationUrl?: string;
  isActive: boolean;
}

export class AdsService {
  private static instance: AdsService;
  private ads: Map<string, Ad> = new Map();

  static getInstance(): AdsService {
    if (!AdsService.instance) {
      AdsService.instance = new AdsService();
    }
    return AdsService.instance;
  }

  async initialize(): Promise<void> {
    await this.loadAds();
    console.log('AdsService initialized');
  }

  private async loadAds(): Promise<void> {
    const pool = getPool();
    
    try {
      const result = await pool.query('SELECT * FROM ads WHERE is_active = true');
      
      for (const ad of result.rows) {
        this.ads.set(ad.id, {
          id: ad.id,
          adNetwork: ad.ad_network,
          adType: ad.ad_type,
          rewardType: ad.reward_type,
          contentUrl: ad.content_url,
          destinationUrl: ad.destination_url,
          isActive: ad.is_active
        });
      }
    } catch (error) {
      console.log('Ads table not ready yet');
    }
  }

  getAd(adId: string): Ad | undefined {
    return this.ads.get(adId);
  }

  getAdsByType(type: Ad['adType']): Ad[] {
    return Array.from(this.ads.values()).filter(ad => ad.adType === type);
  }

  async selectAd(placement: string): Promise<Ad | null> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT * FROM ads WHERE is_active = true 
       AND ad_type IN ('rewarded', 'interstitial')
       ORDER BY RANDOM() LIMIT 1`
    );

    if (result.rows.length === 0) {
      return null;
    }

    const ad = result.rows[0];
    return {
      id: ad.id,
      adNetwork: ad.ad_network,
      adType: ad.ad_type,
      rewardType: ad.reward_type,
      contentUrl: ad.content_url,
      destinationUrl: ad.destination_url,
      isActive: ad.is_active
    };
  }

  async recordAdView(
    userId: string, 
    adId: string, 
    placement: string,
    completed: boolean = false
  ): Promise<void> {
    const pool = getPool();
    
    await pool.query(
      `INSERT INTO ad_views (user_id, ad_id, placement, completed, reward_granted)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, adId, placement, completed, false]
    );

    if (completed) {
      await this.grantReward(userId, adId, placement);
    }
  }

  async grantReward(userId: string, adId: string, placement: string): Promise<{ rewardType: string; granted: boolean }> {
    const ad = this.ads.get(adId);
    if (!ad || !ad.rewardType) {
      return { rewardType: 'unknown', granted: false };
    }

    const pool = getPool();
    
    let granted = false;

    switch (ad.rewardType) {
      case 'super_like':
        await pool.query(
          `INSERT INTO super_like_credits (user_id, credits)
           VALUES ($1, 1)
           ON CONFLICT (user_id) DO UPDATE SET 
             credits = super_like_credits.credits + 1,
             updated_at = CURRENT_TIMESTAMP`,
          [userId]
        );
        granted = true;
        break;
        
      case 'like_reveal':
        const currentWeek = this.getWeekNumber(new Date());
        const currentYear = new Date().getFullYear();
        
        await pool.query(
          `INSERT INTO ad_reveals (user_id, revealed_liker_id, week_number, year)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, week_number, year) DO NOTHING`,
          [userId, 'ad_reward', currentWeek, currentYear]
        );
        granted = true;
        break;
        
      case 'unlimited_swipes':
        await pool.query(
          `UPDATE users SET daily_swipe_limit = 9999 WHERE id = $1`,
          [userId]
        );
        granted = true;
        break;
    }

    await pool.query(
      `UPDATE ad_views SET reward_granted = true 
       WHERE user_id = $1 AND ad_id = $2`,
      [userId, adId]
    );

    await eventQueue.publish({
      type: Events.AD_WATCHED,
      userId,
      data: { adId, placement, rewardType: ad.rewardType }
    });

    return { rewardType: ad.rewardType, granted };
  }

  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  async getAdStats(): Promise<{
    totalViews: number;
    completedViews: number;
    rewardGranted: number;
    byType: Record<string, number>;
  }> {
    const pool = getPool();
    
    const totalResult = await pool.query('SELECT COUNT(*) as count FROM ad_views');
    const completedResult = await pool.query("SELECT COUNT(*) as count FROM ad_views WHERE completed = true");
    const rewardResult = await pool.query("SELECT COUNT(*) as count FROM ad_views WHERE reward_granted = true");
    
    const byTypeResult = await pool.query(
      `SELECT a.ad_type, COUNT(*) as count 
       FROM ad_views v 
       JOIN ads a ON v.ad_id = a.id 
       GROUP BY a.ad_type`
    );

    const byType: Record<string, number> = {};
    for (const row of byTypeResult.rows) {
      byType[row.ad_type] = parseInt(row.count);
    }

    return {
      totalViews: parseInt(totalResult.rows[0].count) || 0,
      completedViews: parseInt(completedResult.rows[0].count) || 0,
      rewardGranted: parseInt(rewardResult.rows[0].count) || 0,
      byType
    };
  }
}

export const adsService = AdsService.getInstance();

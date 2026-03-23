import { getPool } from '../../db/init';

interface AdPlacement {
  type: 'banner' | 'interstitial' | 'native' | 'sponsored_profile';
  placement: string;
  refreshInterval?: number;
  showAfterSwipeCount?: number;
}

interface UserAdProfile {
  userId: string;
  sessionAds: number;
  lastAdTime: Date;
  swipesSinceLastAd: number;
  userScore: number;
  isPremium: boolean;
}

interface AdTargeting {
  minAge?: number;
  maxAge?: number;
  gender?: string;
  interests?: string[];
  location?: string;
}

export class AdPlacementService {
  private static instance: AdPlacementService;
  private userProfiles: Map<string, UserAdProfile> = new Map();
  private currentSessionAdCount: Map<string, number> = new Map();
  
  private readonly MAX_ADS_PER_SESSION = 6;
  private readonly MIN_PROFILES_BETWEEN_ADS = 12;
  private readonly NATIVE_AD_INTERVAL = 15;
  private readonly HIGH_SCORE_AD_INTERVAL = 10;
  private readonly LOW_SCORE_AD_INTERVAL = 20;

  static getInstance(): AdPlacementService {
    if (!AdPlacementService.instance) {
      AdPlacementService.instance = new AdPlacementService();
    }
    return AdPlacementService.instance;
  }

  async initialize(): Promise<void> {
    console.log('Initializing Ad Placement Service...');
    await this.loadFrequencyRules();
    console.log('Ad Placement Service initialized');
  }

  private async loadFrequencyRules(): Promise<void> {
    const pool = getPool();
    
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ad_frequency_rules (
          user_id UUID PRIMARY KEY,
          session_ads INTEGER DEFAULT 0,
          last_ad_time TIMESTAMP,
          swipes_since_last_ad INTEGER DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (error) {
      console.log('Ad frequency table will be created when database is ready');
    }
  }

  async getUserAdProfile(userId: string): Promise<UserAdProfile> {
    if (this.userProfiles.has(userId)) {
      return this.userProfiles.get(userId)!;
    }

    const pool = getPool();
    
    const userResult = await pool.query(
      'SELECT is_premium, premium_expires_at, age, gender, interests FROM users WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];
    const isPremium = user?.is_premium && 
      (!user.premium_expires_at || new Date(user.premium_expires_at) > new Date());

    const profile: UserAdProfile = {
      userId,
      sessionAds: 0,
      lastAdTime: new Date(0),
      swipesSinceLastAd: 0,
      userScore: await this.calculateUserScore(userId),
      isPremium
    };

    this.userProfiles.set(userId, profile);
    return profile;
  }

  private async calculateUserScore(userId: string): Promise<number> {
    const pool = getPool();
    
    try {
      const swipeResult = await pool.query(
        'SELECT COUNT(*) as count FROM swipes WHERE user_id = $1',
        [userId]
      );
      const swipeCount = parseInt(swipeResult.rows[0]?.count || '0');

      const matchResult = await pool.query(
        'SELECT COUNT(*) as count FROM matches WHERE user1_id = $1 OR user2_id = $1',
        [userId]
      );
      const matchCount = parseInt(matchResult.rows[0]?.count || '0');

      const messageResult = await pool.query(
        'SELECT COUNT(*) as count FROM messages WHERE sender_id = $1',
        [userId]
      );
      const messageCount = parseInt(messageResult.rows[0]?.count || '0');

      const matchRate = swipeCount > 0 ? matchCount / swipeCount : 0;
      const engagement = messageCount / Math.max(matchCount, 1);

      return matchRate * 0.5 + Math.min(swipeCount / 200, 0.3) + engagement * 0.2;
    } catch (error) {
      return 0.5;
    }
  }

  canShowAd(userId: string, placement: string): { allowed: boolean; reason?: string } {
    if (this.userProfiles.has(userId)) {
      const profile = this.userProfiles.get(userId)!;
      
      if (profile.isPremium) {
        return { allowed: false, reason: 'Premium user' };
      }

      if (profile.sessionAds >= this.MAX_ADS_PER_SESSION) {
        return { allowed: false, reason: 'Max ads per session reached' };
      }

      if (profile.swipesSinceLastAd < this.MIN_PROFILES_BETWEEN_ADS) {
        return { allowed: false, reason: 'Too soon since last ad' };
      }
    }

    return { allowed: true };
  }

  shouldShowNativeAd(userId: string, swipeCount: number): boolean {
    if (swipeCount === 0) return false;
    
    const profile = this.userProfiles.get(userId);
    const interval = profile && profile.userScore > 0.5 
      ? this.HIGH_SCORE_AD_INTERVAL 
      : this.LOW_SCORE_AD_INTERVAL;

    return swipeCount % interval === 0;
  }

  async getAdForPlacement(
    userId: string, 
    placement: string,
    targeting?: AdTargeting
  ): Promise<{
    adId: string;
    type: string;
    content: any;
    reward?: string;
  } | null> {
    const { allowed, reason } = this.canShowAd(userId, placement);
    
    if (!allowed) {
      return null;
    }

    const profile = await this.getUserAdProfile(userId);
    
    if (profile.isPremium) {
      return null;
    }

    const pool = getPool();
    
    let query = `
      SELECT * FROM ads 
      WHERE is_active = true 
      AND ad_type IN ('banner', 'interstitial', 'native')
    `;
    
    const params: any[] = [];
    
    if (targeting?.interests && targeting.interests.length > 0) {
      query += ` AND (ad_network = 'internal' OR target_interest = ANY($1))`;
      params.push(targeting.interests);
    }
    
    query += ' ORDER BY RANDOM() LIMIT 1';
    
    try {
      const result = await pool.query(query, params);
      
      if (result.rows.length > 0) {
        const ad = result.rows[0];
        
        await this.recordAdImpression(userId, ad.id, placement);
        
        return {
          adId: ad.id,
          type: ad.ad_type,
          content: {
            title: ad.name,
            imageUrl: ad.content_url,
            description: ad.description,
            cta: ad.cta_text
          },
          reward: ad.reward_type
        };
      }
    } catch (error) {
      console.error('Failed to get ad:', error);
    }

    return this.getFallbackAd(placement);
  }

  private getFallbackAd(placement: string): any {
    const fallbackAds = {
      banner: {
        adId: 'fallback-banner',
        type: 'banner',
        content: {
          title: 'Upgrade to Premium',
          imageUrl: '/ads/banner-placeholder.png',
          description: 'Remove ads and get unlimited swipes'
        }
      },
      interstitial: {
        adId: 'fallback-interstitial',
        type: 'interstitial',
        content: {
          title: 'Get Premium',
          imageUrl: '/ads/interstitial-placeholder.png',
          description: 'Upgrade for an ad-free experience'
        }
      },
      native: {
        adId: 'fallback-native',
        type: 'native',
        content: {
          title: 'Explore Premium Features',
          description: 'Unlock unlimited likes and super likes'
        }
      },
      sponsored_profile: {
        adId: 'fallback-sponsored',
        type: 'sponsored_profile',
        content: {
          name: 'GlobalConnect Premium',
          bio: 'Upgrade to premium for the best experience!'
        }
      }
    };

    return fallbackAds[placement as keyof typeof fallbackAds] || fallbackAds.banner;
  }

  async recordAdImpression(userId: string, adId: string, placement: string): Promise<void> {
    const profile = this.userProfiles.get(userId);
    if (profile) {
      profile.sessionAds++;
      profile.lastAdTime = new Date();
      profile.swipesSinceLastAd = 0;
    }

    const pool = getPool();
    try {
      await pool.query(
        `INSERT INTO ad_views (user_id, ad_id, placement, completed, reward_granted)
         VALUES ($1, $2, $3, false, false)`,
        [userId, adId, placement]
      );
    } catch (error) {
      console.error('Failed to record ad impression:', error);
    }
  }

  async recordAdClick(userId: string, adId: string): Promise<void> {
    const pool = getPool();
    
    try {
      await pool.query(
        `INSERT INTO ad_clicks (user_id, ad_id, clicked_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT DO NOTHING`,
        [userId, adId]
      );
    } catch (error) {
      console.log('Ad clicks table may not exist yet');
    }
  }

  incrementSwipeCount(userId: string): void {
    const profile = this.userProfiles.get(userId);
    if (profile) {
      profile.swipesSinceLastAd++;
    }
  }

  getAdPlacementConfig(userId: string): {
    showBanner: boolean;
    nativeAdInterval: number;
    interstitialFrequency: number;
  } {
    const profile = this.userProfiles.get(userId);
    
    if (!profile || profile.isPremium) {
      return {
        showBanner: false,
        nativeAdInterval: 999,
        interstitialFrequency: 999
      };
    }

    const highScore = profile.userScore > 0.5;
    
    return {
      showBanner: true,
      nativeAdInterval: highScore ? 10 : 15,
      interstitialFrequency: highScore ? 20 : 30
    };
  }

  async startNewSession(userId: string): Promise<void> {
    const profile = await this.getUserAdProfile(userId);
    profile.sessionAds = 0;
    profile.swipesSinceLastAd = 0;
  }

  resetSession(userId: string): void {
    this.userProfiles.delete(userId);
  }

  async getAdStats(): Promise<{
    totalImpressions: number;
    totalClicks: number;
    byType: Record<string, number>;
  }> {
    const pool = getPool();
    
    try {
      const impressionResult = await pool.query('SELECT COUNT(*) as count FROM ad_views');
      const clickResult = await pool.query('SELECT COUNT(*) as count FROM ad_clicks');
      
      const typeResult = await pool.query(`
        SELECT a.ad_type, COUNT(*) as count 
        FROM ad_views v 
        JOIN ads a ON v.ad_id = a.id 
        GROUP BY a.ad_type
      `);

      const byType: Record<string, number> = {};
      for (const row of typeResult.rows) {
        byType[row.ad_type] = parseInt(row.count);
      }

      return {
        totalImpressions: parseInt(impressionResult.rows[0]?.count || '0'),
        totalClicks: parseInt(clickResult.rows[0]?.count || '0'),
        byType
      };
    } catch (error) {
      return {
        totalImpressions: 0,
        totalClicks: 0,
        byType: {}
      };
    }
  }
}

export const adPlacementService = AdPlacementService.getInstance();

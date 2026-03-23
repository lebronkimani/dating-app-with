import { getPool } from '../db/init';

export interface AdTargetingProfile {
  userId: string;
  segments: string[];
  engagementScore: number;
  ageGroup: string;
  interests: string[];
  languages: string[];
  location: string;
}

export interface AdCampaign {
  id: string;
  name: string;
  targetingSegments: string[];
  targetingInterests: string[];
  cpc: number;
  impressions: number;
  clicks: number;
  active: boolean;
}

const AD_CAMPAIGNS: AdCampaign[] = [
  {
    id: 'premium_subscription',
    name: 'Premium Subscription Promo',
    targetingSegments: ['high_engagement', 'active_swiper'],
    targetingInterests: [],
    cpc: 0.50,
    impressions: 0,
    clicks: 0,
    active: true
  },
  {
    id: 'dating_coach',
    name: 'Dating Coach App',
    targetingSegments: ['low_match_rate', 'returning_user'],
    targetingInterests: ['Dating', 'Relationships', 'Coaching'],
    cpc: 0.30,
    impressions: 0,
    clicks: 0,
    active: true
  },
  {
    id: 'travel_app',
    name: 'Travel Dating App',
    targetingSegments: ['travel_interest', 'premium'],
    targetingInterests: ['Travel', 'Photography', 'Adventure'],
    cpc: 0.40,
    impressions: 0,
    clicks: 0,
    active: true
  },
  {
    id: 'fitness_app',
    name: 'Fitness App',
    targetingSegments: ['fitness_interest', 'young_adult'],
    targetingInterests: ['Fitness', 'Sports', 'Yoga', 'Gym'],
    cpc: 0.25,
    impressions: 0,
    clicks: 0,
    active: true
  },
  {
    id: 'music_app',
    name: 'Music Streaming',
    targetingSegments: ['music_interest', 'active_user'],
    targetingInterests: ['Music', 'Concerts', 'Dancing'],
    cpc: 0.20,
    impressions: 0,
    clicks: 0,
    active: true
  },
  {
    id: 'food_app',
    name: 'Food & Dining App',
    targetingSegments: ['food_interest', 'all'],
    targetingInterests: ['Cooking', 'Food', 'Wine', 'Restaurants'],
    cpc: 0.25,
    impressions: 0,
    clicks: 0,
    active: true
  }
];

export class AdTargetingEngine {
  private userSegments: Map<string, string[]> = new Map();
  private engagementScores: Map<string, number> = new Map();

  async initialize() {
    console.log('Initializing Ad Targeting Engine...');
    await this.computeUserSegments();
    console.log(`Computed segments for ${this.userSegments.size} users`);
  }

  private async computeUserSegments() {
    const pool = getPool();
    
    const result = await pool.query(`
      SELECT 
        u.id,
        u.interests,
        u.age,
        COUNT(DISTINCT s.id) as swipe_count,
        COUNT(DISTINCT m.id) as message_count,
        COUNT(DISTINCT mt.id) as match_count,
        MAX(u.created_at) as last_active
      FROM users u
      LEFT JOIN swipes s ON s.swiper_id = u.id
      LEFT JOIN messages m ON m.sender_id = u.id
      LEFT JOIN matches mt ON mt.user1_id = u.id OR mt.user2_id = u.id
      GROUP BY u.id
    `);

    for (const row of result.rows) {
      const segments = this.computeSegments(row);
      this.userSegments.set(row.id, segments);
      
      const engagementScore = this.computeEngagementScore(row);
      this.engagementScores.set(row.id, engagementScore);
    }
  }

  private computeSegments(row: any): string[] {
    const segments: string[] = [];
    const interests = row.interests || [];
    const age = row.age;
    const swipeCount = parseInt(row.swipe_count) || 0;
    const matchCount = parseInt(row.match_count) || 0;
    const messageCount = parseInt(row.message_count) || 0;

    if (interests.includes('Travel')) segments.push('travel_interest');
    if (interests.includes('Fitness') || interests.includes('Sports')) segments.push('fitness_interest');
    if (interests.includes('Music') || interests.includes('Dancing')) segments.push('music_interest');
    if (interests.includes('Cooking') || interests.includes('Food')) segments.push('food_interest');
    if (interests.includes('Art') || interests.includes('Photography')) segments.push('creative_interest');

    if (age >= 18 && age <= 25) segments.push('young_adult');
    else if (age >= 26 && age <= 35) segments.push('mid_adult');
    else if (age >= 36 && age <= 50) segments.push('mature_adult');

    if (swipeCount > 100) segments.push('active_swiper');
    if (messageCount > 20) segments.push('active_user');
    if (matchCount > 5) segments.push('high_match_rate');
    if (matchCount < 2 && swipeCount > 50) segments.push('low_match_rate');

    if (swipeCount === 0) segments.push('new_user');
    else segments.push('returning_user');

    segments.push('all');
    return segments;
  }

  private computeEngagementScore(row: any): number {
    const swipeCount = parseInt(row.swipe_count) || 0;
    const messageCount = parseInt(row.message_count) || 0;
    const matchCount = parseInt(row.match_count) || 0;

    let score = 0;
    score += Math.min(swipeCount / 100, 1) * 30;
    score += Math.min(messageCount / 50, 1) * 40;
    score += Math.min(matchCount / 10, 1) * 30;

    return Math.min(100, score);
  }

  getUserSegments(userId: string): string[] {
    return this.userSegments.get(userId) || ['all'];
  }

  getEngagementScore(userId: string): number {
    return this.engagementScores.get(userId) || 0;
  }

  selectAd(userId: string, position: string): AdCampaign | null {
    const segments = this.getUserSegments(userId);
    const engagementScore = this.getEngagementScore(userId);
    
    const pool = getPool();
    const result = pool.query(
      `SELECT interests FROM users WHERE id = $1`,
      [userId]
    );
    const userInterests = result.rows[0]?.interests || [];

    let candidates = AD_CAMPAIGNS.filter(ad => {
      if (!ad.active) return false;
      
      const segmentMatch = ad.targetingSegments.some(s => segments.includes(s));
      if (!segmentMatch) return false;
      
      const interestMatch = ad.targetingInterests.length === 0 || 
        ad.targetingInterests.some(i => userInterests.includes(i));
      
      return segmentMatch;
    });

    if (candidates.length === 0) {
      candidates = AD_CAMPAIGNS.filter(ad => ad.active && ad.targetingSegments.includes('all'));
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      if (a.targetingInterests.length > 0 && b.targetingInterests.length === 0) return -1;
      if (b.targetingInterests.length > 0 && a.targetingInterests.length === 0) return 1;
      return b.cpc - a.cpc;
    });

    const selectedAd = candidates[0];
    selectedAd.impressions++;

    return selectedAd;
  }

  trackClick(adId: string) {
    const ad = AD_CAMPAIGNS.find(a => a.id === adId);
    if (ad) {
      ad.clicks++;
    }
  }

  getAdStats() {
    return AD_CAMPAIGNS.map(ad => ({
      id: ad.id,
      name: ad.name,
      impressions: ad.impressions,
      clicks: ad.clicks,
      ctr: ad.impressions > 0 ? (ad.clicks / ad.impressions * 100).toFixed(2) + '%' : '0%'
    }));
  }

  async refreshSegments() {
    await this.computeUserSegments();
  }
}

export const adTargetingEngine = new AdTargetingEngine();
import { getPool } from '../db/init';

interface UserFeatures {
  userId: string;
  demographic: {
    age: number;
    gender: string;
    location: { lat: number; lon: number } | null;
  };
  interests: {
    interestOverlap: number;
    sharedInterests: string[];
  };
  behavioral: {
    swipeRate: number;
    matchRate: number;
    responseRate: number;
    avgMessageLength: number;
  };
  profile: {
    photoCount: number;
    bioLength: number;
    completionScore: number;
    qualityScore: number;
  };
  popularity: {
    likesReceived: number;
    matchesCount: number;
    profileViews: number;
  };
  activity: {
    lastActive: Date;
    sessionDuration: number;
    dailySwipes: number;
  };
  computedAt: Date;
}

export class FeatureStoreService {
  private static instance: FeatureStoreService;
  private featureCache: Map<string, UserFeatures> = new Map();
  private cacheExpiry = 5 * 60 * 1000;

  static getInstance(): FeatureStoreService {
    if (!FeatureStoreService.instance) {
      FeatureStoreService.instance = new FeatureStoreService();
    }
    return FeatureStoreService.instance;
  }

  async initialize(): Promise<void> {
    console.log('Initializing Feature Store Service...');
    await this.createFeatureTable();
    console.log('Feature Store initialized');
  }

  private async createFeatureTable(): Promise<void> {
    const pool = getPool();
    
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ml_features (
          user_id UUID PRIMARY KEY,
          demographic JSONB,
          interests JSONB,
          behavioral JSONB,
          profile JSONB,
          popularity JSONB,
          activity JSONB,
          computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (error) {
      console.log('ML features table will be created when database is ready');
    }
  }

  async computeFeatures(userId: string): Promise<UserFeatures> {
    const pool = getPool();
    
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = userResult.rows[0];

    const [swipesResult, likesResult, matchesResult, messagesResult, profileViewsResult] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM swipes WHERE user_id = $1', [userId]),
      pool.query('SELECT COUNT(*) as count FROM likes WHERE liked_id = $1', [userId]),
      pool.query('SELECT COUNT(*) as count FROM matches WHERE user1_id = $1 OR user2_id = $1', [userId]),
      pool.query('SELECT AVG(LENGTH(text)) as avg_length, COUNT(*) as count FROM messages WHERE sender_id = $1', [userId]),
      pool.query('SELECT COUNT(*) as count FROM profile_views WHERE profile_id = $1', [userId])
    ]);

    const swipeCount = parseInt(swipesResult.rows[0]?.count || '0');
    const likesReceived = parseInt(likesResult.rows[0]?.count || '0');
    const matchCount = parseInt(matchesResult.rows[0]?.count || '0');
    const avgMessageLength = parseFloat(messagesResult.rows[0]?.avg_length || '0');
    const profileViews = parseInt(profileViewsResult.rows[0]?.count || '0');

    const features: UserFeatures = {
      userId,
      demographic: {
        age: user.age,
        gender: user.gender,
        location: user.latitude && user.longitude 
          ? { lat: parseFloat(user.latitude), lon: parseFloat(user.longitude) }
          : null
      },
      interests: {
        interestOverlap: 0.5,
        sharedInterests: []
      },
      behavioral: {
        swipeRate: swipeCount > 0 ? 1 : 0,
        matchRate: swipeCount > 0 ? matchCount / swipeCount : 0,
        responseRate: 0.5,
        avgMessageLength
      },
      profile: {
        photoCount: Array.isArray(user.images) ? user.images.length : 0,
        bioLength: user.bio ? user.bio.length : 0,
        completionScore: this.calculateCompletion(user),
        qualityScore: 0.5
      },
      popularity: {
        likesReceived,
        matchesCount: matchCount,
        profileViews
      },
      activity: {
        lastActive: user.last_active ? new Date(user.last_active) : new Date(),
        sessionDuration: 0,
        dailySwipes: swipeCount
      },
      computedAt: new Date()
    };

    this.featureCache.set(userId, features);
    await this.persistFeatures(userId, features);

    return features;
  }

  private calculateCompletion(user: any): number {
    let score = 0;
    if (user.name) score += 20;
    if (user.age) score += 20;
    if (user.bio && user.bio.length > 10) score += 20;
    if (user.images && user.images.length > 0) score += 20;
    if (user.interests && user.interests.length > 0) score += 20;
    return score / 100;
  }

  async getFeatures(userId: string, forceRefresh = false): Promise<UserFeatures> {
    if (!forceRefresh) {
      const cached = this.featureCache.get(userId);
      if (cached) {
        const age = Date.now() - cached.computedAt.getTime();
        if (age < this.cacheExpiry) {
          return cached;
        }
      }
    }

    try {
      return await this.computeFeatures(userId);
    } catch (error) {
      const cached = this.featureCache.get(userId);
      if (cached) return cached;
      
      return {
        userId,
        demographic: { age: 25, gender: 'male', location: null },
        interests: { interestOverlap: 0.5, sharedInterests: [] },
        behavioral: { swipeRate: 0, matchRate: 0, responseRate: 0.5, avgMessageLength: 0 },
        profile: { photoCount: 0, bioLength: 0, completionScore: 0, qualityScore: 0.5 },
        popularity: { likesReceived: 0, matchesCount: 0, profileViews: 0 },
        activity: { lastActive: new Date(), sessionDuration: 0, dailySwipes: 0 },
        computedAt: new Date()
      };
    }
  }

  async getFeaturesBatch(userIds: string[]): Promise<Map<string, UserFeatures>> {
    const results = new Map<string, UserFeatures>();
    
    await Promise.all(
      userIds.map(async (userId) => {
        const features = await this.getFeatures(userId);
        results.set(userId, features);
      })
    );

    return results;
  }

  private async persistFeatures(userId: string, features: UserFeatures): Promise<void> {
    const pool = getPool();
    
    try {
      await pool.query(
        `INSERT INTO ml_features (user_id, demographic, interests, behavioral, profile, popularity, activity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE SET 
           demographic = $2,
           interests = $3,
           behavioral = $4,
           profile = $5,
           popularity = $6,
           activity = $7,
           computed_at = CURRENT_TIMESTAMP`,
        [
          userId,
          JSON.stringify(features.demographic),
          JSON.stringify(features.interests),
          JSON.stringify(features.behavioral),
          JSON.stringify(features.profile),
          JSON.stringify(features.popularity),
          JSON.stringify(features.activity)
        ]
      );
    } catch (error) {
      console.error('Failed to persist features:', error);
    }
  }

  invalidateCache(userId: string): void {
    this.featureCache.delete(userId);
  }

  clearCache(): void {
    this.featureCache.clear();
  }

  getCacheStats(): { size: number; expiryMs: number } {
    return {
      size: this.featureCache.size,
      expiryMs: this.cacheExpiry
    };
  }
}

export const featureStore = FeatureStoreService.getInstance();

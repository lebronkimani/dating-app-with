import { getPool } from '../db/init';
import { locationService } from '../services/location';
import { embeddingService } from './embeddings';
import { twoTowerService } from './twoTowerMatching';
import { rlService } from './reinforcementLearning';

const INTEREST_WEIGHT = 2.0;
const LANGUAGE_WEIGHT = 1.5;
const LOCATION_WEIGHT = 1.0;
const AGE_WEIGHT = 0.8;

const EXPLORATION_RATIO = 0.2;
const MIN_SWIPES_FOR_COLLABORATIVE = 20;
const COLD_START_SWIPE_THRESHOLD = 50;

const POPULARITY_BOOST_THRESHOLD = 100;
const POPULARITY_PENALTY_FACTOR = 0.7;

const EMBEDDING_MATCHING_WEIGHT = 0.10;
const TWO_TOWER_WEIGHT = 0.10;
const RL_WEIGHT = 0.05;

interface UserFeatures {
  userId: string;
  interests: string[];
  languages: string[];
  age: number;
  location: { lat: number; lon: number } | null;
  swipeCount: number;
  matchRate: number;
  avgTimeOnProfile: number;
  profileCompletion: number;
  photoCount: number;
  bioLength: number;
  likesReceived: number;
  lastActive: Date | null;
}

interface CandidateScore {
  userId: string;
  score: number;
  mutualMatchScore: number;
  features: {
    interestOverlap: number;
    ageCompatibility: number;
    distanceScore: number;
    profileQuality: number;
    behavioralScore: number;
    collaborativeScore: number;
    mutualLikeProbability: number;
    popularityScore: number;
    activityScore: number;
  };
}

export class RecommendationEngine {
  private interestVectors: Map<string, number[]> = new Map();
  private userProfiles: Map<string, UserFeatures> = new Map();
  private swipeMatrix: Map<string, Set<string>> = new Map();
  private userSimilarityCache: Map<string, Map<string, number>> = new Map();
  private isInitialized = false;
  private lastUpdate: Date = new Date(0);

  async initialize() {
    if (this.isInitialized) return;
    
    console.log('Initializing ML Recommendation Engine...');
    await this.refreshData();
    this.isInitialized = true;
  }

  async refreshData() {
    const pool = getPool();
    
    const usersResult = await pool.query(
      `SELECT id, interests, languages, age, latitude, longitude, last_active FROM users`
    );

    const swipeCountsResult = await pool.query(
      `SELECT swiper_id, COUNT(*) as count FROM swipes GROUP BY swiper_id`
    );
    const swipeCounts = new Map(swipeCountsResult.rows.map(r => [r.swiper_id, parseInt(r.count)]));

    const likesReceivedResult = await pool.query(
      `SELECT liked_id, COUNT(*) as count FROM likes GROUP BY liked_id`
    );
    const likesReceived = new Map(likesReceivedResult.rows.map(r => [r.liked_id, parseInt(r.count)]));

    const matchRatesResult = await pool.query(
      `SELECT swiper_id, 
              COUNT(*) as total_swipes,
              COUNT(CASE WHEN direction = 'right' THEN 1 END) as likes,
              COUNT(CASE WHEN EXISTS (
                SELECT 1 FROM matches m 
                WHERE (m.user1_id = swipes.swiper_id AND m.user2_id = swipes.swiped_id)
                   OR (m.user1_id = swipes.swiped_id AND m.user2_id = swipes.swiper_id)
              ) THEN 1 END) as matches
       FROM swipes 
       GROUP BY swiper_id`
    );
    const matchRates = new Map(matchRatesResult.rows.map(r => [
      r.swiper_id, 
      parseInt(r.matches) / Math.max(parseInt(r.total_swipes), 1)
    ]));

    this.interestVectors.clear();
    this.userProfiles.clear();
    this.swipeMatrix.clear();

    for (const user of usersResult.rows) {
      const vector = this.createInterestVector(user.interests || [], user.languages || []);
      this.interestVectors.set(user.id, vector);
      
      const images = user.images || [];
      const photoCount = Array.isArray(images) ? images.length : 0;
      const bioLength = user.bio ? user.bio.length : 0;
      
      this.userProfiles.set(user.id, {
        userId: user.id,
        interests: user.interests || [],
        languages: user.languages || [],
        age: user.age,
        location: user.latitude && user.longitude 
          ? { lat: parseFloat(user.latitude), lon: parseFloat(user.longitude) }
          : null,
        swipeCount: swipeCounts.get(user.id) || 0,
        likesReceived: likesReceived.get(user.id) || 0,
        lastActive: user.last_active ? new Date(user.last_active) : null,
        matchRate: matchRates.get(user.id) || 0,
        avgTimeOnProfile: 0,
        profileCompletion: this.calculateProfileCompletion(user),
        photoCount,
        bioLength
      });
    }

    const swipesResult = await pool.query(
      `SELECT swiper_id, swiped_id, direction FROM swipes WHERE direction = 'right'`
    );
    
    for (const swipe of swipesResult.rows) {
      if (!this.swipeMatrix.has(swipe.swiper_id)) {
        this.swipeMatrix.set(swipe.swiper_id, new Set());
      }
      this.swipeMatrix.get(swipe.swiper_id)!.add(swipe.swiped_id);
    }

    console.log(`Loaded ${this.userProfiles.size} user profiles for ML`);
    this.lastUpdate = new Date();
  }

  private calculateProfileCompletion(user: any): number {
    let score = 0;
    if (user.name) score += 20;
    if (user.age) score += 20;
    if (user.bio && user.bio.length > 20) score += 20;
    if (user.images && user.images.length > 0) score += 20;
    if (user.interests && user.interests.length > 0) score += 20;
    return score / 100;
  }

  private createInterestVector(interests: string[], languages: string[]): number[] {
    const uniqueInterests = [
      'Travel', 'Photography', 'Cooking', 'Music', 'Movies', 'Gaming',
      'Reading', 'Fitness', 'Hiking', 'Dancing', 'Art', 'Fashion',
      'Technology', 'Sports', 'Yoga', 'Wine', 'Coffee', 'Pets', 'Crafts', 'Coding'
    ];
    
    const vector = new Array(uniqueInterests.length + 12).fill(0);
    
    for (const interest of interests) {
      const idx = uniqueInterests.indexOf(interest);
      if (idx !== -1) vector[idx] = INTEREST_WEIGHT;
    }
    
    const languageVector = [
      'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
      'Russian', 'Japanese', 'Chinese', 'Korean', 'Arabic', 'Hindi'
    ];
    
    for (const lang of languages) {
      const idx = languageVector.indexOf(lang);
      if (idx !== -1) vector[idx + uniqueInterests.length] = LANGUAGE_WEIGHT;
    }
    
    return vector;
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private ageCompatibility(age1: number, age2: number): number {
    const diff = Math.abs(age1 - age2);
    if (diff <= 3) return 1.0;
    if (diff <= 7) return 0.8;
    if (diff <= 12) return 0.5;
    return 0.2;
  }

  private distanceScore(distanceKm: number): number {
    if (distanceKm <= 5) return 1.0;
    if (distanceKm <= 15) return 0.9;
    if (distanceKm <= 30) return 0.7;
    if (distanceKm <= 50) return 0.5;
    if (distanceKm <= 100) return 0.3;
    return 0.1;
  }

  private profileQualityScore(profile: UserFeatures): number {
    const photoScore = Math.min(profile.photoCount / 5, 1) * 0.4;
    const bioScore = Math.min(profile.bioLength / 100, 1) * 0.3;
    const completionScore = profile.profileCompletion * 0.3;
    return photoScore + bioScore + completionScore;
  }

  private behavioralScore(profile: UserFeatures): number {
    if (profile.swipeCount < 10) return 0.5;
    if (profile.matchRate > 0.3) return 1.0;
    if (profile.matchRate > 0.15) return 0.7;
    return 0.4;
  }

  private calculateUserSimilarity(userId1: string, userId2: string): number {
    const cacheKey = userId1 < userId2 ? `${userId1}-${userId2}` : `${userId2}-${userId1}`;
    
    if (this.userSimilarityCache.has(cacheKey)) {
      return this.userSimilarityCache.get(cacheKey)!;
    }

    const swipes1 = this.swipeMatrix.get(userId1) || new Set();
    const swipes2 = this.swipeMatrix.get(userId2) || new Set();

    const intersection = new Set([...swipes1].filter(x => swipes2.has(x)));
    const union = new Set([...swipes1, ...swipes2]);

    const similarity = union.size > 0 ? intersection.size / union.size : 0;

    this.userSimilarityCache.set(cacheKey, similarity);
    return similarity;
  }

  private collaborativeFilteringScore(userId: string, candidateId: string): number {
    const userSwipes = this.swipeMatrix.get(userId);
    if (!userSwipes || userSwipes.size < MIN_SWIPES_FOR_COLLABORATIVE) {
      return 0;
    }

    let totalSimilarity = 0;
    let count = 0;

    for (const [otherUserId, otherSwipes] of this.swipeMatrix) {
      if (otherUserId === userId || otherUserId === candidateId) continue;
      
      if (otherSwipes.has(candidateId)) {
        const similarity = this.calculateUserSimilarity(userId, otherUserId);
        totalSimilarity += similarity;
        count++;
      }
    }

    return count > 0 ? totalSimilarity / Math.min(count, 10) : 0;
  }

  async getMatchProbability(userId: string, candidateId: string, userLocation?: { lat: number; lon: number }): Promise<CandidateScore> {
    const userProfile = this.userProfiles.get(userId);
    const candidateProfile = this.userProfiles.get(candidateId);

    if (!userProfile || !candidateProfile) {
      return {
        userId: candidateId,
        score: 0.5,
        mutualMatchScore: 0.5,
        features: {
          interestOverlap: 0,
          ageCompatibility: 0,
          distanceScore: 0,
          profileQuality: 0,
          behavioralScore: 0,
          collaborativeScore: 0,
          mutualLikeProbability: 0,
          popularityScore: 0,
          activityScore: 0
        }
      };
    }

    const userVector = this.interestVectors.get(userId);
    const candidateVector = this.interestVectors.get(candidateId);
    const interestOverlap = userVector && candidateVector 
      ? this.cosineSimilarity(userVector, candidateVector)
      : 0;

    const ageCompat = this.ageCompatibility(userProfile.age, candidateProfile.age);

    let distanceKm = 999999;
    if (userLocation && candidateProfile.location) {
      distanceKm = locationService.calculateDistance(
        userLocation,
        candidateProfile.location
      );
    }
    const distance = this.distanceScore(distanceKm);

    const profileQuality = this.profileQualityScore(candidateProfile);
    const behavioral = this.behavioralScore(candidateProfile);
    const collaborative = this.collaborativeFilteringScore(userId, candidateId);

    const mutualLikeProbability = await this.predictMutualLikeProbability(userId, candidateId);
    const popularityScore = this.popularityBalancingScore(candidateProfile);
    const activityScore = this.activityScore(candidateProfile);
    
    const embeddingScore = await this.getEmbeddingScore(userId, candidateId);
    
    const twoTowerScore = await this.getTwoTowerScore(userId, candidateId);
    
    const { score: rlScore } = rlService.calculateActionScore(userId, candidateId, 0.5);

    const weights = {
      interest: 0.15,
      age: 0.07,
      distance: 0.10,
      profileQuality: 0.08,
      behavioral: 0.05,
      collaborative: 0.08,
      mutualLike: 0.12,
      popularity: 0.05,
      activity: 0.05,
      embedding: 0.10,
      twoTower: 0.10,
      rl: 0.05
    };

    const rawScore = 
      interestOverlap * weights.interest +
      ageCompat * weights.age +
      distance * weights.distance +
      profileQuality * weights.profileQuality +
      behavioral * weights.behavioral +
      collaborative * weights.collaborative +
      mutualLikeProbability * weights.mutualLike +
      popularityScore * weights.popularity +
      activityScore * weights.activity +
      embeddingScore * weights.embedding +
      twoTowerScore * weights.twoTower +
      rlScore * weights.rl;

    const score = Math.min(0.95, Math.max(0.05, rawScore));

    return {
      userId: candidateId,
      score,
      mutualMatchScore: mutualLikeProbability * score,
      features: {
        interestOverlap,
        ageCompatibility: ageCompat,
        distanceScore: distance,
        profileQuality,
        behavioralScore: behavioral,
        collaborativeScore: collaborative,
        mutualLikeProbability,
        popularityScore,
        activityScore
      }
    };
  }

  private async getTwoTowerScore(userId: string, candidateId: string): Promise<number> {
    try {
      return await twoTowerService.getCompatibilityScore(userId, candidateId);
    } catch (error) {
      console.error('Two tower score error:', error);
      return 0.5;
    }
  }

  private async predictMutualLikeProbability(userId: string, candidateId: string): Promise<number> {
    const candidateSwipes = this.swipeMatrix.get(candidateId);
    if (!candidateSwipes || candidateSwipes.size < MIN_SWIPES_FOR_COLLABORATIVE) {
      return 0.5;
    }

    let similarUserCount = 0;
    let likedBySimilar = 0;

    const userSwipes = this.swipeMatrix.get(userId);
    if (!userSwipes) return 0.5;

    for (const [otherUserId, otherSwipes] of this.swipeMatrix) {
      if (otherUserId === userId || otherUserId === candidateId) continue;

      const intersection = [...userSwipes].filter(x => otherSwipes.has(x));
      if (intersection.length > 0) {
        similarUserCount++;
        if (otherSwipes.has(userId)) {
          likedBySimilar++;
        }
      }
    }

    if (similarUserCount === 0) return 0.5;
    return likedBySimilar / Math.min(similarUserCount, 20);
  }

  private popularityBalancingScore(profile: UserFeatures): number {
    const likesReceived = profile.likesReceived;
    
    if (likesReceived < 10) {
      return 1.0 + (10 - likesReceived) / 100;
    }
    
    if (likesReceived > POPULARITY_BOOST_THRESHOLD) {
      return POPULARITY_PENALTY_FACTOR;
    }
    
    return 1.0;
  }

  private activityScore(profile: UserFeatures): number {
    if (!profile.lastActive) return 0.5;
    
    const hoursSinceActive = (Date.now() - profile.lastActive.getTime()) / (1000 * 60 * 60);
    
    if (hoursSinceActive < 1) return 1.0;
    if (hoursSinceActive < 24) return 0.9;
    if (hoursSinceActive < 72) return 0.7;
    if (hoursSinceActive < 168) return 0.5;
    return 0.3;
  }

  private async getEmbeddingScore(userId: string, candidateId: string): Promise<number> {
    try {
      const score = await embeddingService.computeCompatibilityScore(userId, candidateId);
      return score;
    } catch (error) {
      console.error('Embedding score error:', error);
      return 0.5;
    }
  }

  async updateEmbeddingFromSwipe(userId: string, targetId: string, action: 'like' | 'dislike' | 'superlike'): Promise<void> {
    try {
      await embeddingService.updateEmbeddingFromSwipe(userId, targetId, action);
    } catch (error) {
      console.error('Update embedding error:', error);
    }
  }

  async findSimilarUsersByEmbedding(userId: string, limit: number = 10): Promise<{ userId: string; similarity: number }[]> {
    try {
      return await embeddingService.findSimilarUsers(userId, limit);
    } catch (error) {
      console.error('Find similar users error:', error);
      return [];
    }
  }

  async findNearestNeighborsByEmbedding(userId: string, candidateIds: string[], limit: number = 20): Promise<{ userId: string; distance: number }[]> {
    try {
      return await embeddingService.findNearestNeighbors(userId, candidateIds, limit);
    } catch (error) {
      console.error('Find nearest neighbors error:', error);
      return candidateIds.slice(0, limit).map(id => ({ userId: id, distance: 1 }));
    }
  }

  isColdStart(userId: string): boolean {
    const profile = this.userProfiles.get(userId);
    return !profile || profile.swipeCount < COLD_START_SWIPE_THRESHOLD;
  }

  coldStartRanking(userId: string, candidates: UserFeatures[]): CandidateScore[] {
    const userProfile = this.userProfiles.get(userId);
    
    return candidates.map(candidate => {
      let score = 0.5;
      let distanceScore = 0;

      if (userProfile && candidate.location && userProfile.location) {
        const distanceKm = locationService.calculateDistance(
          userProfile.location,
          candidate.location
        );
        distanceScore = this.distanceScore(distanceKm);
        score += distanceScore * 0.25;
      }

      if (userProfile) {
        score += this.ageCompatibility(userProfile.age, candidate.age) * 0.15;
      }

      score += this.profileQualityScore(candidate) * 0.25;

      const activity = this.activityScore(candidate);
      score += activity * 0.15;

      const popularity = this.popularityBalancingScore(candidate);
      score += popularity * 0.1;

      const interestOverlap = userProfile 
        ? this.calculateInterestOverlap(userProfile.interests, candidate.interests)
        : 0;
      score += interestOverlap * 0.1;

      return {
        userId: candidate.userId,
        score: Math.min(0.9, score),
        mutualMatchScore: 0.5,
        features: {
          interestOverlap,
          ageCompatibility: userProfile ? this.ageCompatibility(userProfile.age, candidate.age) : 0,
          distanceScore,
          profileQuality: this.profileQualityScore(candidate),
          behavioralScore: 0,
          collaborativeScore: 0,
          mutualLikeProbability: 0.5,
          popularityScore: popularity,
          activityScore: activity
        }
      };
    });
  }

  private calculateInterestOverlap(interests1: string[], interests2: string[]): number {
    const set1 = new Set(interests1.map(i => i.toLowerCase()));
    const set2 = new Set(interests2.map(i => i.toLowerCase()));
    const intersection = [...set1].filter(x => set2.has(x));
    const union = new Set([...set1, ...set2]);
    return union.size > 0 ? intersection.length / union.size : 0;
  }

  async rankCandidates(
    userId: string, 
    candidateIds: string[],
    userLocation?: { lat: number; lon: number }
  ): Promise<CandidateScore[]> {
    const isColdStart = this.isColdStart(userId);
    
    let scoredCandidates: CandidateScore[];

    if (isColdStart) {
      const candidateProfiles = candidateIds
        .map(id => this.userProfiles.get(id))
        .filter((p): p is UserFeatures => p !== undefined);
      
      scoredCandidates = this.coldStartRanking(userId, candidateProfiles);
    } else {
      scoredCandidates = await Promise.all(
        candidateIds.map(candidateId => 
          this.getMatchProbability(userId, candidateId, userLocation)
        )
      );
    }

    const [highScore, random] = this.explorationExploitationSplit(scoredCandidates);
    
    return [...highScore, ...random];
  }

  private explorationExploitationSplit(candidates: CandidateScore[]): [CandidateScore[], CandidateScore[]] {
    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    
    const exploitCount = Math.floor(sorted.length * (1 - EXPLORATION_RATIO));
    const exploit = sorted.slice(0, exploitCount);
    const explore = sorted.slice(exploitCount);
    
    const shuffledExplore = explore.sort(() => Math.random() - 0.5);
    
    return [exploit, shuffledExplore];
  }

  async findSimilarUsers(userId: string, limit: number = 10): Promise<{ userId: string; similarity: number }[]> {
    await this.initialize();
    
    const userVector = this.interestVectors.get(userId);
    const userProfile = this.userProfiles.get(userId);
    
    if (!userVector || !userProfile) {
      return [];
    }

    const swipedResult = (await getPool().query(
      `SELECT swiped_id FROM swipes WHERE swiper_id = $1`,
      [userId]
    ));
    const swipedIds = new Set(swipedResult.rows.map(r => r.swiped_id));

    const similarities: { userId: string; similarity: number }[] = [];
    
    for (const [otherUserId, vector] of this.interestVectors) {
      if (otherUserId === userId || swipedIds.has(otherUserId)) continue;
      
      const otherProfile = this.userProfiles.get(otherUserId);
      if (!otherProfile) continue;
      
      const interestSim = this.cosineSimilarity(userVector, vector);
      const ageSim = this.ageCompatibility(userProfile.age, otherProfile.age);
      
      const similarity = (interestSim * 0.7) + (ageSim * 0.3);
      
      if (similarity > 0.1) {
        similarities.push({ userId: otherUserId, similarity });
      }
    }
    
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async predictMatchProbability(userId1: string, userId2: string): Promise<number> {
    await this.initialize();
    
    const result = await this.getMatchProbability(userId1, userId2);
    return result.score;
  }

  rankUsersForDiscovery(userId: string, candidateIds: string[]): string[] {
    const userVector = this.interestVectors.get(userId);
    const userProfile = this.userProfiles.get(userId);
    
    if (!userVector || !userProfile) {
      return candidateIds;
    }
    
    const scored = candidateIds.map(candidateId => {
      const vector = this.interestVectors.get(candidateId);
      const profile = this.userProfiles.get(candidateId);
      
      if (!vector || !profile) {
        return { id: candidateId, score: 0 };
      }
      
      const interestScore = this.cosineSimilarity(userVector, vector);
      const ageScore = this.ageCompatibility(userProfile.age, profile.age);
      
      return {
        id: candidateId,
        score: (interestScore * 0.7) + (ageScore * 0.3)
      };
    });
    
    return scored
      .sort((a, b) => b.score - a.score)
      .map(s => s.id);
  }

  getUserEngagementScore(userId: string): number {
    const profile = this.userProfiles.get(userId);
    if (!profile) return 0.5;

    const swipeActivity = Math.min(profile.swipeCount / 200, 1) * 0.4;
    const matchQuality = profile.matchRate * 0.4;
    const profileComplete = profile.profileCompletion * 0.2;

    return swipeActivity + matchQuality + profileComplete;
  }

  needsRefresh(): boolean {
    const hoursSinceUpdate = (Date.now() - this.lastUpdate.getTime()) / (1000 * 60 * 60);
    return hoursSinceUpdate > 1;
  }
}

export const recommendationEngine = new RecommendationEngine();

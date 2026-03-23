import { getPool } from '../db/init';

const EMBEDDING_DIMENSION = 128;
const NEGATIVE_SAMPLES = 5;
const GRAPH_DEPTH = 3;

interface UserFeatures {
  id: string;
  age: number;
  interests: string[];
  location: { lat: number; lon: number } | null;
  profileScore: number;
  matchRate: number;
  activityScore: number;
}

interface UserTowerOutput {
  userId: string;
  embedding: number[];
}

interface CandidateTowerOutput {
  candidateId: string;
  embedding: number[];
}

interface TrainingSample {
  userId: string;
  candidateId: string;
  label: number;
}

interface GraphNode {
  userId: string;
  neighbors: Map<string, number>;
}

export class TwoTowerMatchingService {
  private static instance: TwoTowerMatchingService;
  private userTower: Map<string, number[]> = new Map();
  private candidateTower: Map<string, number[]> = new Map();
  private likeGraph: Map<string, GraphNode> = new Map();
  private isInitialized = false;

  static getInstance(): TwoTowerMatchingService {
    if (!TwoTowerMatchingService.instance) {
      TwoTowerMatchingService.instance = new TwoTowerMatchingService();
    }
    return TwoTowerMatchingService.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    console.log('Initializing Two-Tower Matching Service...');
    await this.buildUserTower();
    await this.buildCandidateTower();
    await this.buildLikeGraph();
    this.isInitialized = true;
  }

  private async buildUserTower(): Promise<void> {
    const pool = getPool();
    
    const usersResult = await pool.query(
      `SELECT id, age, interests, last_active FROM users`
    );

    const swipeStats = await pool.query(
      `SELECT user_id, 
              COUNT(*) as swipe_count,
              COUNT(CASE WHEN EXISTS (
                SELECT 1 FROM matches m 
                WHERE (m.user1_id = swipes.user_id AND m.user2_id = swipes.target_user_id)
                   OR (m.user1_id = swipes.target_user_id AND m.user2_id = swipes.user_id)
              ) THEN 1 END) as match_count
       FROM swipes GROUP BY user_id`
    );

    const statsMap = new Map(swipeStats.rows.map(r => [
      r.user_id,
      {
        swipeCount: parseInt(r.swipe_count),
        matchCount: parseInt(r.match_count)
      }
    ]));

    for (const user of usersResult.rows) {
      const stats = statsMap.get(user.id) || { swipeCount: 0, matchCount: 0 };
      const embedding = this.computeUserTowerEmbedding(user, stats);
      this.userTower.set(user.id, embedding);
    }

    console.log(`Built user tower with ${this.userTower.size} embeddings`);
  }

  private computeUserTowerEmbedding(user: any, stats: { swipeCount: number; matchCount: number }): number[] {
    const embedding = new Array(EMBEDDING_DIMENSION).fill(0);

    embedding[0] = user.age / 100;
    
    const interestHash = this.hashInterests(user.interests || []);
    for (let i = 0; i < 20; i++) {
      embedding[i + 1] = ((interestHash >> i) & 1) ? 1 : 0;
    }

    embedding[21] = Math.min(stats.swipeCount / 1000, 1);
    embedding[22] = stats.matchCount / Math.max(stats.swipeCount, 1);
    
    const activityHours = user.last_active 
      ? (Date.now() - new Date(user.last_active).getTime()) / (1000 * 60 * 60)
      : 168;
    embedding[23] = Math.max(0, 1 - activityHours / 168);

    for (let i = 24; i < EMBEDDING_DIMENSION; i++) {
      embedding[i] = (Math.sin(i * 13.37) + 1) / 2;
    }

    this.normalize(embedding);
    return embedding;
  }

  private async buildCandidateTower(): Promise<void> {
    const pool = getPool();
    
    const candidatesResult = await pool.query(
      `SELECT id, age, interests, latitude, longitude, images, bio
       FROM users`
    );

    for (const candidate of candidatesResult.rows) {
      const embedding = this.computeCandidateTowerEmbedding(candidate);
      this.candidateTower.set(candidate.id, embedding);
    }

    console.log(`Built candidate tower with ${this.candidateTower.size} embeddings`);
  }

  private computeCandidateTowerEmbedding(candidate: any): number[] {
    const embedding = new Array(EMBEDDING_DIMENSION).fill(0);

    embedding[0] = candidate.age / 100;

    const interestHash = this.hashInterests(candidate.interests || []);
    for (let i = 0; i < 20; i++) {
      embedding[i + 1] = ((interestHash >> i) & 1) ? 1 : 0;
    }

    const photoCount = Array.isArray(candidate.images) ? candidate.images.length : 0;
    embedding[21] = photoCount / 5;

    const bioLength = candidate.bio ? candidate.bio.length : 0;
    embedding[22] = Math.min(bioLength / 200, 1);

    for (let i = 23; i < EMBEDDING_DIMENSION; i++) {
      embedding[i] = (Math.cos(i * 7.89) + 1) / 2;
    }

    this.normalize(embedding);
    return embedding;
  }

  private hashInterests(interests: string[]): number {
    let hash = 0;
    for (const interest of interests) {
      for (let i = 0; i < interest.length; i++) {
        hash = ((hash << 5) - hash) + interest.charCodeAt(i);
        hash |= 0;
      }
    }
    return Math.abs(hash);
  }

  private normalize(vector: number[]): void {
    let magnitude = 0;
    for (const val of vector) {
      magnitude += val * val;
    }
    magnitude = Math.sqrt(magnitude);
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }
  }

  private async buildLikeGraph(): Promise<void> {
    const pool = getPool();
    
    const likesResult = await pool.query(
      `SELECT liker_id, liked_id FROM likes`
    );

    for (const like of likesResult.rows) {
      if (!this.likeGraph.has(like.liker_id)) {
        this.likeGraph.set(like.liker_id, {
          userId: like.liker_id,
          neighbors: new Map()
        });
      }
      this.likeGraph.get(like.liker_id)!.neighbors.set(like.liked_id, 1);
    }

    console.log(`Built like graph with ${this.likeGraph.size} nodes`);
  }

  computeSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0;
    
    let dotProduct = 0;
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
    }
    return (dotProduct + 1) / 2;
  }

  async getCompatibilityScore(userId: string, candidateId: string): Promise<number> {
    const userEmbedding = this.userTower.get(userId);
    const candidateEmbedding = this.candidateTower.get(candidateId);

    if (!userEmbedding || !candidateEmbedding) {
      return 0.5;
    }

    const towerScore = this.computeSimilarity(userEmbedding, candidateEmbedding);
    
    const graphScore = this.getGraphScore(userId, candidateId);
    
    const finalScore = (towerScore * 0.7) + (graphScore * 0.3);
    
    return Math.min(0.95, Math.max(0.05, finalScore));
  }

  private getGraphScore(userId: string, candidateId: string): number {
    const userNode = this.likeGraph.get(userId);
    if (!userNode) return 0.5;

    let pathScore = 0;
    let pathCount = 0;

    for (const [neighborId] of userNode.neighbors) {
      const neighborNode = this.likeGraph.get(neighborId);
      if (neighborNode && neighborNode.neighbors.has(candidateId)) {
        pathScore += 1;
      }
      pathCount++;
    }

    if (pathCount === 0) return 0.5;
    
    const baseScore = pathScore / Math.min(pathCount, 10);
    return baseScore * 0.8 + 0.1;
  }

  async predictMutualLike(userId: string, candidateId: string): Promise<number> {
    const pool = getPool();
    
    const userLikesResult = await pool.query(
      `SELECT liked_id FROM likes WHERE liker_id = $1`,
      [userId]
    );
    const userLikes = new Set(userLikesResult.rows.map(r => r.liked_id));

    const similarUsersResult = await pool.query(
      `SELECT DISTINCT l2.liker_id 
       FROM likes l1
       JOIN likes l2 ON l1.liked_id = l2.liked_id
       WHERE l1.liker_id = $1 AND l2.liker_id != $1
       LIMIT 20`,
      [userId]
    );

    let likesCandidate = 0;
    let similarUserCount = 0;

    for (const row of similarUsersResult.rows) {
      const similarUserLikesResult = await pool.query(
        `SELECT liked_id FROM likes WHERE liker_id = $1`,
        [row.liker_id]
      );
      
      similarUserCount++;
      if (similarUserLikesResult.rows.some(r => r.liked_id === candidateId)) {
        likesCandidate++;
      }
    }

    if (similarUserCount === 0) return 0.5;
    
    return Math.min(0.9, likesCandidate / similarUserCount);
  }

  async generateNegativeSamples(userId: string, positiveCandidates: string[]): Promise<string[]> {
    const pool = getPool();
    
    const swipedResult = await pool.query(
      `SELECT swiped_id FROM swipes WHERE swiper_id = $1`,
      [userId]
    );
    const swipedIds = new Set(swipedResult.rows.map(r => r.swiped_id));

    const allUsersResult = await pool.query(
      `SELECT id FROM users WHERE id != $1 LIMIT 100`,
      [userId]
    );

    const candidates: string[] = [];
    const shuffled = allUsersResult.rows
      .map(r => r.id)
      .filter(id => id !== userId && !swipedIds.has(id) && !positiveCandidates.includes(id))
      .sort(() => Math.random() - 0.5);

    return shuffled.slice(0, NEGATIVE_SAMPLES);
  }

  async trainOnSwipe(userId: string, candidateId: string, action: 'like' | 'dislike' | 'superlike'): Promise<void> {
    const userEmbedding = this.userTower.get(userId);
    const candidateEmbedding = this.candidateTower.get(candidateId);

    if (!userEmbedding || !candidateEmbedding) return;

    const label = action === 'like' ? 1 : action === 'superlike' ? 1 : 0;
    const learningRate = 0.01;

    for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
      const error = label - userEmbedding[i];
      userEmbedding[i] += learningRate * error * candidateEmbedding[i];
    }

    this.normalize(userEmbedding);
    this.userTower.set(userId, userEmbedding);
  }

  async findSimilarFromGraph(userId: string, depth: number = GRAPH_DEPTH): Promise<string[]> {
    const similar: Set<string> = new Set();
    const queue: { userId: string; currentDepth: number }[] = [{ userId, currentDepth: 0 }];
    const visited: Set<string> = new Set([userId]);

    while (queue.length > 0) {
      const { userId: currentId, currentDepth } = queue.shift()!;
      
      if (currentDepth >= depth) continue;

      const node = this.likeGraph.get(currentId);
      if (!node) continue;

      for (const [neighborId] of node.neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          if (neighborId !== userId) {
            similar.add(neighborId);
          }
          queue.push({ userId: neighborId, currentDepth: currentDepth + 1 });
        }
      }
    }

    return Array.from(similar).slice(0, 20);
  }

  getStats(): {
    userTowerSize: number;
    candidateTowerSize: number;
    graphNodes: number;
    initialized: boolean;
  } {
    return {
      userTowerSize: this.userTower.size,
      candidateTowerSize: this.candidateTower.size,
      graphNodes: this.likeGraph.size,
      initialized: this.isInitialized
    };
  }
}

export const twoTowerService = TwoTowerMatchingService.getInstance();

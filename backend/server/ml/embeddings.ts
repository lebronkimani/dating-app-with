import { getPool } from '../db/init';

const EMBEDDING_DIMENSION = 64;
const LEARNING_RATE = 0.01;

interface UserEmbedding {
  userId: string;
  vector: number[];
  generatedAt: Date;
}

interface SwipeInteraction {
  userId: string;
  targetId: string;
  action: 'like' | 'dislike' | 'superlike';
  timestamp: Date;
}

export class EmbeddingService {
  private static instance: EmbeddingService;
  private embeddings: Map<string, UserEmbedding> = new Map();
  private isInitialized = false;

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    console.log('Initializing Embedding Service...');
    await this.generateAllEmbeddings();
    this.isInitialized = true;
  }

  async generateAllEmbeddings(): Promise<void> {
    const pool = getPool();
    
    const usersResult = await pool.query('SELECT id FROM users');
    const userIds = usersResult.rows.map(r => r.id);

    const interactions = await this.getSwipeInteractions();

    for (const userId of userIds) {
      const embedding = this.generateUserEmbedding(userId, interactions);
      this.embeddings.set(userId, {
        userId,
        vector: embedding,
        generatedAt: new Date()
      });
    }

    console.log(`Generated ${this.embeddings.size} user embeddings`);
  }

  private async getSwipeInteractions(): Promise<Map<string, SwipeInteraction[]>> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT user_id, target_user_id, action, created_at 
       FROM swipes 
       ORDER BY created_at DESC 
       LIMIT 10000`
    );

    const interactions = new Map<string, SwipeInteraction[]>();
    
    for (const row of result.rows) {
      if (!interactions.has(row.user_id)) {
        interactions.set(row.user_id, []);
      }
      interactions.get(row.user_id)!.push({
        userId: row.user_id,
        targetId: row.target_user_id,
        action: row.action as 'like' | 'dislike' | 'superlike',
        timestamp: new Date(row.created_at)
      });
    }

    return interactions;
  }

  private generateUserEmbedding(userId: string, interactions: Map<string, SwipeInteraction[]>): number[] {
    const embedding = new Array(EMBEDDING_DIMENSION).fill(0);
    
    const userInteractions = interactions.get(userId) || [];
    
    const likeIndices: number[] = [];
    const dislikeIndices: number[] = [];
    
    userInteractions.forEach((interaction, idx) => {
      if (interaction.action === 'like' || interaction.action === 'superlike') {
        likeIndices.push(idx % EMBEDDING_DIMENSION);
      } else {
        dislikeIndices.push(idx % EMBEDDING_DIMENSION);
      }
    });

    for (const idx of likeIndices) {
      embedding[idx] += 0.3;
    }
    
    for (const idx of dislikeIndices) {
      embedding[idx] -= 0.1;
    }

    this.normalizeVector(embedding);

    return embedding;
  }

  private normalizeVector(vector: number[]): void {
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

  getEmbedding(userId: string): number[] | null {
    const embedding = this.embeddings.get(userId);
    return embedding ? embedding.vector : null;
  }

  cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0;
    
    let dotProduct = 0;
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
    }
    
    return dotProduct;
  }

  async findSimilarUsers(userId: string, limit: number = 10): Promise<{ userId: string; similarity: number }[]> {
    const userEmbedding = this.embeddings.get(userId);
    if (!userEmbedding) return [];

    const similarities: { userId: string; similarity: number }[] = [];

    for (const [otherUserId, embedding] of this.embeddings) {
      if (otherUserId === userId) continue;
      
      const similarity = this.cosineSimilarity(userEmbedding.vector, embedding.vector);
      similarities.push({ userId: otherUserId, similarity });
    }

    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async findNearestNeighbors(
    userId: string, 
    candidateIds: string[], 
    limit: number = 20
  ): Promise<{ userId: string; distance: number }[]> {
    const userEmbedding = this.embeddings.get(userId);
    if (!userEmbedding) {
      return candidateIds.slice(0, limit).map(id => ({ userId: id, distance: 1 }));
    }

    const candidates: { userId: string; distance: number }[] = [];

    for (const candidateId of candidateIds) {
      const candidateEmbedding = this.embeddings.get(candidateId);
      if (!candidateEmbedding) continue;

      const similarity = this.cosineSimilarity(userEmbedding.vector, candidateEmbedding.vector);
      const distance = 1 - similarity;
      candidates.push({ userId: candidateId, distance });
    }

    return candidates
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

  async computeCompatibilityScore(userId1: string, userId2: string): Promise<number> {
    const embedding1 = this.embeddings.get(userId1);
    const embedding2 = this.embeddings.get(userId2);

    if (!embedding1 || !embedding2) {
      return 0.5;
    }

    const similarity = this.cosineSimilarity(embedding1.vector, embedding2.vector);
    
    return Math.min(0.95, Math.max(0.05, (similarity + 1) / 2));
  }

  async updateEmbeddingFromSwipe(
    userId: string, 
    targetId: string, 
    action: 'like' | 'dislike' | 'superlike'
  ): Promise<void> {
    const embedding = this.embeddings.get(userId);
    if (!embedding) return;

    const targetEmbedding = this.embeddings.get(targetId);
    if (!targetEmbedding) return;

    const weight = action === 'superlike' ? 0.5 : action === 'like' ? 0.3 : -0.1;

    for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
      embedding.vector[i] += weight * targetEmbedding.vector[i] * LEARNING_RATE;
    }

    this.normalizeVector(embedding.vector);

    embedding.generatedAt = new Date();
  }

  getEmbeddingStats(): { totalEmbeddings: number; dimension: number; initialized: boolean } {
    return {
      totalEmbeddings: this.embeddings.size,
      dimension: EMBEDDING_DIMENSION,
      initialized: this.isInitialized
    };
  }
}

export const embeddingService = EmbeddingService.getInstance();

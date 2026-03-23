import { getPool } from '../db/init';

interface VectorIndex {
  userId: string;
  embeddings: number[][];
  metadata: Record<string, any>;
}

interface SearchResult {
  userId: string;
  score: number;
  metadata?: Record<string, any>;
}

export class VectorDatabaseService {
  private static instance: VectorDatabaseService;
  private indices: Map<string, VectorIndex> = new Map();
  private dimension = 128;

  static getInstance(): VectorDatabaseService {
    if (!VectorDatabaseService.instance) {
      VectorDatabaseService.instance = new VectorDatabaseService();
    }
    return VectorDatabaseService.instance;
  }

  async initialize(): Promise<void> {
    console.log('Initializing Vector Database Service...');
    
    await this.loadFromDatabase();
    
    console.log(`Vector Database initialized with ${this.indices.size} indices`);
  }

  private async loadFromDatabase(): Promise<void> {
    const pool = getPool();
    
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS vector_embeddings (
          user_id UUID PRIMARY KEY,
          embedding_vector DOUBLE PRECISION[],
          metadata JSONB,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const result = await pool.query('SELECT user_id, embedding_vector, metadata FROM vector_embeddings');
      
      for (const row of result.rows) {
        this.indices.set(row.user_id, {
          userId: row.user_id,
          embeddings: [row.embedding_vector || []],
          metadata: row.metadata || {}
        });
      }
    } catch (error) {
      console.log('Vector embeddings table will be created when database is ready');
    }
  }

  async upsert(userId: string, embedding: number[], metadata: Record<string, any> = {}): Promise<void> {
    this.indices.set(userId, {
      userId,
      embeddings: [embedding],
      metadata
    });

    await this.persistEmbedding(userId, embedding, metadata);
  }

  async upsertBatch(embeddings: { userId: string; embedding: number[]; metadata?: Record<string, any> }[]): Promise<void> {
    for (const { userId, embedding, metadata } of embeddings) {
      this.indices.set(userId, {
        userId,
        embeddings: [embedding],
        metadata: metadata || {}
      });
    }

    const pool = getPool();
    try {
      for (const { userId, embedding, metadata } of embeddings) {
        await pool.query(
          `INSERT INTO vector_embeddings (user_id, embedding_vector, metadata)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET 
             embedding_vector = $2,
             metadata = $3,
             updated_at = CURRENT_TIMESTAMP`,
          [userId, embedding, JSON.stringify(metadata || {})]
        );
      }
    } catch (error) {
      console.error('Failed to batch persist embeddings:', error);
    }
  }

  private async persistEmbedding(userId: string, embedding: number[], metadata: Record<string, any>): Promise<void> {
    const pool = getPool();
    try {
      await pool.query(
        `INSERT INTO vector_embeddings (user_id, embedding_vector, metadata)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET 
           embedding_vector = $2,
           metadata = $3,
           updated_at = CURRENT_TIMESTAMP`,
        [userId, embedding, JSON.stringify(metadata)]
      );
    } catch (error) {
      console.error('Failed to persist embedding:', error);
    }
  }

  async search(queryVector: number[], topK: number = 10, filter?: (userId: string) => boolean): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const [userId, index] of this.indices) {
      if (filter && !filter(userId)) continue;

      const embedding = index.embeddings[0];
      if (!embedding || embedding.length === 0) continue;

      const score = this.cosineSimilarity(queryVector, embedding);
      results.push({
        userId,
        score,
        metadata: index.metadata
      });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async searchByUserId(userId: string, topK: number = 10): Promise<SearchResult[]> {
    const index = this.indices.get(userId);
    if (!index || !index.embeddings[0]) {
      return [];
    }

    return this.search(index.embeddings[0], topK, (id) => id !== userId);
  }

  async delete(userId: string): Promise<void> {
    this.indices.delete(userId);
    
    const pool = getPool();
    try {
      await pool.query('DELETE FROM vector_embeddings WHERE user_id = $1', [userId]);
    } catch (error) {
      console.error('Failed to delete embedding:', error);
    }
  }

  async get(userId: string): Promise<number[] | null> {
    const index = this.indices.get(userId);
    return index ? index.embeddings[0] : null;
  }

  async getMetadata(userId: string): Promise<Record<string, any> | null> {
    const index = this.indices.get(userId);
    return index ? index.metadata : null  ;
  }

  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0;
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    return denominator > 0 ? dotProduct / denominator : 0;
  }

  getStats(): { totalVectors: number; dimension: number } {
    return {
      totalVectors: this.indices.size,
      dimension: this.dimension
    };
  }
}

export const vectorDb = VectorDatabaseService.getInstance();

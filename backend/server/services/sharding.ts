import { getPool } from '../db/init';

interface ShardConfig {
  shardId: number;
  startUserId: number;
  endUserId: number;
  host: string;
}

export class DatabaseShardingService {
  private shards: ShardConfig[] = [];
  private readonly SHARD_COUNT = 4;

  initialize() {
    this.shards = Array.from({ length: this.SHARD_COUNT }, (_, i) => ({
      shardId: i,
      startUserId: i * 2500000,
      endUserId: (i + 1) * 2500000 - 1,
      host: process.env[`DB_HOST_SHARD_${i}`] || process.env.DB_HOST || 'localhost'
    }));
    
    console.log(`Database sharding initialized with ${this.SHARD_COUNT} shards`);
  }

  getShardForUserId(userId: string): ShardConfig {
    const numericId = this.hashUserId(userId);
    const shardIndex = numericId % this.SHARD_COUNT;
    return this.shards[shardIndex];
  }

  getShardForUserIdNumeric(numericId: number): ShardConfig {
    const shardIndex = numericId % this.SHARD_COUNT;
    return this.shards[shardIndex];
  }

  private hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  getAllShards(): ShardConfig[] {
    return this.shards;
  }

  async getShardStats(): Promise<Record<number, { userCount: number; matchCount: number; messageCount: number }>> {
    const pool = getPool();
    const stats: Record<number, any> = {};

    for (const shard of this.shards) {
      try {
        const [userCount, matchCount, messageCount] = await Promise.all([
          pool.query('SELECT COUNT(*) as count FROM users'),
          pool.query('SELECT COUNT(*) as count FROM matches'),
          pool.query('SELECT COUNT(*) as count FROM messages')
        ]);

        stats[shard.shardId] = {
          userCount: parseInt(userCount.rows[0].count),
          matchCount: parseInt(matchCount.rows[0].count),
          messageCount: parseInt(messageCount.rows[0].count)
        };
      } catch (error) {
        console.error(`Error getting stats for shard ${shard.shardId}:`, error);
        stats[shard.shardId] = { userCount: 0, matchCount: 0, messageCount: 0 };
      }
    }

    return stats;
  }

  async rebalanceShards(): Promise<void> {
    const pool = getPool();
    const totalUsers = await pool.query('SELECT COUNT(*) as count FROM users');
    const usersPerShard = Math.ceil(parseInt(totalUsers.rows[0].count) / this.SHARD_COUNT);

    console.log(`Rebalancing: ~${usersPerShard} users per shard`);
  }
}

export const shardingService = new DatabaseShardingService();

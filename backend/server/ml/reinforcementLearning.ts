import { getPool } from '../db/init';

interface RLAgent {
  userId: string;
  totalRewards: number;
  swipeCount: number;
  matchCount: number;
  conversationCount: number;
  policyWeights: number[];
}

interface Action {
  type: 'show_profile' | 'skip_profile';
  candidateId: string;
  score: number;
}

interface Reward {
  match: number;
  conversation: number;
  messageReply: number;
  longChat: number;
}

const DEFAULT_WEIGHTS = [0.3, 0.25, 0.2, 0.15, 0.1];

export class ReinforcementLearningService {
  private static instance: ReinforcementLearningService;
  private agents: Map<string, RLAgent> = new Map();
  private isEnabled = true;
  private learningRate = 0.01;
  private discountFactor = 0.9;
  private explorationRate = 0.1;

  static getInstance(): ReinforcementLearningService {
    if (!ReinforcementLearningService.instance) {
      ReinforcementLearningService.instance = new ReinforcementLearningService();
    }
    return ReinforcementLearningService.instance;
  }

  async initialize(): Promise<void> {
    console.log('Initializing Reinforcement Learning Service...');
    await this.loadAgentData();
    console.log(`Loaded ${this.agents.size} RL agents`);
  }

  private async loadAgentData(): Promise<void> {
    const pool = getPool();
    
    const usersResult = await pool.query('SELECT id FROM users');
    
    for (const user of usersResult.rows) {
      const stats = await this.getUserStats(user.id);
      this.agents.set(user.id, {
        userId: user.id,
        totalRewards: 0,
        swipeCount: stats.swipeCount,
        matchCount: stats.matchCount,
        conversationCount: stats.conversationCount,
        policyWeights: [...DEFAULT_WEIGHTS]
      });
    }
  }

  private async getUserStats(userId: string): Promise<{ swipeCount: number; matchCount: number; conversationCount: number }> {
    const pool = getPool();
    
    const swipeResult = await pool.query(
      'SELECT COUNT(*) as count FROM swipes WHERE user_id = $1',
      [userId]
    );

    const matchResult = await pool.query(
      `SELECT COUNT(*) as count FROM matches 
       WHERE user1_id = $1 OR user2_id = $1`,
      [userId]
    );

    const conversationResult = await pool.query(
      `SELECT COUNT(DISTINCT match_id) as count FROM messages 
       WHERE match_id IN (
         SELECT id FROM matches WHERE user1_id = $1 OR user2_id = $1
       ) GROUP BY match_id HAVING COUNT(*) > 1`,
      [userId]
    );

    return {
      swipeCount: parseInt(swipeResult.rows[0]?.count || '0'),
      matchCount: parseInt(matchResult.rows[0]?.count || '0'),
      conversationCount: conversationResult.rows.length
    };
  }

  getPolicyWeights(userId: string): number[] {
    const agent = this.agents.get(userId);
    return agent ? agent.policyWeights : DEFAULT_WEIGHTS;
  }

  calculateActionScore(userId: string, candidateId: string, baseScore: number): { score: number; action: Action } {
    if (!this.isEnabled) {
      return { score: baseScore, action: { type: 'show_profile', candidateId, score: baseScore } };
    }

    const agent = this.agents.get(userId);
    if (!agent) {
      return { score: baseScore, action: { type: 'show_profile', candidateId, score: baseScore } };
    }

    const exploration = Math.random() < this.explorationRate;
    
    if (exploration) {
      const exploreScore = Math.random();
      return {
        score: exploreScore * 0.5 + baseScore * 0.5,
        action: { type: 'show_profile', candidateId, score: exploreScore }
      };
    }

    const weights = agent.policyWeights;
    
    let adjustedScore = baseScore * weights[0];
    adjustedScore += (agent.matchCount / Math.max(agent.swipeCount, 1)) * weights[1];
    adjustedScore += (agent.conversationCount / Math.max(agent.matchCount, 1)) * weights[2];
    
    const engagementBonus = this.calculateEngagementBonus(agent);
    adjustedScore += engagementBonus * weights[3];
    
    adjustedScore += (1 - this.explorationRate) * weights[4];

    return {
      score: Math.min(0.95, Math.max(0.05, adjustedScore)),
      action: { type: 'show_profile', candidateId, score: adjustedScore }
    };
  }

  private calculateEngagementBonus(agent: RLAgent): number {
    if (agent.swipeCount < 10) return 0.3;
    
    const matchRate = agent.matchCount / agent.swipeCount;
    const conversationRate = agent.conversationCount / agent.matchCount;
    
    if (matchRate > 0.2 && conversationRate > 0.5) {
      return 0.8;
    } else if (matchRate > 0.1) {
      return 0.5;
    }
    
    return 0.2;
  }

  async updatePolicy(userId: string, reward: Reward): Promise<void> {
    if (!this.isEnabled) return;

    const agent = this.agents.get(userId);
    if (!agent) return;

    const totalReward = 
      reward.match * 10 +
      reward.conversation * 20 +
      reward.messageReply * 30 +
      reward.longChat * 50;

    agent.totalRewards += totalReward;
    agent.swipeCount++;

    if (reward.match) {
      agent.matchCount++;
    }
    if (reward.conversation) {
      agent.conversationCount++;
    }

    this.updateWeights(agent, totalReward);
  }

  private updateWeights(agent: RLAgent, reward: number): void {
    const weights = agent.policyWeights;
    const normalizedReward = reward / 100;

    for (let i = 0; i < weights.length; i++) {
      const gradient = normalizedReward * (Math.random() - 0.5);
      weights[i] = Math.max(0.05, Math.min(0.5, weights[i] + this.learningRate * gradient));
    }

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < weights.length; i++) {
      weights[i] /= totalWeight;
    }

    agent.policyWeights = weights;
  }

  getExplorationRate(userId: string): number {
    const agent = this.agents.get(userId);
    if (!agent) return this.explorationRate;

    const experience = agent.swipeCount;
    
    if (experience < 50) {
      return 0.3;
    } else if (experience < 200) {
      return 0.15;
    } else {
      return 0.05;
    }
  }

  setExplorationRate(rate: number): void {
    this.explorationRate = Math.max(0, Math.min(1, rate));
  }

  enable(): void {
    this.isEnabled = true;
  }

  disable(): void {
    this.isEnabled = false;
  }

  async getOptimizationSuggestions(userId: string): Promise<{
    currentExploration: number;
    suggestedActions: string[];
    engagementLevel: 'low' | 'medium' | 'high';
  }> {
    const agent = this.agents.get(userId);
    
    if (!agent) {
      return {
        currentExploration: this.explorationRate,
        suggestedActions: ['Continue swiping to improve recommendations'],
        engagementLevel: 'low'
      };
    }

    const suggestions: string[] = [];
    let engagementLevel: 'low' | 'medium' | 'high' = 'low';

    const matchRate = agent.matchCount / Math.max(agent.swipeCount, 1);
    const conversationRate = agent.conversationCount / Math.max(agent.matchCount, 1);

    if (matchRate < 0.05) {
      suggestions.push('Try adjusting your preferences for better matches');
      suggestions.push('Add more interests to your profile');
    } else if (matchRate > 0.15) {
      suggestions.push('Great match rate! Keep up the good engagement');
    }

    if (conversationRate < 0.3 && agent.matchCount > 5) {
      suggestions.push('Start conversations with your matches');
    }

    if (agent.swipeCount > 100 && matchRate > 0.1) {
      engagementLevel = 'high';
    } else if (agent.swipeCount > 20) {
      engagementLevel = 'medium';
    }

    return {
      currentExploration: this.getExplorationRate(userId),
      suggestedActions: suggestions,
      engagementLevel
    };
  }

  getStats(): { totalAgents: number; enabled: boolean; explorationRate: number } {
    return {
      totalAgents: this.agents.size,
      enabled: this.isEnabled,
      explorationRate: this.explorationRate
    };
  }
}

export const rlService = ReinforcementLearningService.getInstance();

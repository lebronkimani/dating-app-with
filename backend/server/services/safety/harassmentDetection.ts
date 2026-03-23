import { getPool } from '../../db/init';
import { moderationService } from '../moderation';

interface ToxicityScores {
  overall: number;
  insult: number;
  harassment: number;
  hateSpeech: number;
  threats: number;
  sexual: number;
  bullying: number;
}

interface HarassmentResult {
  detected: boolean;
  confidence: number;
  toxicityScores: ToxicityScores;
  type?: 'harassment' | 'bullying' | 'hate_speech' | 'threats' | 'stalking' | 'sexual_harassment';
  severity: 'low' | 'medium' | 'high' | 'critical';
  action?: 'block' | 'warn' | 'ban' | 'flag';
  reasons: string[];
}

export class HarassmentDetectionService {
  private openAiKey: string | undefined;

  constructor() {
    this.openAiKey = process.env.OPENAI_API_KEY;
  }

  async analyzeMessage(message: string, senderId: string, recipientId: string): Promise<HarassmentResult> {
    const text = message.toLowerCase();
    const toxicityScores = await this.calculateToxicity(message);

    if (toxicityScores.hateSpeech >= 0.7) {
      await this.reportHarassment(senderId, 'hate_speech', toxicityScores.hateSpeech);
      return {
        detected: true,
        confidence: toxicityScores.hateSpeech,
        toxicityScores,
        type: 'hate_speech',
        severity: 'critical',
        action: 'ban',
        reasons: ['Hate speech detected']
      };
    }

    if (toxicityScores.threats >= 0.7) {
      await this.reportHarassment(senderId, 'threats', toxicityScores.threats);
      return {
        detected: true,
        confidence: toxicityScores.threats,
        toxicityScores,
        type: 'threats',
        severity: 'critical',
        action: 'ban',
        reasons: ['Threats detected']
      };
    }

    if (toxicityScores.harassment >= 0.5 && toxicityScores.insult >= 0.5) {
      const count = await this.getHarassmentCount(senderId);
      if (count >= 2) {
        return {
          detected: true,
          confidence: toxicityScores.harassment,
          toxicityScores,
          type: 'harassment',
          severity: 'high',
          action: 'warn',
          reasons: ['Repeated harassment detected']
        };
      }
      return {
        detected: true,
        confidence: toxicityScores.harassment * 0.7,
        toxicityScores,
        type: 'harassment',
        severity: 'medium',
        action: 'flag',
        reasons: ['Potential harassment']
      };
    }

    if (toxicityScores.sexual >= 0.6) {
      return {
        detected: true,
        confidence: toxicityScores.sexual,
        toxicityScores,
        type: 'sexual_harassment',
        severity: 'high',
        action: 'warn',
        reasons: ['Sexual harassment detected']
      };
    }

    const stalkingPatterns = [
      /where are you|what's your address|your location|find you|i know where|follow you|watching you/i
    ];

    for (const pattern of stalkingPatterns) {
      if (pattern.test(text)) {
        return {
          detected: true,
          confidence: 0.8,
          toxicityScores,
          type: 'stalking',
          severity: 'high',
          action: 'warn',
          reasons: ['Potential stalking behavior']
        };
      }
    }

    const repeatCount = await this.checkRepeatedMessages(senderId, recipientId, message);
    if (repeatCount >= 3) {
      return {
        detected: true,
        confidence: 0.7,
        toxicityScores,
        type: 'harassment',
        severity: 'medium',
        action: 'flag',
        reasons: ['Repeated messages detected']
      };
    }

    return {
      detected: false,
      confidence: 1 - toxicityScores.overall,
      toxicityScores,
      severity: 'low'
    };
  }

  private async calculateToxicity(message: string): Promise<ToxicityScores> {
    const scores: ToxicityScores = {
      overall: 0,
      insult: 0,
      harassment: 0,
      hateSpeech: 0,
      threats: 0,
      sexual: 0,
      bullying: 0
    };

    const text = message.toLowerCase();

    const hateSpeechPatterns = [
      { pattern: /nigger|negro|faggot|fag|dyke|tranny|retard|spic|chink|gook|wetback|beaner|kike|raghead|terrorist/i, weight: 1.0 },
      { pattern: /kill all|death to|nuke|exterminate/i, weight: 0.9 }
    ];

    for (const { pattern, weight } of hateSpeechPatterns) {
      if (pattern.test(text)) {
        scores.hateSpeech = Math.max(scores.hateSpeech, weight);
        scores.overall = Math.max(scores.overall, weight);
      }
    }

    const threatPatterns = [
      { pattern: /kill you|i'll kill|death threats?|hurt you|harm you|beat you|attack you|find you/i, weight: 0.95 },
      { pattern: /i'm coming|waiting for you|will find/i, weight: 0.7 }
    ];

    for (const { pattern, weight } of threatPatterns) {
      if (pattern.test(text)) {
        scores.threats = Math.max(scores.threats, weight);
        scores.overall = Math.max(scores.overall, weight);
      }
    }

    const insultPatterns = [
      { pattern: /ugly|worthless|stupid|idiot|loser|moron|jerk|creep|disgusting|disgusting/i, weight: 0.7 },
      { pattern: /shut up|go away|leave me alone|block you/i, weight: 0.5 }
    ];

    for (const { pattern, weight } of insultPatterns) {
      if (pattern.test(text)) {
        scores.insult = Math.max(scores.insult, weight);
        scores.harassment = Math.max(scores.harassment, weight * 0.8);
        scores.overall = Math.max(scores.overall, weight * 0.6);
      }
    }

    const sexualPatterns = [
      { pattern: /sexy|hot|beautiful.*body|nice.*ass|sexy.*pic|send.*nude/i, weight: 0.6 },
      { pattern: /fuck|shit|bitch|asshole|dick|pussy|whore/i, weight: 0.5 }
    ];

    for (const { pattern, weight } of sexualPatterns) {
      if (pattern.test(text)) {
        scores.sexual = Math.max(scores.sexual, weight);
        scores.harassment = Math.max(scores.harassment, weight * 0.5);
        scores.overall = Math.max(scores.overall, weight * 0.4);
      }
    }

    if (this.openAiKey) {
      const aiScores = await this.aiAnalyzeToxicity(message);
      if (aiScores) {
        scores.overall = Math.max(scores.overall, aiScores.overall);
        scores.insult = Math.max(scores.insult, aiScores.insult);
        scores.harassment = Math.max(scores.harassment, aiScores.harassment);
        scores.hateSpeech = Math.max(scores.hateSpeech, aiScores.hateSpeech);
        scores.threats = Math.max(scores.threats, aiScores.threats);
        scores.sexual = Math.max(scores.sexual, aiScores.sexual);
      }
    }

    return scores;
  }

  private async aiAnalyzeToxicity(message: string): Promise<ToxicityScores | null> {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openAiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'system',
            content: `Analyze this message for toxicity. Respond with JSON only:
{"overall": 0.0-1.0, "insult": 0.0-1.0, "harassment": 0.0-1.0, "hateSpeech": 0.0-1.0, "threats": 0.0-1.0, "sexual": 0.0-1.0, "bullying": 0.0-1.0}`
          }, {
            role: 'user',
            content: message
          }],
          max_tokens: 200
        })
      });

      if (!response.ok) return null;

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content;
      
      if (content) {
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('AI toxicity analysis error:', error);
    }

    return null;
  }

  async analyzeConversation(userId1: string, userId2: string): Promise<{
    hasHarassment: boolean;
    report: HarassmentResult | null;
  }> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT sender_id, text, created_at 
       FROM messages 
       WHERE ((sender_id = $1 AND match_id IN (SELECT id FROM matches WHERE user1_id = $2 AND user2_id = $3))
           OR (sender_id = $3 AND match_id IN (SELECT id FROM matches WHERE user1_id = $2 AND user2_id = $1)))
       AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId1, userId1, userId2]
    );

    const messages = result.rows;
    const sender1Messages = messages.filter(m => m.sender_id === userId1);
    const sender2Messages = messages.filter(m => m.sender_id === userId2);

    const analysis1 = await this.analyzeMessagePattern(sender1Messages.map(m => m.text));
    const analysis2 = await this.analyzeMessagePattern(sender2Messages.map(m => m.text));

    if (analysis1.detected) {
      return { hasHarassment: true, report: analysis1 };
    }

    if (analysis2.detected) {
      return { hasHarassment: true, report: analysis2 };
    }

    return { hasHarassment: false, report: null };
  }

  private async analyzeMessagePattern(messages: string[]): Promise<HarassmentResult> {
    if (messages.length < 5) {
      return { detected: false, confidence: 1.0, toxicityScores: { overall: 0, insult: 0, harassment: 0, hateSpeech: 0, threats: 0, sexual: 0, bullying: 0 }, severity: 'low' };
    }

    let totalToxicity = 0;
    let maxInsult = 0;
    let maxHarassment = 0;
    let maxThreats = 0;

    for (const msg of messages) {
      const scores = await this.calculateToxicity(msg);
      totalToxicity += scores.overall;
      maxInsult = Math.max(maxInsult, scores.insult);
      maxHarassment = Math.max(maxHarassment, scores.harassment);
      maxThreats = Math.max(maxThreats, scores.threats);
    }

    const avgToxicity = totalToxicity / messages.length;

    if (avgToxicity > 0.5 || maxThreats > 0.7) {
      return {
        detected: true,
        confidence: avgToxicity,
        toxicityScores: {
          overall: avgToxicity,
          insult: maxInsult,
          harassment: maxHarassment,
          hateSpeech: 0,
          threats: maxThreats,
          sexual: 0,
          bullying: 0
        },
        type: maxThreats > 0.7 ? 'threats' : 'harassment',
        severity: avgToxicity > 0.7 ? 'high' : 'medium',
        action: avgToxicity > 0.7 ? 'warn' : 'flag',
        reasons: [`${Math.round(avgToxicity * 100)}% of messages contain toxic content`]
      };
    }

    return {
      detected: false,
      confidence: 1 - avgToxicity,
      toxicityScores: {
        overall: avgToxicity,
        insult: maxInsult,
        harassment: maxHarassment,
        hateSpeech: 0,
        threats: maxThreats,
        sexual: 0,
        bullying: 0
      },
      severity: 'low'
    };
  }

  private async reportHarassment(userId: string, type: string, confidence: number): Promise<void> {
    await moderationService.handleViolation({
      userId,
      type: `harassment_${type}`,
      severity: confidence > 0.9 ? 'critical' : 'high',
      source: 'ai_detection',
      description: `Automated ${type} detection with ${Math.round(confidence * 100)}% confidence`
    });
  }

  private async getHarassmentCount(userId: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM violations 
       WHERE user_id = $1 AND type LIKE 'harassment_%' 
       AND created_at > NOW() - INTERVAL '7 days'`,
      [userId]
    );
    return parseInt(result.rows[0].count);
  }

  private async checkRepeatedMessages(senderId: string, recipientId: string, message: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM messages 
       WHERE sender_id = $1 AND text = $2 
       AND created_at > NOW() - INTERVAL '1 hour'`,
      [senderId, message]
    );
    return parseInt(result.rows[0].count);
  }
}

export const harassmentDetectionService = new HarassmentDetectionService();

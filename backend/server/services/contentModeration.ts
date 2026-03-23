import { getPool, generateId } from '../db/init';
import { moderationService } from './moderation';

interface ModerationResult {
  approved: boolean;
  confidence: number;
  labels: string[];
  rejected?: boolean;
  reason?: string;
}

export class ContentModerationService {
  private enabled: boolean = false;
  private moderationApiKey: string | undefined;

  constructor() {
    this.moderationApiKey = process.env.OPENAI_API_KEY || process.env.OPEN_MODERATION_KEY;
    this.enabled = !!this.moderationApiKey;
  }

  async moderateImage(imageUrl: string, userId: string, contentId?: string): Promise<ModerationResult> {
    const queueId = generateId();
    const pool = getPool();

    await pool.query(
      `INSERT INTO content_moderation_queue (id, content_type, content_id, user_id, content_url, status)
       VALUES ($1, 'photo', $2, $3, $4, 'processing')`,
      [queueId, contentId || generateId(), userId, imageUrl]
    );

    try {
      if (this.enabled) {
        const result = await this.moderateWithOpenAI(imageUrl, 'image');
        
        await pool.query(
          `UPDATE content_moderation_queue SET status = $1, ai_confidence = $2, ai_labels = $3, processed_at = NOW() WHERE id = $4`,
          [result.approved ? 'approved' : 'rejected', result.confidence, JSON.stringify(result.labels), queueId]
        );

        if (!result.approved) {
          await moderationService.handleViolation({
            userId,
            type: 'inappropriate_photo',
            severity: 'high',
            source: 'ai_detection',
            description: `AI detected inappropriate content: ${result.labels.join(', ')}`
          });
        }

        return result;
      }

      await pool.query(
        `UPDATE content_moderation_queue SET status = 'approved', ai_confidence = 0.99, processed_at = NOW() WHERE id = $1`,
        [queueId]
      );

      return { approved: true, confidence: 0.99, labels: ['pass'] };
    } catch (error) {
      console.error('Content moderation error:', error);
      
      await pool.query(
        `UPDATE content_moderation_queue SET status = 'needs_review', processed_at = NOW() WHERE id = $1`,
        [queueId]
      );

      return { approved: true, confidence: 0, labels: ['error'], rejected: false };
    }
  }

  async moderateText(text: string, userId: string, contentType: 'message' | 'bio' | 'profile', contentId?: string): Promise<ModerationResult> {
    const queueId = generateId();
    const pool = getPool();

    await pool.query(
      `INSERT INTO content_moderation_queue (id, content_type, content_id, user_id, content_text, status)
       VALUES ($1, $2, $3, $4, $5, 'processing')`,
      [queueId, contentType, contentId || generateId(), userId, text]
    );

    try {
      if (this.enabled) {
        const result = await this.moderateWithOpenAI(text, 'text');
        
        await pool.query(
          `UPDATE content_moderation_queue SET status = $1, ai_confidence = $2, ai_labels = $3, processed_at = NOW() WHERE id = $4`,
          [result.approved ? 'approved' : 'rejected', result.confidence, JSON.stringify(result.labels), queueId]
        );

        if (!result.approved) {
          await moderationService.handleViolation({
            userId,
            type: this.getViolationType(contentType),
            severity: 'high',
            source: 'ai_detection',
            description: `AI detected inappropriate content: ${result.labels.join(', ')}`
          });
        }

        return result;
      }

      const basicCheck = this.basicTextCheck(text);
      
      await pool.query(
        `UPDATE content_moderation_queue SET status = $1, ai_confidence = 0.99, processed_at = NOW() WHERE id = $2`,
        [basicCheck.approved ? 'approved' : 'rejected', queueId]
      );

      if (!basicCheck.approved) {
        await moderationService.handleViolation({
          userId,
          type: this.getViolationType(contentType),
          severity: 'medium',
          source: 'ai_detection',
          description: `Basic check detected inappropriate content: ${basicCheck.reason}`
        });
      }

      return basicCheck;
    } catch (error) {
      console.error('Text moderation error:', error);
      
      await pool.query(
        `UPDATE content_moderation_queue SET status = 'needs_review', processed_at = NOW() WHERE id = $1`,
        [queueId]
      );

      return { approved: true, confidence: 0, labels: ['error'], rejected: false };
    }
  }

  private async moderateWithOpenAI(content: string, type: 'text' | 'image'): Promise<ModerationResult> {
    const endpoint = 'https://api.openai.com/v1/moderations';
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.moderationApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: content
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const result = data.results[0];

    const flagged = result.flagged;
    const categories = result.categories;
    const categoryScores = result.category_scores;

    const detectedLabels: string[] = [];
    let maxConfidence = 0;

    for (const [category, isFlagged] of Object.entries(categories)) {
      if (isFlagged) {
        detectedLabels.push(category);
        const score = categoryScores[category] as number;
        if (score > maxConfidence) {
          maxConfidence = score;
        }
      }
    }

    return {
      approved: !flagged,
      confidence: maxConfidence,
      labels: detectedLabels,
      rejected: flagged,
      reason: flagged ? detectedLabels.join(', ') : undefined
    };
  }

  private basicTextCheck(text: string): ModerationResult {
    const spamPatterns = [
      /buy now|click here|limited offer|win free|act now/i,
      /\$\d+\s*(million|billion)|make \$\d+/i,
      /want to meet|sugar|daddy|baby/i,
      /\b(viagra|cialis|casino|poker)\b/i,
      /join.*now.*\d+/i
    ];

    for (const pattern of spamPatterns) {
      if (pattern.test(text)) {
        return {
          approved: false,
          confidence: 0.9,
          labels: ['spam'],
          rejected: true,
          reason: 'Spam content detected'
        };
      }
    }

    const harassmentPatterns = [
      /ugly|worthless|stupid|idiot|loser/i,
      /die|kill yourself|shut up/i
    ];

    for (const pattern of harassmentPatterns) {
      if (pattern.test(text)) {
        return {
          approved: false,
          confidence: 0.8,
          labels: ['harassment'],
          rejected: true,
          reason: 'Harassment detected'
        };
      }
    }

    return { approved: true, confidence: 0.99, labels: ['pass'] };
  }

  private getViolationType(contentType: string): string {
    switch (contentType) {
      case 'message': return 'inappropriate_message';
      case 'bio': return 'inappropriate_bio';
      case 'profile': return 'inappropriate_profile';
      default: return 'inappropriate_content';
    }
  }

  async getModerationQueue(status: string = 'pending', limit: number = 50): Promise<any[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM content_moderation_queue WHERE status = $1 ORDER BY created_at DESC LIMIT $2`,
      [status, limit]
    );
    return result.rows;
  }

  async approveContent(queueId: string, reviewerId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE content_moderation_queue SET status = 'approved', reviewed_by = $1, processed_at = NOW() WHERE id = $2`,
      [reviewerId, queueId]
    );
  }

  async rejectContent(queueId: string, reason: string, reviewerId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE content_moderation_queue SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, processed_at = NOW() WHERE id = $3`,
      [reason, reviewerId, queueId]
    );
  }
}

export const contentModerationService = new ContentModerationService();

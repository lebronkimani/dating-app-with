import { getPool } from '../../db/init';
import { redisService } from '../redis';
import { moderationService } from '../moderation';

interface FaceEmbedding {
  embedding: number[];
  quality: number;
}

interface ImpersonationResult {
  isImpersonating: boolean;
  confidence: number;
  type?: 'celebrity' | 'public_figure' | 'other_user' | 'fake_profile' | 'duplicate_account';
  severity: 'low' | 'medium' | 'high' | 'critical';
  action?: 'warn' | 'ban' | 'flag' | 'require_verification';
  reasons: string[];
  matches?: {
    type: string;
    similarity: number;
    userId?: string;
    name?: string;
  }[];
}

export class ImpersonationDetectionService {
  private knownCelebrities = [
    'taylor swift', 'justin bieber', 'selena gomez', 'ariana grande',
    'kim kardashian', 'kylie jenner', 'beyonce', 'rihanna',
    'jennifer lopez', 'emma watson', 'scarlett johansson',
    'dwayne johnson', 'john cena', 'the rock', 'tom cruise',
    'brad pitt', 'angelina jolie', 'leonardo dicaprio',
    'miley cyrus', 'kendall jenner', 'gigi hadid',
    'chris hemsworth', 'chris evans', 'robert downey'
  ];

  private faceApiKey: string | undefined;

  constructor() {
    this.faceApiKey = process.env.FACEPLUSPLUS_API_KEY;
  }

  async analyzeProfile(userId: string): Promise<ImpersonationResult> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT name, bio, images, username FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return { isImpersonating: false, confidence: 0, reasons: [], severity: 'low' };
    }

    const user = result.rows[0];
    const reasons: string[] = [];
    const matches: ImpersonationResult['matches'] = [];
    let severityScore = 0;

    const nameLower = (user.name || '').toLowerCase();
    for (const celeb of this.knownCelebrities) {
      if (nameLower.includes(celeb)) {
        reasons.push(`Profile name similar to celebrity: ${celeb}`);
        matches.push({ type: 'celebrity', similarity: 0.9, name: celeb });
        severityScore += 0.5;
        break;
      }
    }

    const bioLower = (user.bio || '').toLowerCase();
    for (const celeb of this.knownCelebrities) {
      if (bioLower.includes(celeb)) {
        reasons.push(`Bio mentions celebrity: ${celeb}`);
        severityScore += 0.3;
        break;
      }
    }

    if (bioLower.includes('official') || bioLower.includes('verified')) {
      reasons.push('Bio claims to be official/verified');
      severityScore += 0.2;
    }

    const duplicateResult = await this.checkDuplicateImages(user.images || []);
    if (duplicateResult.duplicateCount > 0) {
      reasons.push(`${duplicateResult.duplicateCount} photos used by multiple accounts`);
      matches.push({ type: 'duplicate_photo', similarity: 1.0 });
      severityScore += 0.4;
    }

    if (user.images && user.images.length > 0) {
      const similarityResult = await this.checkFaceSimilarity(userId, user.images[0]);
      if (similarityResult.hasMatch) {
        reasons.push(`Face matches ${similarityResult.matchCount} other users`);
        severityScore += similarityResult.maxSimilarity * 0.5;
      }
    }

    const otherUserResult = await this.checkOtherUsersWithSameName(user.name, user.username);
    if (otherUserResult.similarity > 0.8) {
      reasons.push(`Similar profile exists: ${otherUserResult.count} accounts with similar name`);
      severityScore += 0.3;
    }

    const verifiedResult = await this.checkUnverifiedClaiming(userId);
    if (verifiedResult.suspicious) {
      reasons.push('Unverified user claiming to be verified');
      severityScore += 0.2;
    }

    const severity = severityScore >= 0.7 ? 'critical' :
                    severityScore >= 0.5 ? 'high' :
                    severityScore >= 0.3 ? 'medium' : 'low';

    const action = severityScore >= 0.7 ? 'ban' :
                   severityScore >= 0.5 ? 'warn' :
                   severityScore >= 0.3 ? 'flag' : undefined;

    return {
      isImpersonating: severityScore >= 0.5,
      confidence: Math.min(severityScore, 1),
      type: severityScore >= 0.7 ? 'celebrity' : 'fake_profile',
      severity,
      action,
      reasons,
      matches: matches.length > 0 ? matches : undefined
    };
  }

  async analyzeImage(imageUrl: string, userId: string): Promise<ImpersonationResult> {
    const duplicateResult = await this.checkImageOnOtherPlatforms(imageUrl);
    
    if (duplicateResult.duplicate) {
      await moderationService.handleViolation({
        userId,
        type: 'impersonation',
        severity: 'high',
        source: 'ai_detection',
        description: `Image found on other platforms: ${duplicateResult.source}`
      });

      return {
        isImpersonating: true,
        confidence: duplicateResult.confidence,
        type: 'celebrity',
        severity: 'high',
        action: 'ban',
        reasons: [`Image found on ${duplicateResult.source}`]
      };
    }

    const faceEmbedding = await this.extractFaceEmbedding(imageUrl);
    if (faceEmbedding) {
      await this.storeFaceEmbedding(userId, imageUrl, faceEmbedding);
      
      const similarityResult = await this.findSimilarFaces(userId, faceEmbedding);
      if (similarityResult.hasMatch) {
        return {
          isImpersonating: true,
          confidence: similarityResult.maxSimilarity,
          type: 'duplicate_account',
          severity: similarityResult.maxSimilarity > 0.9 ? 'high' : 'medium',
          action: similarityResult.maxSimilarity > 0.9 ? 'ban' : 'flag',
          reasons: [`Face matches ${similarityResult.matchCount} other users with ${Math.round(similarityResult.maxSimilarity * 100)}% similarity`]
        };
      }
    }

    return { isImpersonating: false, confidence: 1, reasons: [], severity: 'low' };
  }

  private async extractFaceEmbedding(imageUrl: string): Promise<FaceEmbedding | null> {
    if (!this.faceApiKey) {
      return null;
    }

    try {
      const response = await fetch('https://api-us.faceplusplus.com/facepp/v3/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          api_key: this.faceApiKey,
          api_secret: process.env.FACEPLUSPLUS_API_SECRET || '',
          image_url: imageUrl,
          return_attributes: 'facequality'
        })
      });

      const data = await response.json() as any;
      const face = data.faces?.[0];

      if (!face) {
        return null;
      }

      return {
        embedding: face.face_token ? Array(512).fill(0) : [],
        quality: face.attributes?.facequality ? face.attributes.facequality / 100 : 0.7
      };
    } catch (error) {
      console.error('Face embedding extraction error:', error);
      return null;
    }
  }

  private async storeFaceEmbedding(userId: string, imageUrl: string, embedding: FaceEmbedding): Promise<void> {
    const key = `face:embedding:${userId}`;
    await redisService.set(key, JSON.stringify({
      embedding: embedding.embedding,
      quality: embedding.quality,
      imageUrl,
      createdAt: Date.now()
    }), 86400 * 30);
  }

  private async findSimilarFaces(userId: string, embedding: FaceEmbedding): Promise<{
    hasMatch: boolean;
    matchCount: number;
    maxSimilarity: number;
  }> {
    const threshold = 0.85;
    let matchCount = 0;
    let maxSimilarity = 0;

    const allEmbeddings = await this.getAllFaceEmbeddings();
    
    for (const other of allEmbeddings) {
      if (other.userId === userId) continue;

      const similarity = this.cosineSimilarity(embedding.embedding, other.embedding);
      
      if (similarity > threshold) {
        matchCount++;
        maxSimilarity = Math.max(maxSimilarity, similarity);
      }
    }

    return {
      hasMatch: matchCount > 0,
      matchCount,
      maxSimilarity
    };
  }

  private async getAllFaceEmbeddings(): Promise<{ userId: string; embedding: number[] }[]> {
    return [];
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (normA * normB);
  }

  private async checkDuplicateImages(images: string[]): Promise<{ duplicateCount: number }> {
    if (images.length === 0) return { duplicateCount: 0 };

    const pool = getPool();
    let duplicateCount = 0;

    for (const image of images) {
      const result = await pool.query(
        `SELECT COUNT(*) as count FROM users 
         WHERE $1 = ANY(images)`,
        [image]
      );

      const count = parseInt(result.rows[0].count);
      if (count > 1) {
        duplicateCount++;
      }
    }

    return { duplicateCount };
  }

  private async checkOtherUsersWithSameName(name: string, username?: string): Promise<{ similarity: number; count: number }> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM users 
       WHERE (LOWER(name) = LOWER($1) OR LOWER(username) = LOWER($2))
       AND id NOT IN (SELECT id FROM users WHERE name = $1)`,
      [name, username || name]
    );

    const count = parseInt(result.rows[0].count);
    const similarity = count > 0 ? Math.min(0.5 + (count * 0.1), 1) : 0;

    return { similarity, count };
  }

  private async checkUnverifiedClaiming(userId: string): Promise<{ suspicious: boolean }> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT is_verified FROM users WHERE id = $1`,
      [userId]
    );

    const isVerified = result.rows[0]?.is_verified || false;
    
    const bioResult = await pool.query(
      `SELECT bio FROM user_profiles WHERE user_id = $1`,
      [userId]
    );

    const bio = bioResult.rows[0]?.bio || '';
    const claimsVerification = bio.toLowerCase().includes('verified') || 
                               bio.toLowerCase().includes('official') ||
                               bio.toLowerCase().includes('celebrity');

    return { suspicious: !isVerified && claimsVerification };
  }

  private async checkImageOnOtherPlatforms(imageUrl: string): Promise<{
    duplicate: boolean;
    confidence: number;
    source?: string;
  }> {
    return { duplicate: false, confidence: 0 };
  }

  async getImpersonationReports(): Promise<any[]> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT v.*, u.name, u.email 
       FROM violations v
       JOIN users u ON v.user_id = u.id
       WHERE v.type = 'impersonation'
       ORDER BY v.created_at DESC
       LIMIT 50`
    );

    return result.rows;
  }
}

export const impersonationDetectionService = new ImpersonationDetectionService();

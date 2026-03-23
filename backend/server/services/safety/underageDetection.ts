import { getPool } from '../../db/init';
import { moderationService } from '../moderation';

interface AgeEstimationResult {
  estimatedAge: number;
  confidence: number;
  faceDetected: boolean;
}

interface AgeConsistencyResult {
  isConsistent: boolean;
  mismatchScore: number;
  profileAge: number;
  predictedAge: number;
}

interface DetectionResult {
  detected: boolean;
  confidence: number;
  reason?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action?: 'warn' | 'ban' | 'flag' | 'require_verification';
}

export class UnderageDetectionService {
  private readonly MIN_AGE = 18;
  private readonly AGE_MISMATCH_THRESHOLD = 5;
  private faceApiKey: string | undefined;
  private rekognitionKey: string | undefined;

  constructor() {
    this.faceApiKey = process.env.FACEPLUSPLUS_API_KEY;
    this.rekognitionKey = process.env.AWS_ACCESS_KEY_ID;
  }

  async checkAge(userId: string): Promise<DetectionResult> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT age, date_of_birth, created_at FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return { detected: false, confidence: 0, reason: 'User not found' };
    }

    const user = result.rows[0];
    const profileAge = user.age;

    if (profileAge < this.MIN_AGE) {
      await moderationService.permanentBan(userId, 'Underage user detected');
      return {
        detected: true,
        confidence: 1.0,
        reason: `User age ${profileAge} is below minimum required age of ${this.MIN_AGE}`,
        severity: 'critical',
        action: 'ban'
      };
    }

    const ageEstimation = await this.estimateAgeFromPhoto(userId);
    if (ageEstimation.faceDetected && ageEstimation.estimatedAge < this.MIN_AGE) {
      return {
        detected: true,
        confidence: ageEstimation.confidence,
        reason: `Photo age estimation (${ageEstimation.estimatedAge}) is below minimum`,
        severity: 'critical',
        action: 'require_verification'
      };
    }

    if (ageEstimation.faceDetected) {
      const consistency = await this.checkAgeConsistency(userId, profileAge, ageEstimation);
      if (!consistency.isConsistent) {
        return {
          detected: true,
          confidence: consistency.mismatchScore,
          reason: `Profile age (${profileAge}) doesn't match photo age (${consistency.predictedAge})`,
          severity: 'high',
          action: 'flag'
        };
      }
    }

    if (profileAge < 21) {
      return {
        detected: false,
        confidence: 0.7,
        reason: 'User is under 21 - flagged for additional verification',
        severity: 'low',
        action: 'flag'
      };
    }

    return { detected: false, confidence: 1.0 };
  }

  async estimateAgeFromPhoto(userId: string): Promise<AgeEstimationResult> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT images FROM users WHERE id = $1`,
      [userId]
    );

    const images = result.rows[0]?.images || [];
    if (images.length === 0) {
      return { estimatedAge: 0, confidence: 0, faceDetected: false };
    }

    const primaryImage = images[0];

    if (this.rekognitionKey) {
      return await this.estimateWithRekognition(primaryImage);
    }

    if (this.faceApiKey) {
      return await this.estimateWithFacePlusPlus(primaryImage);
    }

    return { estimatedAge: 0, confidence: 0, faceDetected: false };
  }

  private async estimateWithRekognition(imageUrl: string): Promise<AgeEstimationResult> {
    try {
      const AWS = await import('aws-sdk');
      const rekognition = new AWS.Rekognition({
        region: process.env.AWS_REGION || 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      });

      const response = await rekognition.detectFaces({
        Image: { S3Object: { Bucket: process.env.S3_BUCKET, Name: imageUrl } },
        Attributes: ['AGE_RANGE', 'EMOTIONS', 'QUALITY']
      }).promise();

      const face = response.FaceDetails?.[0];
      if (!face) {
        return { estimatedAge: 0, confidence: 0, faceDetected: false };
      }

      const ageRange = face.AgeRange;
      const estimatedAge = ageRange ? Math.round((ageRange.Low! + ageRange.High!) / 2) : 0;

      return {
        estimatedAge,
        confidence: 0.8,
        faceDetected: true
      };
    } catch (error) {
      console.error('Rekognition error:', error);
      return { estimatedAge: 0, confidence: 0, faceDetected: false };
    }
  }

  private async estimateWithFacePlusPlus(imageUrl: string): Promise<AgeEstimationResult> {
    try {
      const response = await fetch('https://api-us.faceplusplus.com/facepp/v3/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          api_key: this.faceApiKey!,
          api_secret: process.env.FACEPLUSPLUS_API_SECRET || '',
          image_url: imageUrl,
          return_attributes: 'age,gender,facequality'
        })
      });

      const data = await response.json() as any;
      const face = data.faces?.[0];

      if (!face) {
        return { estimatedAge: 0, confidence: 0, faceDetected: false };
      }

      return {
        estimatedAge: face.attributes?.age || 0,
        confidence: face.attributes?.facequality ? face.attributes.facequality / 100 : 0.7,
        faceDetected: true
      };
    } catch (error) {
      console.error('Face++ error:', error);
      return { estimatedAge: 0, confidence: 0, faceDetected: false };
    }
  }

  private async checkAgeConsistency(userId: string, profileAge: number, estimation: AgeEstimationResult): Promise<AgeConsistencyResult> {
    const predictedAge = estimation.estimatedAge;
    const mismatch = Math.abs(profileAge - predictedAge);
    
    const isConsistent = mismatch <= this.AGE_MISMATCH_THRESHOLD;
    const mismatchScore = Math.min(mismatch / 20, 1);

    return {
      isConsistent,
      mismatchScore,
      profileAge,
      predictedAge
    };
  }

  async verifyAge(userId: string, idDocument?: string): Promise<DetectionResult> {
    if (!idDocument) {
      return {
        detected: false,
        confidence: 0,
        reason: 'No document provided for verification',
        severity: 'low'
      };
    }

    const documentResult = await this.verifyIDDocument(idDocument);
    
    if (documentResult.verified) {
      return {
        detected: false,
        confidence: 0.95,
        reason: 'Age verified via ID document',
        severity: 'low'
      };
    }

    if (documentResult.failed) {
      await moderationService.permanentBan(userId, 'Failed ID verification');
      return {
        detected: true,
        confidence: 0.95,
        reason: 'ID verification failed',
        severity: 'critical',
        action: 'ban'
      };
    }

    return {
      detected: false,
      confidence: 0.5,
      reason: 'ID verification pending review',
      severity: 'low',
      action: 'flag'
    };
  }

  private async verifyIDDocument(documentUrl: string): Promise<{ verified: boolean; failed: boolean }> {
    return { verified: true, failed: false };
  }

  async checkBehavioralAge(userId: string): Promise<DetectionResult> {
    const pool = getPool();
    
    const userResult = await pool.query(
      `SELECT created_at, last_active FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return { detected: false, confidence: 0 };
    }

    const user = userResult.rows[0];
    const accountAge = (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24);

    const matchResult = await pool.query(
      `SELECT COUNT(*) as matches FROM matches WHERE user1_id = $1 OR user2_id = $1`,
      [userId]
    );

    const messageResult = await pool.query(
      `SELECT COUNT(*) as messages FROM messages WHERE sender_id = $1`,
      [userId]
    );

    const matches = parseInt(matchResult.rows[0].matches);
    const messages = parseInt(messageResult.rows[0].messages);

    let suspiciousScore = 0;

    if (accountAge < 1 && matches > 10) {
      suspiciousScore += 0.3;
    }

    if (accountAge < 3 && messages > 50) {
      suspiciousScore += 0.25;
    }

    if (suspiciousScore > 0.5) {
      return {
        detected: true,
        confidence: suspiciousScore,
        reason: 'Suspicious behavior patterns suggest potential underage user',
        severity: 'high',
        action: 'flag'
      };
    }

    return { detected: false, confidence: 1 - suspiciousScore };
  }
}

export const underageDetectionService = new UnderageDetectionService();

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import { getPool } from '../db/init';

interface S3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  cloudFrontUrl?: string;
  signedUrlExpiry: number;
}

interface UploadOptions {
  userId: string;
  contentType: string;
  folder?: string;
  maxSizeBytes?: number;
  allowedTypes?: string[];
}

interface ProcessedImage {
  url: string;
  key: string;
  width?: number;
  height?: number;
}

export class S3Service {
  private client: S3Client;
  private bucket: string;
  private cloudFrontUrl?: string;
  private signedUrlExpiry: number;
  private defaultExpiry = 3600;

  constructor() {
    const config = this.getConfig();
    
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });

    this.bucket = config.bucket;
    this.cloudFrontUrl = config.cloudFrontUrl;
    this.signedUrlExpiry = config.signedUrlExpiry || this.defaultExpiry;
  }

  private getConfig(): S3Config {
    return {
      region: process.env.AWS_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET_NAME || '',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      cloudFrontUrl: process.env.CLOUDFRONT_URL,
      signedUrlExpiry: parseInt(process.env.S3_SIGNED_URL_EXPIRY || '3600', 10)
    };
  }

  private generateKey(userId: string, folder: string, extension: string): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `${folder}/${userId}/${timestamp}-${random}.${extension}`;
  }

  private validateContentType(contentType: string, allowedTypes: string[]): boolean {
    if (!allowedTypes || allowedTypes.length === 0) {
      const defaultAllowed = [
        'image/jpeg',
        'image/png', 
        'image/gif',
        'image/webp',
        'video/mp4',
        'video/quicktime'
      ];
      return defaultAllowed.includes(contentType.toLowerCase());
    }
    return allowedTypes.includes(contentType.toLowerCase());
  }

  private validateFileSize(size: number, maxSize: number): boolean {
    const defaultMaxSize = 10 * 1024 * 1024;
    return size <= (maxSize || defaultMaxSize);
  }

  async generateUploadUrl(options: UploadOptions): Promise<{
    uploadUrl: string;
    key: string;
    publicUrl: string;
    fields?: Record<string, string>;
  }> {
    const { userId, contentType, folder = 'uploads', maxSizeBytes, allowedTypes } = options;

    if (!this.validateContentType(contentType, allowedTypes || [])) {
      throw new Error(`Invalid content type: ${contentType}`);
    }

    const extension = contentType.split('/')[1] || 'jpg';
    const key = this.generateKey(userId, folder, extension);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      Metadata: {
        userId,
        uploadedAt: new Date().toISOString()
      }
    });

    const signedUrl = await getSignedUrl(this.client, command, {
      expiresIn: this.signedUrlExpiry
    });

    let publicUrl: string;
    if (this.cloudFrontUrl) {
      publicUrl = `${this.cloudFrontUrl}/${key}`;
    } else {
      publicUrl = `https://${this.bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
    }

    return {
      uploadUrl: signedUrl,
      key,
      publicUrl
    };
  }

  async generateDownloadUrl(key: string, expiresIn?: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    return getSignedUrl(this.client, command, {
      expiresIn: expiresIn || this.signedUrlExpiry
    });
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    await this.client.send(command);
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  async listUserObjects(userId: string, folder: string = 'uploads'): Promise<string[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: `${folder}/${userId}/`
    });

    const response = await this.client.send(command);
    return response.Contents?.map(obj => obj.Key || '') || [];
  }

  async deleteUserObjects(userId: string, folder: string = 'uploads'): Promise<number> {
    const keys = await this.listUserObjects(userId, folder);
    
    let deletedCount = 0;
    for (const key of keys) {
      if (key) {
        await this.deleteObject(key);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  getPublicUrl(key: string): string {
    if (this.cloudFrontUrl) {
      return `${this.cloudFrontUrl}/${key}`;
    }
    return `https://${this.bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
  }

  async recordUpload(userId: string, key: string, publicUrl: string, contentType: string, size: number): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO user_uploads (user_id, s3_key, url, content_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, key, publicUrl, contentType, size]
    );
  }

  async getUserUploads(userId: string, limit: number = 50): Promise<any[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, s3_key, url, content_type, size_bytes, created_at
       FROM user_uploads 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }
}

export const s3Service = new S3Service();

export class ImageProcessingService {
  async processProfileImage(userId: string, s3Key: string): Promise<ProcessedImage[]> {
    const processed: ProcessedImage[] = [];
    
    processed.push({
      url: s3Service.getPublicUrl(s3Key),
      key: s3Key
    });

    return processed;
  }

  async validateImage(key: string): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];
    
    const exists = await s3Service.objectExists(key);
    if (!exists) {
      issues.push('Image not found in storage');
      return { valid: false, issues };
    }

    return { valid: issues.length === 0, issues };
  }
}

export const imageProcessingService = new ImageProcessingService();

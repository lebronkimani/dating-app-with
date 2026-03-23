import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

dotenv.config();

interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  ssl: boolean;
  pool: {
    min: number;
    max: number;
  };
}

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
}

interface JWTConfig {
  accessSecret: string;
  refreshSecret: string;
  accessExpiry: string;
  refreshExpiry: string;
}

interface EncryptionConfig {
  key: string;
  algorithm: string;
}

interface ExternalServiceConfig {
  sendgrid?: {
    apiKey: string;
    fromEmail: string;
  };
  twilio?: {
    accountSid: string;
    authToken: string;
    phoneNumber: string;
  };
  aws?: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    s3Bucket: string;
    rekognition: boolean;
  };
  azure?: {
    contentSafetyKey: string;
    endpoint: string;
  };
  google?: {
    visionKey: string;
  };
  openai?: {
    apiKey: string;
  };
  faceplusplus?: {
    apiKey: string;
    apiSecret: string;
  };
  ipinfo?: {
    apiKey: string;
  };
  ipqualityscore?: {
    apiKey: string;
  };
}

interface ServerConfig {
  port: number;
  env: 'development' | 'staging' | 'production';
  frontendUrl: string;
  corsOrigins: string[];
}

interface AppConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  jwt: JWTConfig;
  encryption: EncryptionConfig;
  external: ExternalServiceConfig;
}

class ConfigService {
  private config: AppConfig | null = null;
  private validationErrors: string[] = [];

  load(): AppConfig {
    if (this.config) {
      return this.config;
    }

    this.validate();

    if (this.validationErrors.length > 0) {
      console.error('Configuration validation errors:');
      this.validationErrors.forEach(err => console.error(`  - ${err}`));
      throw new Error('Invalid configuration');
    }

    this.config = {
      server: {
        port: parseInt(process.env.PORT || '3001'),
        env: (process.env.NODE_ENV as any) || 'development',
        frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
        corsOrigins: this.parseCorsOrigins(),
      },
      database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        name: process.env.DB_NAME || 'datingapp',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        ssl: process.env.DB_SSL === 'true',
        pool: {
          min: parseInt(process.env.DB_POOL_MIN || '2'),
          max: parseInt(process.env.DB_POOL_MAX || '20'),
        },
      },
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
      },
      jwt: {
        accessSecret: process.env.JWT_ACCESS_SECRET || this.generateSecret(),
        refreshSecret: process.env.JWT_REFRESH_SECRET || this.generateSecret(),
        accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
        refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
      },
      encryption: {
        key: process.env.ENCRYPTION_KEY || this.generateSecret(64),
        algorithm: 'aes-256-gcm',
      },
      external: {
        sendgrid: process.env.SENDGRID_API_KEY ? {
          apiKey: process.env.SENDGRID_API_KEY,
          fromEmail: process.env.EMAIL_FROM || 'noreply@globalconnect.com',
        } : undefined,
        twilio: process.env.TWILIO_ACCOUNT_SID ? {
          accountSid: process.env.TWILIO_ACCOUNT_SID,
          authToken: process.env.TWILIO_AUTH_TOKEN || '',
          phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
        } : undefined,
        aws: process.env.AWS_ACCESS_KEY_ID ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
          region: process.env.AWS_REGION || 'us-east-1',
          s3Bucket: process.env.S3_BUCKET || '',
          rekognition: process.env.AWS_REKOGNITION === 'true',
        } : undefined,
        azure: process.env.AZURE_CONTENT_SAFETY_KEY ? {
          contentSafetyKey: process.env.AZURE_CONTENT_SAFETY_KEY,
          endpoint: process.env.AZURE_CONTENT_SAFETY_ENDPOINT || '',
        } : undefined,
        google: process.env.GOOGLE_VISION_KEY ? {
          visionKey: process.env.GOOGLE_VISION_KEY,
        } : undefined,
        openai: process.env.OPENAI_API_KEY ? {
          apiKey: process.env.OPENAI_API_KEY,
        } : undefined,
        faceplusplus: process.env.FACEPLUSPLUS_API_KEY ? {
          apiKey: process.env.FACEPLUSPLUS_API_KEY,
          apiSecret: process.env.FACEPLUSPLUS_API_SECRET || '',
        } : undefined,
        ipinfo: process.env.IPINFO_API_KEY ? {
          apiKey: process.env.IPINFO_API_KEY,
        } : undefined,
        ipqualityscore: process.env.IPQUALITYSCORE_API_KEY ? {
          apiKey: process.env.IPQUALITYSCORE_API_KEY,
        } : undefined,
      },
    };

    this.logLoadedConfig();
    return this.config;
  }

  private validate(): void {
    this.validationErrors = [];

    if (!process.env.DB_PASSWORD) {
      this.validationErrors.push('DB_PASSWORD is required');
    }

    if (!process.env.JWT_ACCESS_SECRET && process.env.NODE_ENV === 'production') {
      this.validationErrors.push('JWT_ACCESS_SECRET is required in production');
    }

    if (!process.env.JWT_REFRESH_SECRET && process.env.NODE_ENV === 'production') {
      this.validationErrors.push('JWT_REFRESH_SECRET is required in production');
    }

    if (!process.env.ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
      this.validationErrors.push('ENCRYPTION_KEY is required in production');
    }

    if (process.env.NODE_ENV === 'production') {
      if (!process.env.DB_HOST || process.env.DB_HOST === 'localhost') {
        this.validationErrors.push('DB_HOST should not be localhost in production');
      }
    }
  }

  private parseCorsOrigins(): string[] {
    const origins = process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000';
    return origins.split(',').map(o => o.trim()).filter(Boolean);
  }

  private generateSecret(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  private logLoadedConfig(): void {
    const config = this.config!;
    console.log('='.repeat(50));
    console.log('Configuration loaded:');
    console.log(`  Server: ${config.server.env} mode on port ${config.server.port}`);
    console.log(`  Database: ${config.database.host}:${config.database.port}/${config.database.name}`);
    console.log(`  Redis: ${config.redis.host}:${config.redis.port}`);
    console.log(`  JWT: Access (${config.jwt.accessExpiry}), Refresh (${config.jwt.refreshExpiry})`);
    console.log(`  External services:`);
    console.log(`    - SendGrid: ${config.external.sendgrid ? '✓' : '✗'}`);
    console.log(`    - Twilio: ${config.external.twilio ? '✓' : '✗'}`);
    console.log(`    - AWS: ${config.external.aws ? '✓' : '✗'}`);
    console.log(`    - Azure: ${config.external.azure ? '✓' : '✗'}`);
    console.log(`    - Google Vision: ${config.external.google ? '✓' : '✗'}`);
    console.log(`    - OpenAI: ${config.external.openai ? '✓' : '✗'}`);
    console.log(`    - Face++: ${config.external.faceplusplus ? '✓' : '✗'}`);
    console.log(`    - IPInfo: ${config.external.ipinfo ? '✓' : '✗'}`);
    console.log(`    - IPQualityScore: ${config.external.ipqualityscore ? '✓' : '✗'}`);
    console.log('='.repeat(50));
  }

  get(): AppConfig {
    return this.load();
  }

  isProduction(): boolean {
    return this.load().server.env === 'production';
  }

  isDevelopment(): boolean {
    return this.load().server.env === 'development';
  }

  requireEnv(varName: string): string {
    const value = process.env[varName];
    if (!value) {
      throw new Error(`Required environment variable ${varName} is not set`);
    }
    return value;
  }

  getSecret(key: string): string | undefined {
    return process.env[key];
  }
}

export const configService = new ConfigService();
export default configService;

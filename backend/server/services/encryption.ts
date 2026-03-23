import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 32;

interface EncryptionResult {
  encrypted: string;
  iv: string;
  authTag: string;
  salt: string;
}

export class EncryptionService {
  private masterKey: string;

  constructor() {
    this.masterKey = process.env.ENCRYPTION_KEY || this.generateKey();
  }

  private generateKey(): string {
    return crypto.randomBytes(KEY_LENGTH).toString('hex');
  }

  private deriveKey(salt: string): Buffer {
    return crypto.pbkdf2Sync(this.masterKey, salt, 100000, KEY_LENGTH, 'sha512');
  }

  encrypt(plaintext: string): EncryptionResult {
    const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
    const key = this.deriveKey(salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      salt
    };
  }

  decrypt(encryptedData: EncryptionResult): string {
    const key = this.deriveKey(encryptedData.salt);
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const authTag = Buffer.from(encryptedData.authTag, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  encryptField(value: string): string {
    if (!value) return value;
    const result = this.encrypt(value);
    return `${result.salt}:${result.iv}:${result.authTag}:${result.encrypted}`;
  }

  decryptField(encryptedValue: string): string {
    if (!encryptedValue || !encryptedValue.includes(':')) return encryptedValue;
    
    try {
      const [salt, iv, authTag, encrypted] = encryptedValue.split(':');
      return this.decrypt({ salt, iv, authTag, encrypted });
    } catch (error) {
      console.error('Decryption failed:', error);
      return encryptedValue;
    }
  }

  hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
  }

  verifyPassword(password: string, storedHash: string): boolean {
    const [salt, hash] = storedHash.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
  }

  generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  generateApiKey(): string {
    const prefix = 'gcs_';
    const randomPart = crypto.randomBytes(24).toString('hex');
    return `${prefix}${randomPart}`;
  }
}

export const encryptionService = new EncryptionService();

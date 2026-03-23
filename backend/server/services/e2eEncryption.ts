import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export class E2EEncryptionService {
  generateKeyPair(): { publicKey: string; privateKey: string } {
    const ecdh = crypto.createECDH('secp256k1');
    ecdh.generateKeys();

    return {
      publicKey: ecdh.getPublicKey('base64'),
      privateKey: ecdh.getPrivateKey('base64')
    };
  }

  deriveSharedKey(privateKey: string, publicKey: string): Buffer {
    const ecdh = crypto.createECDH('secp256k1');
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64'));
    return ecdh.computeSecret(Buffer.from(publicKey, 'base64'));
  }

  encryptMessage(message: string, sharedKey: Buffer): {
    encrypted: string;
    iv: string;
    authTag: string;
  } {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, sharedKey, iv);

    let encrypted = cipher.update(message, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64')
    };
  }

  decryptMessage(encryptedData: { encrypted: string; iv: string; authTag: string }, sharedKey: Buffer): string {
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.authTag, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, sharedKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData.encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  encryptMessageForStorage(message: string, recipientPublicKey: string, senderPrivateKey: string): string {
    const sharedKey = this.deriveSharedKey(senderPrivateKey, recipientPublicKey);
    const { encrypted, iv, authTag } = this.encryptMessage(message, sharedKey);
    
    return JSON.stringify({ encrypted, iv, authTag });
  }

  decryptMessageFromStorage(encryptedData: string, recipientPrivateKey: string, senderPublicKey: string): string {
    const { encrypted, iv, authTag } = JSON.parse(encryptedData);
    const sharedKey = this.deriveSharedKey(recipientPrivateKey, senderPublicKey);
    
    return this.decryptMessage({ encrypted, iv, authTag }, sharedKey);
  }

  signMessage(message: string, privateKey: string): string {
    const sign = crypto.createSign('SHA256');
    sign.update(message);
    sign.end();
    
    return sign.sign(privateKey, 'base64');
  }

  verifySignature(message: string, signature: string, publicKey: string): boolean {
    const verify = crypto.createVerify('SHA256');
    verify.update(message);
    verify.end();
    
    return verify.verify(publicKey, signature, 'base64');
  }
}

export const e2eEncryptionService = new E2EEncryptionService();

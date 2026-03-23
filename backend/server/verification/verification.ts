import { getPool } from '../db/init';

export interface VerificationRecord {
  id: string;
  user_id: string;
  type: 'email' | 'phone' | 'photo' | 'identity';
  status: 'pending' | 'approved' | 'rejected';
  code?: string;
  expires_at?: Date;
  verified_at?: Date;
  metadata?: any;
}

const VERIFICATION_CODES = new Map<string, { code: string; expires: number }>();

export class VerificationService {
  
  async createVerification(userId: string, type: 'email' | 'phone' | 'photo' | 'identity'): Promise<string> {
    const pool = getPool();
    const code = this.generateCode(type);
    const expiresAt = new Date(Date.now() + (type === 'photo' ? 3600000 : 600000));
    
    const result = await pool.query(
      `INSERT INTO verifications (user_id, type, status, code, expires_at)
       VALUES ($1, $2, 'pending', $3, $4)
       ON CONFLICT (user_id, type) DO UPDATE SET code = $3, expires_at = $4, status = 'pending'
       RETURNING id`,
      [userId, type, code, expiresAt]
    );

    VERIFICATION_CODES.set(`${userId}:${type}`, { code, expires: expiresAt.getTime() });
    
    if (type === 'email') {
      console.log(`[EMAIL VERIFICATION] Code for ${userId}: ${code}`);
    } else if (type === 'phone') {
      console.log(`[PHONE VERIFICATION] Code for ${userId}: ${code}`);
    }
    
    return code;
  }

  private generateCode(type: string): string {
    if (type === 'photo') {
      return `photo_${Math.random().toString(36).substring(2, 15)}`;
    }
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async verifyCode(userId: string, type: 'email' | 'phone' | 'photo', code: string): Promise<boolean> {
    const pool = getPool();
    
    const record = VERIFICATION_CODES.get(`${userId}:${type}`);
    if (!record || Date.now() > record.expires) {
      return false;
    }

    if (type !== 'photo' && record.code !== code) {
      return false;
    }

    await pool.query(
      `UPDATE verifications SET status = 'approved', verified_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND type = $2`,
      [userId, type]
    );

    if (type === 'photo') {
      await pool.query(
        `UPDATE users SET is_verified = true WHERE id = $1`,
        [userId]
      );
    } else {
      await this.updateVerifiedBadge(userId);
    }

    VERIFICATION_CODES.delete(`${userId}:${type}`);
    return true;
  }

  private async updateVerifiedBadge(userId: string) {
    const pool = getPool();
    
    const verifications = await pool.query(
      `SELECT type FROM verifications WHERE user_id = $1 AND status = 'approved'`,
      [userId]
    );

    const verifiedTypes = verifications.rows.map(r => r.type);
    const shouldBadge = verifiedTypes.includes('email') && verifiedTypes.includes('phone');

    if (shouldBadge) {
      await pool.query(`UPDATE users SET is_verified = true WHERE id = $1`, [userId]);
    }
  }

  async getVerificationStatus(userId: string) {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT type, status, verified_at FROM verifications WHERE user_id = $1`,
      [userId]
    );

    const verifications = result.rows.reduce((acc: any, row) => {
      acc[row.type] = { status: row.status, verified_at: row.verified_at };
      return acc;
    }, {});

    return {
      email: verifications['email']?.status === 'approved',
      phone: verifications['phone']?.status === 'approved',
      photo: verifications['photo']?.status === 'approved',
      badge: (await pool.query(`SELECT is_verified FROM users WHERE id = $1`, [userId])).rows[0]?.is_verified || false
    };
  }

  async submitPhotoVerification(userId: string, photoData: string) {
    const pool = getPool();
    
    await pool.query(
      `INSERT INTO verifications (user_id, type, status, code, metadata)
       VALUES ($1, 'photo', 'pending', $2, $3)
       ON CONFLICT (user_id, type) DO UPDATE SET status = 'pending', metadata = $3`,
      [userId, `photo_${Date.now()}`, { photo: photoData, submitted_at: new Date() }]
    );

    return { status: 'pending', message: 'Photo verification submitted. Processing within 24 hours.' };
  }

  async approvePhotoVerification(userId: string) {
    const pool = getPool();
    
    await pool.query(
      `UPDATE verifications SET status = 'approved', verified_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND type = 'photo'`,
      [userId]
    );

    await pool.query(`UPDATE users SET is_verified = true WHERE id = $1`, [userId]);
    
    return { success: true };
  }

  async rejectPhotoVerification(userId: string, reason: string) {
    const pool = getPool();
    
    await pool.query(
      `UPDATE verifications SET status = 'rejected', metadata = jsonb_set(metadata, '{rejection_reason}', $1)
       WHERE user_id = $2 AND type = 'photo'`,
      [reason, userId]
    );
    
    return { success: true };
  }
}

export const verificationService = new VerificationService();
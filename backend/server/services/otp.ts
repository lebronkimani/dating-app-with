import { getPool, generateId } from '../db/init';
import { redisService } from './redis';

export class OTPService {
  private readonly CODE_LENGTH = 6;
  private readonly CODE_EXPIRY = 300;
  private readonly MAX_ATTEMPTS = 3;
  private readonly RATE_LIMIT_WINDOW = 3600;

  async sendOTPEmail(email: string, purpose: 'email_verification' | 'password_reset' | 'account_change'): Promise<{ success: boolean; message: string; otpId?: string }> {
    const normalizedEmail = email.toLowerCase().trim();
    
    if (!this.validateEmail(normalizedEmail)) {
      return { success: false, message: 'Invalid email format' };
    }

    const rateLimitKey = `otp:ratelimit:${normalizedEmail}`;
    const attemptCount = await redisService.get(rateLimitKey);
    
    if (attemptCount && parseInt(attemptCount) >= 5) {
      return { success: false, message: 'Too many requests. Please try again later.' };
    }

    const existingOTP = await this.getExistingOTP(normalizedEmail, purpose);
    if (existingOTP) {
      const timeSinceLastSent = Date.now() - existingOTP.createdAt;
      if (timeSinceLastSent < 60000) {
        return { success: false, message: 'Please wait 60 seconds before requesting another code' };
      }
    }

    const code = this.generateCode();
    const otpId = generateId();

    const otpRecord = {
      id: otpId,
      email: normalizedEmail,
      code: this.hashCode(code),
      purpose,
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + (this.CODE_EXPIRY * 1000),
      verified: false
    };

    await this.storeOTP(otpRecord);
    await this.incrementRateLimit(normalizedEmail);

    await this.sendEmail(normalizedEmail, code, purpose);
    
    return { success: true, message: 'Verification code sent to email', otpId };
  }

  async verifyOTPEmail(email: string, code: string, purpose: 'email_verification' | 'password_reset' | 'account_change'): Promise<{ success: boolean; message: string }> {
    const normalizedEmail = email.toLowerCase().trim();
    
    const otpRecord = await this.getExistingOTP(normalizedEmail, purpose);
    
    if (!otpRecord) {
      return { success: false, message: 'No verification code found. Please request a new code' };
    }

    if (otpRecord.verified) {
      return { success: false, message: 'This code has already been used' };
    }

    if (Date.now() > otpRecord.expiresAt) {
      await this.deleteOTP(otpRecord.id);
      return { success: false, message: 'Code expired. Please request a new one' };
    }

    if (otpRecord.attempts >= this.MAX_ATTEMPTS) {
      await this.deleteOTP(otpRecord.id);
      return { success: false, message: 'Too many failed attempts. Please request a new code' };
    }

    const codeHash = this.hashCode(code);
    if (codeHash !== otpRecord.code) {
      await this.incrementAttempts(otpRecord.id, otpRecord.attempts + 1);
      const remaining = this.MAX_ATTEMPTS - (otpRecord.attempts + 1);
      return { 
        success: false, 
        message: remaining > 0 
          ? `Incorrect code. ${remaining} attempts remaining` 
          : 'Too many failed attempts. Please request a new code'
      };
    }

    await this.markAsVerified(otpRecord.id);

    return { success: true, message: 'Email verified successfully' };
  }

  async resendOTP(email: string, purpose: 'email_verification' | 'password_reset' | 'account_change'): Promise<{ success: boolean; message: string }> {
    return this.sendOTPEmail(email, purpose);
  }

  async cancelOTP(email: string, purpose: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();
    const otpRecord = await this.getExistingOTP(normalizedEmail, purpose);
    if (otpRecord) {
      await this.deleteOTP(otpRecord.id);
    }
  }

  async checkEmailVerified(email: string, purpose: 'email_verification' | 'password_reset' | 'account_change'): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim();
    const otpRecord = await this.getExistingOTP(normalizedEmail, purpose);
    return otpRecord?.verified || false;
  }

  private generateCode(): string {
    let code = '';
    for (let i = 0; i < this.CODE_LENGTH; i++) {
      code += Math.floor(Math.random() * 10).toString();
    }
    return code;
  }

  private hashCode(code: string): string {
    let hash = 0;
    for (let i = 0; i < code.length; i++) {
      const char = code.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private async storeOTP(otp: any): Promise<void> {
    const key = `otp:${otp.purpose}:${otp.email}`;
    await redisService.set(key, JSON.stringify(otp), this.CODE_EXPIRY);
  }

  private async getExistingOTP(email: string, purpose: string): Promise<any | null> {
    const key = `otp:${purpose}:${email}`;
    const data = await redisService.get(key);
    return data ? JSON.parse(data) : null;
  }

  private async deleteOTP(otpId: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM otps WHERE id = $1', [otpId]);
  }

  private async incrementAttempts(otpId: string, attempts: number): Promise<void> {
    const pool = getPool();
    await pool.query(
      'INSERT INTO otp_attempts (otp_id, attempts) VALUES ($1, $2) ON CONFLICT (otp_id) DO UPDATE SET attempts = $2',
      [otpId, attempts]
    );
  }

  private async markAsVerified(otpId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      'INSERT INTO otp_verifications (otp_id, verified_at) VALUES ($1, NOW()) ON CONFLICT (otp_id) DO UPDATE SET verified_at = NOW()',
      [otpId]
    );
  }

  private async incrementRateLimit(email: string): Promise<void> {
    const key = `otp:ratelimit:${email}`;
    const current = await redisService.get(key);
    const count = current ? parseInt(current) + 1 : 1;
    await redisService.set(key, count.toString(), this.RATE_LIMIT_WINDOW);
  }

  private async sendEmail(email: string, code: string, purpose: string): Promise<void> {
    const message = this.getEmailMessage(code, purpose);
    const subject = this.getEmailSubject(purpose);
    
    const sendgridKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || 'noreply@globalconnect.com';

    if (sendgridKey) {
      try {
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sendgridKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email }] }],
            from: { email: fromEmail, name: 'GlobalConnect' },
            subject,
            content: [
              { type: 'text/plain', value: message },
              { type: 'text/html', value: this.getEmailHTML(code, purpose) }
            ]
          })
        });

        if (!response.ok) {
          console.error('SendGrid error:', await response.text());
        }
      } catch (error) {
        console.error('SendGrid error:', error);
      }
    }

    console.log(`[OTP EMAIL] To: ${email}, Subject: ${subject}, Code: ${code}`);
  }

  private getEmailSubject(purpose: string): string {
    const appName = process.env.APP_NAME || 'GlobalConnect';
    
    switch (purpose) {
      case 'email_verification':
        return `${appName} - Verify Your Email`;
      case 'password_reset':
        return `${appName} - Password Reset Request`;
      case 'account_change':
        return `${appName} - Account Change Verification`;
      default:
        return `${appName} - Verification Code`;
    }
  }

  private getEmailMessage(code: string, purpose: string): string {
    const appName = process.env.APP_NAME || 'GlobalConnect';
    
    switch (purpose) {
      case 'email_verification':
        return `Welcome to ${appName}!\n\nYour email verification code is: ${code}\n\nThis code is valid for 5 minutes.\n\nIf you didn't request this, please ignore this email.`;
      case 'password_reset':
        return `${appName} Password Reset\n\nYour password reset code is: ${code}\n\nThis code is valid for 5 minutes.\n\nIf you didn't request this, please ignore this email.`;
      case 'account_change':
        return `${appName} Account Change Verification\n\nYour verification code is: ${code}\n\nThis code is valid for 5 minutes.`;
      default:
        return `Your verification code is: ${code}`;
    }
  }

  private getEmailHTML(code: string, purpose: string): string {
    const appName = process.env.APP_NAME || 'GlobalConnect';
    const year = new Date().getFullYear();
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5; padding: 20px;">
  <div style="max-width: 400px; margin: 0 auto; background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #ec4899, #8b5cf6); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
        <span style="font-size: 30px;">💜</span>
      </div>
      <h1 style="font-size: 24px; color: #1f2937; margin: 16px 0 8px;">${appName}</h1>
      <p style="color: #6b7280; margin: 0;">${this.getEmailTitle(purpose)}</p>
    </div>
    
    <div style="background: #f9fafb; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px;">
      <p style="color: #6b7280; font-size: 14px; margin: 0 0 12px;">Your verification code:</p>
      <p style="font-size: 32px; font-weight: bold; color: #ec4899; letter-spacing: 8px; margin: 0;">${code}</p>
    </div>
    
    <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
      This code expires in 5 minutes.<br>
      If you didn't request this, please ignore this email.
    </p>
    
    <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #e5e7eb; text-align: center;">
      <p style="color: #9ca3af; font-size: 11px; margin: 0;">
        © ${year} ${appName}. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>`;
  }

  private getEmailTitle(purpose: string): string {
    switch (purpose) {
      case 'email_verification': return 'Verify your email address';
      case 'password_reset': return 'Reset your password';
      case 'account_change': return 'Verify your account change';
      default: return 'Verification code';
    }
  }
}

export const otpService = new OTPService();

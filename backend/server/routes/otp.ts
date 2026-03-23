import { Router, Request, Response } from 'express';
import { otpService } from '../services/otp';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

router.post('/send', rateLimit('otp'), async (req: Request, res: Response) => {
  try {
    const { email, purpose } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const validPurposes = ['email_verification', 'password_reset', 'account_change'];
    const otpPurpose = purpose && validPurposes.includes(purpose) ? purpose : 'email_verification';

    const result = await otpService.sendOTPEmail(email, otpPurpose);
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        otpId: result.otpId,
        expiresIn: 300
      });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

router.post('/verify', rateLimit('otp_verify'), async (req: Request, res: Response) => {
  try {
    const { email, code, purpose } = req.body;
    
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }

    const validPurposes = ['email_verification', 'password_reset', 'account_change'];
    const otpPurpose = purpose && validPurposes.includes(purpose) ? purpose : 'email_verification';

    const result = await otpService.verifyOTPEmail(email, code, otpPurpose);
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

router.post('/resend', rateLimit('otp'), async (req: Request, res: Response) => {
  try {
    const { email, purpose } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const validPurposes = ['email_verification', 'password_reset', 'account_change'];
    const otpPurpose = purpose && validPurposes.includes(purpose) ? purpose : 'email_verification';

    const result = await otpService.resendOTP(email, otpPurpose);
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        expiresIn: 300
      });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ error: 'Failed to resend code' });
  }
});

router.post('/cancel', async (req: Request, res: Response) => {
  try {
    const { email, purpose } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    await otpService.cancelOTP(email, purpose || 'email_verification');
    
    res.json({ success: true, message: 'Verification code cancelled' });
  } catch (error) {
    console.error('Cancel OTP error:', error);
    res.status(500).json({ error: 'Failed to cancel code' });
  }
});

router.get('/verified/:email', async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    
    const purpose = (req.query.purpose as string) || 'email_verification';
    
    const isVerified = await otpService.checkEmailVerified(email, purpose);
    res.json({ verified: isVerified });
  } catch (error) {
    console.error('Check verified error:', error);
    res.status(500).json({ error: 'Failed to check verification status' });
  }
});

export default router;

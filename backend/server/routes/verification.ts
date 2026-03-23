import { Router, Request, Response } from 'express';
import { verificationService } from '../verification/verification';
import { requireRole } from '../middleware/security';

const router = Router();

const requireModerator = requireRole('admin', 'moderator');

router.post('/send-code', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { type } = req.body;
    if (!type || !['email', 'phone', 'photo'].includes(type)) {
      return res.status(400).json({ error: 'Invalid verification type' });
    }

    await verificationService.createVerification(userId, type);
    
    res.json({ 
      message: type === 'photo' ? 'Photo verification initiated' : 'Verification code sent'
    });
  } catch (error) {
    console.error('Send code error:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

router.post('/verify', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { type, code } = req.body;
    if (!type || !code) {
      return res.status(400).json({ error: 'Missing type or code' });
    }

    const success = await verificationService.verifyCode(userId, type, code);
    
    if (success) {
      const status = await verificationService.getVerificationStatus(userId);
      res.json({ success: true, verified: status.badge, status });
    } else {
      res.status(400).json({ error: 'Invalid or expired code' });
    }
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ error: 'Failed to verify' });
  }
});

router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const status = await verificationService.getVerificationStatus(userId);
    res.json(status);
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: 'Failed to get verification status' });
  }
});

router.post('/photo/submit', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { photo } = req.body;
    if (!photo) {
      return res.status(400).json({ error: 'Photo required' });
    }

    const result = await verificationService.submitPhotoVerification(userId, photo);
    res.json(result);
  } catch (error) {
    console.error('Photo submit error:', error);
    res.status(500).json({ error: 'Failed to submit photo' });
  }
});

router.post('/photo/approve/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const result = await verificationService.approvePhotoVerification(userId);
    res.json(result);
  } catch (error) {
    console.error('Approve error:', error);
    res.status(500).json({ error: 'Failed to approve' });
  }
});

router.post('/photo/reject/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const result = await verificationService.rejectPhotoVerification(userId, reason);
    res.json(result);
  } catch (error) {
    console.error('Reject error:', error);
    res.status(500).json({ error: 'Failed to reject' });
  }
});

export default router;
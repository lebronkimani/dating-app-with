import { Router, Request, Response } from 'express';
import { getPool } from '../db/init';
import { requireRole } from '../middleware/security';

const router = Router();

const requireModerator = requireRole('admin', 'moderator');

router.post('/photo/verify', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { selfieBase64, confidence } = req.body;
    
    if (!selfieBase64) {
      return res.status(400).json({ error: 'Selfie image required' });
    }

    const pool = getPool();
    
    const userResult = await pool.query(
      'SELECT images FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userImages = userResult.rows[0].images || [];
    
    if (userImages.length === 0) {
      return res.status(400).json({ error: 'No profile images to compare' });
    }

    await pool.query(
      `INSERT INTO verifications (user_id, type, status, code, metadata)
       VALUES ($1, 'photo', 'pending', $2, $3)
       ON CONFLICT (user_id, type) DO UPDATE SET status = 'pending', metadata = $3`,
      [userId, `face_${Date.now()}`, { 
        selfie: selfieBase64.substring(0, 100) + '...',
        confidence: confidence,
        submitted_at: new Date() 
      }]
    );

    if (confidence >= 0.55) {
      await pool.query(
        `UPDATE verifications SET status = 'approved', verified_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND type = 'photo'`,
        [userId]
      );

      await pool.query(
        `UPDATE users SET is_verified = true WHERE id = $1`,
        [userId]
      );
      
      res.json({
        verified: true,
        message: 'Face verified! You are now a verified user.',
        autoApproved: true
      });
    } else {
      res.json({
        verified: false,
        message: 'Face comparison inconclusive. Awaiting admin review.',
        confidence,
        requiresReview: true
      });
    }
  } catch (error) {
    console.error('Face verification error:', error);
    res.status(500).json({ error: 'Face verification failed' });
  }
});

router.get('/pending-photo-verifications', requireModerator, async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT v.id, v.user_id, v.status, v.created_at, v.metadata, u.name, u.images
       FROM verifications v
       JOIN users u ON u.id = v.user_id
       WHERE v.type = 'photo' AND v.status = 'pending'
       ORDER BY v.created_at DESC
       LIMIT 20`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get pending verifications error:', error);
    res.status(500).json({ error: 'Failed to get pending verifications' });
  }
});

router.post('/photo/verify/manual/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { approved, reason } = req.body;
    
    const pool = getPool();
    
    if (approved) {
      await pool.query(
        `UPDATE verifications SET status = 'approved', verified_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND type = 'photo'`,
        [userId]
      );
      
      await pool.query(
        `UPDATE users SET is_verified = true WHERE id = $1`,
        [userId]
      );
      
      res.json({ success: true, message: 'User verified' });
    } else {
      await pool.query(
        `UPDATE verifications SET status = 'rejected', 
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('rejection_reason', $1)
         WHERE user_id = $2 AND type = 'photo'`,
        [reason || 'Manual rejection', userId]
      );
      
      res.json({ success: true, message: 'Verification rejected' });
    }
  } catch (error) {
    console.error('Manual verification error:', error);
    res.status(500).json({ error: 'Failed to process verification' });
  }
});

export default router;
import { Router, Request, Response } from 'express';
import { moderationService } from '../services/moderation';
import { spamDetectionService } from '../services/spamDetection';
import { contentModerationService } from '../services/contentModeration';
import { fraudDetectionService } from '../services/fraudDetection/index';
import { requireRole } from '../middleware/security';
import { 
  underageDetectionService,
  nudityDetectionService,
  harassmentDetectionService,
  fakeLocationDetectionService,
  impersonationDetectionService,
  safetyRiskScoreService,
  deviceFingerprintService
} from '../services/safety/index';

const router = Router();

const requireModerator = requireRole('admin', 'moderator');
const requireAdmin = requireRole('admin');

const requireAuth = (req: Request, res: Response, next: Function) => {
  const userId = req.headers['x-user-id'] as string;
  const userRole = req.headers['x-user-role'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  (req as any).userId = userId;
  (req as any).userRole = userRole;
  next();
};

router.get('/status/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const status = await moderationService.getModerationStatus(userId);
    res.json(status);
  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({ error: 'Failed to get moderation status' });
  }
});

router.get('/can-swipe/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const canSwipe = await moderationService.canUserSwipe(userId);
    res.json({ canSwipe });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check swipe permission' });
  }
});

router.get('/can-message/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const canMessage = await moderationService.canUserMessage(userId);
    res.json({ canMessage });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check message permission' });
  }
});

router.get('/in-discovery/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const inDiscovery = await moderationService.isInDiscovery(userId);
    res.json({ inDiscovery });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check discovery status' });
  }
});

router.post('/report', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { reportedUserId, reason, description } = req.body;
    
    if (!reportedUserId || !reason) {
      return res.status(400).json({ error: 'Reported user and reason required' });
    }

    await spamDetectionService.checkReportSpam(userId, reportedUserId);
    const reportId = await moderationService.reportUser(userId, reportedUserId, reason, description);

    res.json({ success: true, reportId, message: 'Report submitted successfully' });
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

router.post('/block', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { blockedUserId, reason } = req.body;
    
    if (!blockedUserId) {
      return res.status(400).json({ error: 'Blocked user ID required' });
    }

    await moderationService.blockUser(userId, blockedUserId, reason);
    res.json({ success: true, message: 'User blocked' });
  } catch (error) {
    console.error('Block error:', error);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

router.post('/unblock', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { blockedUserId } = req.body;
    
    if (!blockedUserId) {
      return res.status(400).json({ error: 'Blocked user ID required' });
    }

    await moderationService.unblockUser(userId, blockedUserId);
    res.json({ success: true, message: 'User unblocked' });
  } catch (error) {
    console.error('Unblock error:', error);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

router.get('/blocks', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const blockedUsers = await moderationService.getBlockedUsers(userId);
    res.json({ blockedUsers });
  } catch (error) {
    console.error('Get blocks error:', error);
    res.status(500).json({ error: 'Failed to get blocked users' });
  }
});

router.get('/reports/received', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const reports = await moderationService.getUserReports(userId);
    res.json({ reports });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Failed to get reports' });
  }
});

router.post('/check-message', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { message, recipientId } = req.body;
    
    const result = await spamDetectionService.checkMessageSpam(userId, message, recipientId);
    res.json(result);
  } catch (error) {
    console.error('Check message error:', error);
    res.status(500).json({ error: 'Failed to check message' });
  }
});

router.post('/check-swipe', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await spamDetectionService.checkSwipeSpam(userId);
    res.json(result);
  } catch (error) {
    console.error('Check swipe error:', error);
    res.status(500).json({ error: 'Failed to check swipe' });
  }
});

router.post('/moderate-photo', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { imageUrl, contentId } = req.body;

    const result = await contentModerationService.moderateImage(imageUrl, userId, contentId);
    res.json(result);
  } catch (error) {
    console.error('Moderate photo error:', error);
    res.status(500).json({ error: 'Failed to moderate photo' });
  }
});

router.post('/moderate-text', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { text, contentType, contentId } = req.body;

    const result = await contentModerationService.moderateText(text, userId, contentType, contentId);
    res.json(result);
  } catch (error) {
    console.error('Moderate text error:', error);
    res.status(500).json({ error: 'Failed to moderate text' });
  }
});

router.get('/spam-logs/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const requestedUserId = req.params.userId;
    const currentUserId = (req as any).userId;
    const currentUserRole = (req as any).userRole;
    
    if (requestedUserId !== currentUserId && !['admin', 'moderator'].includes(currentUserRole)) {
      return res.status(403).json({ error: 'Cannot access other user logs' });
    }
    
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const logs = await spamDetectionService.getSpamLogs(requestedUserId, limit);
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get spam logs' });
  }
});

router.get('/content-queue', requireModerator, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string || 'pending';
    const limit = parseInt(req.query.limit as string) || 50;
    const queue = await contentModerationService.getModerationQueue(status, limit);
    res.json({ queue });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get content queue' });
  }
});

router.post('/approve-content/:queueId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { queueId } = req.params;
    const userId = req.headers['x-user-id'] as string;
    
    await contentModerationService.approveContent(queueId, userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve content' });
  }
});

router.post('/reject-content/:queueId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { queueId } = req.params;
    const userId = req.headers['x-user-id'] as string;
    const { reason } = req.body;
    
    await contentModerationService.rejectContent(queueId, reason, userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject content' });
  }
});

router.get('/fraud/score/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const score = await fraudDetectionService.getRiskScore(userId);
    res.json({ userId, score });
  } catch (error) {
    console.error('Get fraud score error:', error);
    res.status(500).json({ error: 'Failed to get fraud score' });
  }
});

router.get('/fraud/profile/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const profile = await fraudDetectionService.getRiskProfile(userId);
    res.json(profile);
  } catch (error) {
    console.error('Get fraud profile error:', error);
    res.status(500).json({ error: 'Failed to get fraud profile' });
  }
});

router.post('/fraud/analyze/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const result = await fraudDetectionService.analyzeUser(userId);
    res.json(result);
  } catch (error) {
    console.error('Fraud analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze user' });
  }
});

router.get('/fraud/high-risk', requireModerator, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const users = await fraudDetectionService.getHighRiskUsers(limit);
    res.json({ users });
  } catch (error) {
    console.error('Get high risk users error:', error);
    res.status(500).json({ error: 'Failed to get high risk users' });
  }
});

router.post('/fraud/check-message', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { message } = req.body;
    
    const result = await fraudDetectionService.checkMessage(userId, message);
    res.json(result);
  } catch (error) {
    console.error('Fraud check message error:', error);
    res.status(500).json({ error: 'Failed to check message' });
  }
});

router.post('/fraud/check-swipe', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await fraudDetectionService.checkSwipe(userId);
    res.json(result);
  } catch (error) {
    console.error('Fraud check swipe error:', error);
    res.status(500).json({ error: 'Failed to check swipe' });
  }
});

router.post('/fraud/check-profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const { ipAddress, deviceId } = req.body;
    
    const result = await fraudDetectionService.checkProfileCreation(ipAddress, deviceId);
    res.json(result);
  } catch (error) {
    console.error('Fraud check profile error:', error);
    res.status(500).json({ error: 'Failed to check profile' });
  }
});

router.post('/safety/check-underage/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const result = await underageDetectionService.checkAge(userId);
    res.json(result);
  } catch (error) {
    console.error('Underage check error:', error);
    res.status(500).json({ error: 'Failed to check age' });
  }
});

router.post('/safety/verify-age', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { idDocument } = req.body;
    const result = await underageDetectionService.verifyAge(userId, idDocument);
    res.json(result);
  } catch (error) {
    console.error('Age verification error:', error);
    res.status(500).json({ error: 'Failed to verify age' });
  }
});

router.post('/safety/analyze-nudity', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { imageUrl } = req.body;
    const result = await nudityDetectionService.analyzeImage(imageUrl, userId);
    res.json(result);
  } catch (error) {
    console.error('Nudity analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze image' });
  }
});

router.post('/safety/check-profile-photos', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const result = await nudityDetectionService.analyzeProfilePhotos(userId);
    res.json(result);
  } catch (error) {
    console.error('Profile photos check error:', error);
    res.status(500).json({ error: 'Failed to check profile photos' });
  }
});

router.post('/safety/analyze-harassment', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { message, recipientId } = req.body;
    const result = await harassmentDetectionService.analyzeMessage(message, userId, recipientId);
    res.json(result);
  } catch (error) {
    console.error('Harassment analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze message' });
  }
});

router.get('/safety/conversation/:userId1/:userId2', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId1, userId2 } = req.params;
    const result = await harassmentDetectionService.analyzeConversation(userId1, userId2);
    res.json(result);
  } catch (error) {
    console.error('Conversation analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze conversation' });
  }
});

router.post('/safety/analyze-location', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { latitude, longitude, ipAddress } = req.body;
    const result = await fakeLocationDetectionService.analyzeLocation(userId, latitude, longitude, ipAddress);
    res.json(result);
  } catch (error) {
    console.error('Location analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze location' });
  }
});

router.post('/safety/update-location', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { latitude, longitude, accuracy } = req.body;
    await fakeLocationDetectionService.updateUserLocation(userId, latitude, longitude, accuracy);
    res.json({ success: true });
  } catch (error) {
    console.error('Location update error:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

router.get('/safety/location-anomalies/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const result = await fakeLocationDetectionService.detectLocationAnomalies(userId);
    res.json(result);
  } catch (error) {
    console.error('Location anomalies error:', error);
    res.status(500).json({ error: 'Failed to detect anomalies' });
  }
});

router.post('/safety/check-impersonation', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const result = await impersonationDetectionService.analyzeProfile(userId);
    res.json(result);
  } catch (error) {
    console.error('Impersonation check error:', error);
    res.status(500).json({ error: 'Failed to check impersonation' });
  }
});

router.get('/safety/impersonation-reports', requireModerator, async (req: Request, res: Response) => {
  try {
    const result = await impersonationDetectionService.getImpersonationReports();
    res.json({ reports: result });
  } catch (error) {
    console.error('Impersonation reports error:', error);
    res.status(500).json({ error: 'Failed to get reports' });
  }
});

router.get('/safety/risk-score/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const cached = await safetyRiskScoreService.getCachedScore(userId);
    if (cached) {
      return res.json(cached);
    }
    const score = await safetyRiskScoreService.calculateUnifiedScore(userId);
    res.json(score);
  } catch (error) {
    console.error('Risk score error:', error);
    res.status(500).json({ error: 'Failed to calculate risk score' });
  }
});

router.post('/safety/risk-score/:userId/apply', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const score = await safetyRiskScoreService.calculateUnifiedScore(userId);
    await safetyRiskScoreService.applyAutomatedActions(userId, score);
    res.json({ success: true, score, actions: score.actions });
  } catch (error) {
    console.error('Apply actions error:', error);
    res.status(500).json({ error: 'Failed to apply automated actions' });
  }
});

router.post('/safety/analyze-message', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { message, recipientId } = req.body;
    const result = await safetyRiskScoreService.analyzeMessage(userId, message, recipientId);
    res.json(result);
  } catch (error) {
    console.error('Message analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze message' });
  }
});

router.post('/safety/analyze-location-check', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { latitude, longitude, ipAddress } = req.body;
    const result = await safetyRiskScoreService.analyzeLocation(userId, latitude, longitude, ipAddress);
    res.json(result);
  } catch (error) {
    console.error('Location analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze location' });
  }
});

router.post('/safety/update-location', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { latitude, longitude, accuracy, ipAddress, deviceFingerprint, isMockLocation } = req.body;
    await fakeLocationDetectionService.updateUserLocation(userId, latitude, longitude, accuracy, ipAddress, deviceFingerprint, isMockLocation);
    res.json({ success: true });
  } catch (error) {
    console.error('Location update error:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

router.post('/safety/verify-location', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { selfieWithLocation, liveGps } = req.body;
    const result = await fakeLocationDetectionService.verifyLocationChallenge(userId, { selfieWithLocation, liveGps });
    res.json(result);
  } catch (error) {
    console.error('Location verification error:', error);
    res.status(500).json({ error: 'Failed to verify location' });
  }
});

router.post('/device/fingerprint', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { userAgent, screenResolution, timezone, language, platform, hardwareConcurrency, deviceMemory, ipAddress } = req.body;
    const fingerprint = await deviceFingerprintService.createFingerprint(userId, {
      userAgent, screenResolution, timezone, language, platform, hardwareConcurrency, deviceMemory, ipAddress
    });
    res.json({ fingerprint });
  } catch (error) {
    console.error('Fingerprint error:', error);
    res.status(500).json({ error: 'Failed to create fingerprint' });
  }
});

router.get('/device/history/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const requestedUserId = req.params.userId;
    const currentUserId = (req as any).userId;
    const currentUserRole = (req as any).userRole;
    
    if (requestedUserId !== currentUserId && !['admin', 'moderator'].includes(currentUserRole)) {
      return res.status(403).json({ error: 'Cannot access other user device history' });
    }
    
    const history = await deviceFingerprintService.getDeviceHistory(requestedUserId);
    res.json({ history });
  } catch (error) {
    console.error('Device history error:', error);
    res.status(500).json({ error: 'Failed to get device history' });
  }
});

router.get('/device/sharing/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const result = await deviceFingerprintService.detectAccountSharing(userId);
    res.json(result);
  } catch (error) {
    console.error('Account sharing error:', error);
    res.status(500).json({ error: 'Failed to detect account sharing' });
  }
});

router.get('/device/vpn-behavior/:userId', requireModerator, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const result = await deviceFingerprintService.detectVPNByBehavior(userId);
    res.json(result);
  } catch (error) {
    console.error('VPN behavior error:', error);
    res.status(500).json({ error: 'Failed to detect VPN behavior' });
  }
});

export default router;

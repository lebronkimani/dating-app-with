import { Router, Request, Response } from 'express';
import { recommendationEngine } from '../ml/recommendations';
import { adTargetingEngine } from '../ml/adTargeting';
import { embeddingService } from '../ml/embeddings';
import { twoTowerService } from '../ml/twoTowerMatching';
import { rlService } from '../ml/reinforcementLearning';

const router = Router();

router.post('/init', async (req: Request, res: Response) => {
  try {
    await recommendationEngine.initialize();
    await adTargetingEngine.initialize();
    await embeddingService.initialize();
    res.json({ status: 'ML engines initialized' });
  } catch (error) {
    console.error('ML init error:', error);
    res.status(500).json({ error: 'Failed to initialize ML engines' });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    await recommendationEngine.refreshData();
    await embeddingService.initialize();
    res.json({ status: 'ML data refreshed', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('ML refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh ML data' });
  }
});

router.get('/embeddings/stats', async (req: Request, res: Response) => {
  try {
    const stats = embeddingService.getEmbeddingStats();
    res.json(stats);
  } catch (error) {
    console.error('Embedding stats error:', error);
    res.status(500).json({ error: 'Failed to get embedding stats' });
  }
});

router.get('/embeddings/similar/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;
    
    const similarUsers = await recommendationEngine.findSimilarUsersByEmbedding(userId, limit);
    res.json(similarUsers);
  } catch (error) {
    console.error('Similar users error:', error);
    res.status(500).json({ error: 'Failed to find similar users' });
  }
});

router.get('/embeddings/compatibility/:userId1/:userId2', async (req: Request, res: Response) => {
  try {
    const { userId1, userId2 } = req.params;
    
    const score = await embeddingService.computeCompatibilityScore(userId1, userId2);
    res.json({ 
      compatibilityScore: Math.round(score * 100) / 100,
      interpretation: score > 0.7 ? 'Highly compatible' : score > 0.5 ? 'Moderately compatible' : 'Less compatible'
    });
  } catch (error) {
    console.error('Compatibility score error:', error);
    res.status(500).json({ error: 'Failed to compute compatibility' });
  }
});

router.post('/embeddings/update', async (req: Request, res: Response) => {
  try {
    const { userId, targetId, action } = req.body;
    
    if (!userId || !targetId || !action) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    await recommendationEngine.updateEmbeddingFromSwipe(userId, targetId, action);
    res.json({ success: true });
  } catch (error) {
    console.error('Update embedding error:', error);
    res.status(500).json({ error: 'Failed to update embedding' });
  }
});

router.get('/two-tower/stats', async (req: Request, res: Response) => {
  try {
    const stats = twoTowerService.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Two-tower stats error:', error);
    res.status(500).json({ error: 'Failed to get two-tower stats' });
  }
});

router.get('/two-tower/compatibility/:userId/:candidateId', async (req: Request, res: Response) => {
  try {
    const { userId, candidateId } = req.params;
    const score = await twoTowerService.getCompatibilityScore(userId, candidateId);
    res.json({ compatibilityScore: Math.round(score * 100) / 100 });
  } catch (error) {
    console.error('Two-tower compatibility error:', error);
    res.status(500).json({ error: 'Failed to compute compatibility' });
  }
});

router.get('/two-tower/graph-similar/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const depth = parseInt(req.query.depth as string) || 3;
    const similarUsers = await twoTowerService.findSimilarFromGraph(userId, depth);
    res.json({ similarUsers });
  } catch (error) {
    console.error('Graph similar error:', error);
    res.status(500).json({ error: 'Failed to find similar users from graph' });
  }
});

router.get('/rl/stats', async (req: Request, res: Response) => {
  try {
    const stats = rlService.getStats();
    res.json(stats);
  } catch (error) {
    console.error('RL stats error:', error);
    res.status(500).json({ error: 'Failed to get RL stats' });
  }
});

router.get('/rl/suggestions/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const suggestions = await rlService.getOptimizationSuggestions(userId);
    res.json(suggestions);
  } catch (error) {
    console.error('RL suggestions error:', error);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

router.post('/rl/update-policy', async (req: Request, res: Response) => {
  try {
    const { userId, match, conversation, messageReply, longChat } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }
    
    await rlService.updatePolicy(userId, {
      match: match ? 1 : 0,
      conversation: conversation ? 1 : 0,
      messageReply: messageReply ? 1 : 0,
      longChat: longChat ? 1 : 0
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('RL update error:', error);
    res.status(500).json({ error: 'Failed to update policy' });
  }
});

router.get('/cold-start/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const isColdStart = recommendationEngine.isColdStart(userId);
    const engagementScore = recommendationEngine.getUserEngagementScore(userId);
    res.json({ isColdStart, engagementScore, swipeThreshold: 50 });
  } catch (error) {
    console.error('Cold start check error:', error);
    res.status(500).json({ error: 'Failed to check cold start status' });
  }
});

router.get('/similar/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;
    
    const similarUsers = await recommendationEngine.findSimilarUsers(userId, limit);
    res.json(similarUsers);
  } catch (error) {
    console.error('Similar users error:', error);
    res.status(500).json({ error: 'Failed to find similar users' });
  }
});

router.get('/match-probability/:userId1/:userId2', async (req: Request, res: Response) => {
  try {
    const { userId1, userId2 } = req.params;
    const probability = await recommendationEngine.predictMatchProbability(userId1, userId2);
    res.json({ probability: Math.round(probability * 100) / 100 });
  } catch (error) {
    console.error('Match probability error:', error);
    res.status(500).json({ error: 'Failed to predict match probability' });
  }
});

router.get('/rank/discover/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const pool = (await import('../db/init')).getPool();
    
    const prefsResult = await pool.query(
      'SELECT min_age, max_age FROM user_preferences WHERE user_id = $1',
      [userId]
    );
    const minAge = prefsResult.rows[0]?.min_age || 18;
    const maxAge = prefsResult.rows[0]?.max_age || 50;

    const candidatesResult = await pool.query(
      `SELECT u.id FROM users u
       WHERE u.id != $1
         AND u.age >= $2 AND u.age <= $3
         AND u.id NOT IN (
           SELECT swiped_id FROM swipes WHERE swiper_id = $1
           UNION
           SELECT blocked_id FROM blocks WHERE blocker_id = $1
         )
       LIMIT 100`,
      [userId, minAge, maxAge]
    );

    const candidateIds = candidatesResult.rows.map(r => r.id);
    const rankedIds = recommendationEngine.rankUsersForDiscovery(userId, candidateIds);
    
    res.json({ rankedUserIds: rankedIds });
  } catch (error) {
    console.error('Rank discover error:', error);
    res.status(500).json({ error: 'Failed to rank users' });
  }
});

router.get('/segments/:userId', (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const segments = adTargetingEngine.getUserSegments(userId);
    const engagementScore = adTargetingEngine.getEngagementScore(userId);
    res.json({ segments, engagementScore });
  } catch (error) {
    console.error('Segments error:', error);
    res.status(500).json({ error: 'Failed to get segments' });
  }
});

router.get('/ad/select/:userId/:position', (req: Request, res: Response) => {
  try {
    const { userId, position } = req.params;
    const ad = adTargetingEngine.selectAd(userId, position);
    if (ad) {
      res.json({
        adId: ad.id,
        adName: ad.name,
        cpc: ad.cpc
      });
    } else {
      res.json({ adId: null });
    }
  } catch (error) {
    console.error('Ad select error:', error);
    res.status(500).json({ error: 'Failed to select ad' });
  }
});

router.post('/ad/click/:adId', (req: Request, res: Response) => {
  try {
    const { adId } = req.params;
    adTargetingEngine.trackClick(adId);
    res.json({ success: true });
  } catch (error) {
    console.error('Ad click error:', error);
    res.status(500).json({ error: 'Failed to track click' });
  }
});

router.get('/ad/stats', (req: Request, res: Response) => {
  try {
    const stats = adTargetingEngine.getAdStats();
    res.json(stats);
  } catch (error) {
    console.error('Ad stats error:', error);
    res.status(500).json({ error: 'Failed to get ad stats' });
  }
});

router.post('/segments/refresh', async (req: Request, res: Response) => {
  try {
    await adTargetingEngine.refreshSegments();
    res.json({ status: 'Segments refreshed' });
  } catch (error) {
    console.error('Refresh segments error:', error);
    res.status(500).json({ error: 'Failed to refresh segments' });
  }
});

export default router;
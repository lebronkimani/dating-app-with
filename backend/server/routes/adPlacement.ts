import { Router, Request, Response } from 'express';
import { adPlacementService } from '../services/ads/AdPlacementService';

const router = Router();

router.get('/placement/:placement', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  const { placement } = req.params;
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { allowed, reason } = adPlacementService.canShowAd(userId, placement);
    
    if (!allowed) {
      return res.json({ 
        adAvailable: false, 
        reason 
      });
    }

    const targeting = {
      interests: req.query.interests ? (req.query.interests as string).split(',') : undefined,
      age: req.query.age ? parseInt(req.query.age as string) : undefined,
      gender: req.query.gender as string
    };

    const ad = await adPlacementService.getAdForPlacement(userId, placement, targeting);
    
    res.json({
      adAvailable: !!ad,
      ad
    });
  } catch (error) {
    console.error('Ad placement error:', error);
    res.status(500).json({ error: 'Failed to get ad' });
  }
});

router.get('/config', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const config = adPlacementService.getAdPlacementConfig(userId);
    res.json(config);
  } catch (error) {
    console.error('Ad config error:', error);
    res.status(500).json({ error: 'Failed to get ad config' });
  }
});

router.post('/click/:adId', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  const { adId } = req.params;
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await adPlacementService.recordAdClick(userId, adId);
    res.json({ success: true });
  } catch (error) {
    console.error('Ad click error:', error);
    res.status(500).json({ error: 'Failed to record click' });
  }
});

router.post('/impression/:adId', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  const { adId } = req.params;
  const { placement } = req.body;
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await adPlacementService.recordAdImpression(userId, adId, placement || 'unknown');
    res.json({ success: true });
  } catch (error) {
    console.error('Ad impression error:', error);
    res.status(500).json({ error: 'Failed to record impression' });
  }
});

router.post('/swipe', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    adPlacementService.incrementSwipeCount(userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Ad swipe error:', error);
    res.status(500).json({ error: 'Failed to update swipe count' });
  }
});

router.post('/session/start', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await adPlacementService.startNewSession(userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Session start error:', error);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await adPlacementService.getAdStats();
    res.json(stats);
  } catch (error) {
    console.error('Ad stats error:', error);
    res.status(500).json({ error: 'Failed to get ad stats' });
  }
});

export default router;

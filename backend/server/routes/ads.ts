import { Router, Request, Response } from 'express';
import { adsService } from '../services/ads/AdsService';

const router = Router();

router.get('/select/:placement', async (req: Request, res: Response) => {
  const { placement } = req.params;
  const userId = req.headers['x-user-id'] as string;

  try {
    const ad = await adsService.selectAd(placement);
    
    if (ad) {
      res.json({
        adId: ad.id,
        adType: ad.adType,
        contentUrl: ad.contentUrl,
        rewardType: ad.rewardType
      });
    } else {
      res.json({ adId: null });
    }
  } catch (error) {
    console.error('Select ad error:', error);
    res.status(500).json({ error: 'Failed to select ad' });
  }
});

router.post('/view', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  const { adId, placement, completed = false } = req.body;

  if (!userId || !adId || !placement) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await adsService.recordAdView(userId, adId, placement, completed);
    res.json({ success: true });
  } catch (error) {
    console.error('Record ad view error:', error);
    res.status(500).json({ error: 'Failed to record ad view' });
  }
});

router.post('/reward/:adId', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  const { adId } = req.params;
  const { placement } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await adsService.grantReward(userId, adId, placement || 'unknown');
    res.json(result);
  } catch (error) {
    console.error('Grant reward error:', error);
    res.status(500).json({ error: 'Failed to grant reward' });
  }
});

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await adsService.getAdStats();
    res.json(stats);
  } catch (error) {
    console.error('Get ad stats error:', error);
    res.status(500).json({ error: 'Failed to get ad stats' });
  }
});

export default router;

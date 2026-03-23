import { Router, Request, Response } from 'express';
import { subscriptionService } from '../services/subscription/SubscriptionService';

const router = Router();

router.get('/plans', async (req: Request, res: Response) => {
  try {
    const plans = subscriptionService.getPlans();
    res.json(plans);
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ error: 'Failed to get plans' });
  }
});

router.get('/status', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const subscription = await subscriptionService.getSubscription(userId);
    const isPremium = await subscriptionService.isPremium(userId);
    
    res.json({
      isPremium,
      subscription: subscription ? {
        id: subscription.id,
        planId: subscription.planId,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        status: subscription.status,
        autoRenew: subscription.autoRenew
      } : null
    });
  } catch (error) {
    console.error('Get subscription status error:', error);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

router.post('/subscribe', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { planId, paymentMethod = 'card' } = req.body;

  if (!planId) {
    return res.status(400).json({ error: 'Plan ID is required' });
  }

  try {
    const subscription = await subscriptionService.subscribe(userId, planId, paymentMethod);
    res.json({
      success: true,
      subscription: {
        id: subscription.id,
        planId: subscription.planId,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        status: subscription.status
      }
    });
  } catch (error: any) {
    console.error('Subscribe error:', error);
    res.status(400).json({ error: error.message || 'Failed to subscribe' });
  }
});

router.post('/cancel', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await subscriptionService.cancelSubscription(userId);
    res.json({ success: true, message: 'Subscription cancelled' });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

export default router;

import { getPool } from '../../db/init';
import { eventQueue, Events } from '../eventQueue';

interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  durationDays: number;
  features: Record<string, boolean>;
}

interface UserSubscription {
  id: string;
  userId: string;
  planId: string;
  startDate: Date;
  endDate: Date;
  status: 'active' | 'expired' | 'cancelled' | 'refunded';
  autoRenew: boolean;
}

export class SubscriptionService {
  private static instance: SubscriptionService;
  private plans: Map<string, SubscriptionPlan> = new Map();

  static getInstance(): SubscriptionService {
    if (!SubscriptionService.instance) {
      SubscriptionService.instance = new SubscriptionService();
    }
    return SubscriptionService.instance;
  }

  async initialize(): Promise<void> {
    await this.loadPlans();
    eventQueue.subscribe(Events.SUBSCRIPTION_EXPIRED, this.handleSubscriptionExpired.bind(this));
    console.log('SubscriptionService initialized');
  }

  private async loadPlans(): Promise<void> {
    const pool = getPool();
    
    try {
      const result = await pool.query('SELECT * FROM subscription_plans WHERE is_active = true');
      
      for (const plan of result.rows) {
        this.plans.set(plan.id, {
          id: plan.id,
          name: plan.name,
          price: parseFloat(plan.price),
          durationDays: plan.duration_days,
          features: plan.features
        });
      }
    } catch (error) {
      console.log('Subscription plans table not ready yet');
    }
  }

  getPlans(): SubscriptionPlan[] {
    return Array.from(this.plans.values());
  }

  getPlan(planId: string): SubscriptionPlan | undefined {
    return this.plans.get(planId);
  }

  async subscribe(userId: string, planId: string, paymentMethod = 'card'): Promise<UserSubscription> {
    const pool = getPool();
    const plan = this.plans.get(planId);
    
    if (!plan) {
      throw new Error('Invalid subscription plan');
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.durationDays);

    const result = await pool.query(
      `INSERT INTO user_subscriptions (user_id, plan_id, start_date, end_date, status, auto_renew)
       VALUES ($1, $2, $3, $4, 'active', true)
       RETURNING id, user_id, plan_id, start_date, end_date, status, auto_renew`,
      [userId, planId, startDate, endDate]
    );

    await pool.query(
      `UPDATE users SET is_premium = true, premium_expires_at = $1 WHERE id = $2`,
      [endDate, userId]
    );

    await eventQueue.publish({
      type: Events.SUBSCRIPTION_STARTED,
      userId,
      data: { planId, startDate, endDate }
    });

    return {
      id: result.rows[0].id,
      userId: result.rows[0].user_id,
      planId: result.rows[0].plan_id,
      startDate: result.rows[0].start_date,
      endDate: result.rows[0].end_date,
      status: result.rows[0].status,
      autoRenew: result.rows[0].auto_renew
    };
  }

  async cancelSubscription(userId: string): Promise<void> {
    const pool = getPool();
    
    await pool.query(
      `UPDATE user_subscriptions SET status = 'cancelled', auto_renew = false 
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
  }

  async getSubscription(userId: string): Promise<UserSubscription | null> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT id, user_id, plan_id, start_date, end_date, status, auto_renew
       FROM user_subscriptions 
       WHERE user_id = $1 AND status = 'active'
       ORDER BY start_date DESC
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const sub = result.rows[0];
    
    if (new Date(sub.end_date) < new Date()) {
      await this.expireSubscription(userId);
      return null;
    }

    return {
      id: sub.id,
      userId: sub.user_id,
      planId: sub.plan_id,
      startDate: sub.start_date,
      endDate: sub.end_date,
      status: sub.status,
      autoRenew: sub.auto_renew
    };
  }

  async isPremium(userId: string): Promise<boolean> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT is_premium, premium_expires_at FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) return false;
    
    const user = result.rows[0];
    if (!user.is_premium) return false;
    if (user.premium_expires_at && new Date(user.premium_expires_at) < new Date()) {
      await this.expireSubscription(userId);
      return false;
    }
    
    return true;
  }

  private async expireSubscription(userId: string): Promise<void> {
    const pool = getPool();
    
    await pool.query(
      `UPDATE user_subscriptions SET status = 'expired' 
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );

    await pool.query(
      `UPDATE users SET is_premium = false WHERE id = $1`,
      [userId]
    );

    await eventQueue.publish({
      type: Events.SUBSCRIPTION_EXPIRED,
      userId,
      data: {}
    });
  }

  private async handleSubscriptionExpired(event: any): Promise<void> {
    console.log(`Subscription expired for user ${event.userId}`);
  }

  async checkAndExpireExpired(): Promise<number> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT DISTINCT user_id FROM user_subscriptions 
       WHERE status = 'active' AND end_date < CURRENT_TIMESTAMP`
    );

    let expired = 0;
    for (const row of result.rows) {
      await this.expireSubscription(row.user_id);
      expired++;
    }

    return expired;
  }
}

export const subscriptionService = SubscriptionService.getInstance();

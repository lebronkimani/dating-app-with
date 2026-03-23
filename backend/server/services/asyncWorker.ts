import { getPool, generateId } from '../db/init';
import { eventQueue, Events } from '../../eventQueue';
import { cacheService } from './cache';
import { rateLimitService } from './rateLimit';
import { lockService } from './lock';

export class AsyncWorkerService {
  private isRunning = false;
  private processInterval: NodeJS.Timeout | null = null;

  async initialize() {
    this.isRunning = true;
    this.processInterval = setInterval(() => this.processQueue(), 5000);
    console.log('Async Worker Service initialized');
  }

  destroy() {
    this.isRunning = false;
    if (this.processInterval) {
      clearInterval(this.processInterval);
    }
  }

  private async processQueue() {
    if (!this.isRunning) return;

    try {
      await this.processMatchEvents();
      await this.processNotificationEvents();
      await this.processRecommendationUpdates();
      await this.cleanupExpiredData();
    } catch (error) {
      console.error('Async worker error:', error);
    }
  }

  private async processMatchEvents() {
    const pendingEvents = eventQueue.getPendingEvents('match_created', 100);
    
    for (const event of pendingEvents) {
      try {
        const matchId = generateId();
        
        await eventQueue.markProcessed(event.id);
      } catch (error) {
        console.error('Match event error:', error);
      }
    }
  }

  private async processNotificationEvents() {
    const pendingEvents = eventQueue.getPendingEvents('notification', 100);
    
    for (const event of pendingEvents) {
      try {
        await eventQueue.markProcessed(event.id);
      } catch (error) {
        console.error('Notification event error:', error);
      }
    }
  }

  private async processRecommendationUpdates() {
    try {
      const pool = getPool();
      
      const result = await pool.query(
        `SELECT id FROM users WHERE last_active > NOW() - INTERVAL '1 hour' 
         ORDER BY RANDOM() LIMIT 100`
      );

      for (const user of result.rows) {
        try {
          await cacheService.invalidateDiscoveryCache(user.id);
        } catch (error) {
          console.error(`Cache invalidation error for user ${user.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Recommendation update error:', error);
    }
  }

  private async cleanupExpiredData() {
    try {
      const pool = getPool();
      
      await pool.query(
        `DELETE FROM user_locations 
         WHERE created_at < NOW() - INTERVAL '30 days'`
      );

      await pool.query(
        `DELETE FROM spam_logs 
         WHERE created_at < NOW() - INTERVAL '7 days'`
      );

      await pool.query(
        `DELETE FROM moderation_logs 
         WHERE created_at < NOW() - INTERVAL '90 days'`
      );
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }

  async processSwipeAsync(swiperId: string, swipedId: string, direction: string) {
    await eventQueue.publish({
      type: Events.SWIPE_CREATED,
      userId: swiperId,
      data: {
        swiperId,
        swipedId,
        direction,
        timestamp: Date.now()
      }
    });
  }

  async processMatchAsync(user1Id: string, user2Id: string, matchId: string) {
    await eventQueue.publish({
      type: Events.MATCH_CREATED,
      userId: user1Id,
      data: {
        matchId,
        user1Id,
        user2Id,
        timestamp: Date.now()
      }
    });
  }

  async processMessageAsync(senderId: string, matchId: string, messageId: string) {
    await eventQueue.publish({
      type: Events.MESSAGE_SENT,
      userId: senderId,
      data: {
        messageId,
        matchId,
        senderId,
        timestamp: Date.now()
      }
    });
  }
}

export const asyncWorkerService = new AsyncWorkerService();

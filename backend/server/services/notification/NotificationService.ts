import { getPool } from '../../db/init';
import { eventQueue, Events } from '../eventQueue';

interface Notification {
  id?: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  isRead?: boolean;
  createdAt?: Date;
}

export class NotificationService {
  private static instance: NotificationService;

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  async initialize(): Promise<void> {
    eventQueue.subscribe(Events.MATCH_CREATED, this.handleMatchCreated.bind(this));
    eventQueue.subscribe(Events.MESSAGE_SENT, this.handleMessageSent.bind(this));
    eventQueue.subscribe(Events.SWIPE_CREATED, this.handleSwipeCreated.bind(this));
    
    console.log('NotificationService initialized');
  }

  private async handleMatchCreated(event: any): Promise<void> {
    const { user1Id, user2Id } = event.data;
    
    await this.createNotification({
      userId: user1Id,
      type: 'new_match',
      title: 'New Match!',
      body: 'You have a new match! Start chatting now.',
      data: { matchId: event.data.matchId, otherUserId: user2Id }
    });

    await this.createNotification({
      userId: user2Id,
      type: 'new_match',
      title: 'New Match!',
      body: 'You have a new match! Start chatting now.',
      data: { matchId: event.data.matchId, otherUserId: user1Id }
    });
  }

  private async handleMessageSent(event: any): Promise<void> {
    const { matchId, senderId, receiverId, messageText } = event.data;
    
    await this.createNotification({
      userId: receiverId,
      type: 'new_message',
      title: 'New Message',
      body: messageText.substring(0, 50) + (messageText.length > 50 ? '...' : ''),
      data: { matchId, senderId }
    });
  }

  private async handleSwipeCreated(event: any): Promise<void> {
    const { likerId, likedId, isMatch } = event.data;
    
    if (isMatch) {
      await this.createNotification({
        userId: likedId,
        type: 'liked_back',
        title: 'It\'s a Match!',
        body: 'Someone liked you back!',
        data: { likerId }
      });
    }
  }

  async createNotification(notification: Omit<Notification, 'id' | 'createdAt'>): Promise<void> {
    const pool = getPool();
    
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data, is_read)
       VALUES ($1, $2, $3, $4, $5, false)`,
      [notification.userId, notification.type, notification.title, notification.body, JSON.stringify(notification.data || {})]
    );
  }

  async getNotifications(userId: string, limit = 50, offset = 0): Promise<Notification[]> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT id, user_id, type, title, body, data, is_read, created_at
       FROM notifications 
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      type: row.type,
      title: row.title,
      body: row.body,
      data: row.data,
      isRead: row.is_read,
      createdAt: row.created_at
    }));
  }

  async markAsRead(userId: string, notificationId: string): Promise<void> {
    const pool = getPool();
    
    await pool.query(
      `UPDATE notifications SET is_read = true 
       WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
  }

  async markAllAsRead(userId: string): Promise<void> {
    const pool = getPool();
    
    await pool.query(
      `UPDATE notifications SET is_read = true WHERE user_id = $1`,
      [userId]
    );
  }

  async getUnreadCount(userId: string): Promise<number> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false`,
      [userId]
    );

    return parseInt(result.rows[0].count) || 0;
  }

  async deleteNotification(userId: string, notificationId: string): Promise<void> {
    const pool = getPool();
    
    await pool.query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
  }
}

export const notificationService = NotificationService.getInstance();

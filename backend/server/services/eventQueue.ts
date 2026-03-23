type EventType = 
  | 'user.registered'
  | 'user.updated'
  | 'user.location_updated'
  | 'swipe.created'
  | 'match.created'
  | 'message.sent'
  | 'subscription.started'
  | 'subscription.expired'
  | 'ad.watched'
  | 'profile.reported'
  | 'user.blocked';

interface Event {
  id: string;
  type: EventType;
  userId: string;
  data: Record<string, any>;
  timestamp: Date;
}

type EventHandler = (event: Event) => Promise<void>;

class EventQueue {
  private handlers: Map<EventType, EventHandler[]> = new Map();
  private eventHistory: Event[] = [];
  private maxHistorySize = 1000;

  subscribe(eventType: EventType, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
  }

  unsubscribe(eventType: EventType, handler: EventHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  async publish(event: Omit<Event, 'id' | 'timestamp'>): Promise<void> {
    const fullEvent: Event = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date()
    };

    this.eventHistory.push(fullEvent);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    const handlers = this.handlers.get(fullEvent.type) || [];
    
    await Promise.all(
      handlers.map(handler => 
        handler(fullEvent).catch(err => 
          console.error(`Error in event handler for ${fullEvent.type}:`, err)
        )
      )
    );
  }

  getHistory(userId?: string, limit = 100): Event[] {
    let events = this.eventHistory;
    if (userId) {
      events = events.filter(e => e.userId === userId);
    }
    return events.slice(-limit);
  }

  clearHistory(): void {
    this.eventHistory = [];
  }
}

export const eventQueue = new EventQueue();

export const Events = {
  USER_REGISTERED: 'user.registered' as EventType,
  USER_UPDATED: 'user.updated' as EventType,
  USER_LOCATION_UPDATED: 'user.location_updated' as EventType,
  SWIPE_CREATED: 'swipe.created' as EventType,
  MATCH_CREATED: 'match.created' as EventType,
  MESSAGE_SENT: 'message.sent' as EventType,
  SUBSCRIPTION_STARTED: 'subscription.started' as EventType,
  SUBSCRIPTION_EXPIRED: 'subscription.expired' as EventType,
  AD_WATCHED: 'ad.watched' as EventType,
  PROFILE_REPORTED: 'profile.reported' as EventType,
  USER_BLOCKED: 'user.blocked' as EventType
};

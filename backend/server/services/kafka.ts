import { getPool } from '../db/init';

interface KafkaEvent {
  id: string;
  topic: string;
  partition: number;
  key?: string;
  value: Record<string, any>;
  timestamp: number;
  headers?: Record<string, string>;
}

interface Consumer {
  id: string;
  topic: string;
  groupId: string;
  offset: number;
  handler: (event: KafkaEvent) => Promise<void>;
}

interface Topic {
  name: string;
  partitions: number;
  subscribers: Consumer[];
  events: KafkaEvent[];
  retentionMs: number;
}

export class KafkaService {
  private static instance: KafkaService;
  private topics: Map<string, Topic> = new Map();
  private consumers: Map<string, Consumer> = new Map();
  private isRunning = false;

  static getInstance(): KafkaService {
    if (!KafkaService.instance) {
      KafkaService.instance = new KafkaService();
    }
    return KafkaService.instance;
  }

  async initialize(): Promise<void> {
    console.log('Initializing Kafka Service...');
    
    this.createTopic('user-events', 3);
    this.createTopic('swipe-events', 5);
    this.createTopic('match-events', 3);
    this.createTopic('message-events', 5);
    this.createTopic('notification-events', 3);
    this.createTopic('ad-events', 3);
    this.createTopic('ml-training-events', 3);
    this.createTopic('analytics-events', 3);

    await this.persistEvents();
    
    this.isRunning = true;
    console.log('Kafka Service initialized with topics:', [...this.topics.keys()].join(', '));
  }

  private createTopic(name: string, partitions: number): void {
    this.topics.set(name, {
      name,
      partitions,
      subscribers: [],
      events: [],
      retentionMs: 7 * 24 * 60 * 60 * 1000
    });
  }

  async produce(topic: string, value: Record<string, any>, key?: string): Promise<string> {
    const kafkaTopic = this.topics.get(topic);
    if (!kafkaTopic) {
      throw new Error(`Topic ${topic} does not exist`);
    }

    const partition = key 
      ? Math.abs(this.hashKey(key)) % kafkaTopic.partitions
      : Math.floor(Math.random() * kafkaTopic.partitions);

    const event: KafkaEvent = {
      id: crypto.randomUUID(),
      topic,
      partition,
      key,
      value,
      timestamp: Date.now()
    };

    kafkaTopic.events.push(event);

    for (const subscriber of kafkaTopic.subscribers) {
      if (subscriber.topic === topic) {
        try {
          await subscriber.handler(event);
        } catch (error) {
          console.error(`Error in consumer ${subscriber.id}:`, error);
        }
      }
    }

    return event.id;
  }

  async consume(topic: string, groupId: string, handler: (event: KafkaEvent) => Promise<void>): Promise<string> {
    const kafkaTopic = this.topics.get(topic);
    if (!kafkaTopic) {
      throw new Error(`Topic ${topic} does not exist`);
    }

    const consumerId = crypto.randomUUID();
    const consumer: Consumer = {
      id: consumerId,
      topic,
      groupId,
      offset: 0,
      handler
    };

    kafkaTopic.subscribers.push(consumer);
    this.consumers.set(consumerId, consumer);

    const historicalEvents = kafkaTopic.events.slice(consumer.offset);
    for (const event of historicalEvents) {
      try {
        await handler(event);
        consumer.offset++;
      } catch (error) {
        console.error(`Error processing event ${event.id}:`, error);
      }
    }

    return consumerId;
  }

  async unsubscribe(consumerId: string): Promise<void> {
    const consumer = this.consumers.get(consumerId);
    if (!consumer) return;

    const kafkaTopic = this.topics.get(consumer.topic);
    if (kafkaTopic) {
      kafkaTopic.subscribers = kafkaTopic.subscribers.filter(c => c.id !== consumerId);
    }
    this.consumers.delete(consumerId);
  }

  private hashKey(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash;
  }

  private async persistEvents(): Promise<void> {
    const pool = getPool();
    
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS kafka_events (
          id UUID PRIMARY KEY,
          topic VARCHAR(100) NOT NULL,
          partition INTEGER NOT NULL,
          key VARCHAR(255),
          value JSONB NOT NULL,
          timestamp BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_kafka_events_topic ON kafka_events(topic)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_kafka_events_timestamp ON kafka_events(timestamp DESC)
      `);
    } catch (error) {
      console.log('Kafka events table will be created when database is ready');
    }
  }

  async getTopicStats(topicName: string): Promise<{
    topic: string;
    partitions: number;
    eventCount: number;
    subscriberCount: number;
  }> {
    const topic = this.topics.get(topicName);
    if (!topic) {
      return { topic: topicName, partitions: 0, eventCount: 0, subscriberCount: 0 };
    }

    return {
      topic: topicName,
      partitions: topic.partitions,
      eventCount: topic.events.length,
      subscriberCount: topic.subscribers.length
    };
  }

  getTopics(): string[] {
    return [...this.topics.keys()];
  }

  getConsumerGroups(): Map<string, Set<string>> {
    const groups = new Map<string, Set<string>>();
    
    for (const consumer of this.consumers.values()) {
      if (!groups.has(consumer.groupId)) {
        groups.set(consumer.groupId, new Set());
      }
      groups.get(consumer.groupId)!.add(consumer.topic);
    }
    
    return groups;
  }

  stop(): void {
    this.isRunning = false;
  }

  isHealthy(): boolean {
    return this.isRunning;
  }
}

export const kafkaService = KafkaService.getInstance();

export const Topics = {
  USER_EVENTS: 'user-events',
  SWIPE_EVENTS: 'swipe-events',
  MATCH_EVENTS: 'match-events',
  MESSAGE_EVENTS: 'message-events',
  NOTIFICATION_EVENTS: 'notification-events',
  AD_EVENTS: 'ad-events',
  ML_TRAINING_EVENTS: 'ml-training-events',
  ANALYTICS_EVENTS: 'analytics-events'
};

export const produceEvent = async (topic: string, value: Record<string, any>, key?: string): Promise<string> => {
  return kafkaService.produce(topic, value, key);
};

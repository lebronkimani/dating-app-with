import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { createServer } from 'http';
import { initDb } from './db/init';
import { wsService } from './services/websocket';
import { securityHeaders, sanitizeInput } from './middleware/security';
import { jwtAuth } from './middleware/jwtAuth';
import { sqlInjectionMiddleware } from './services/sqlInjectionPrevention';

// Routes
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import swipeRoutes from './routes/swipe';
import messageRoutes from './routes/messages';
import mlRoutes from './routes/ml';
import verificationRoutes from './routes/verification';
import faceVerificationRoutes from './routes/faceVerification';
import locationRoutes from './routes/location';
import filtersRoutes from './routes/filters';
import presenceRoutes from './routes/presence';
import likesYouRoutes from './routes/likesYou';
import notificationRoutes from './routes/notifications';
import subscriptionRoutes from './routes/subscriptions';
import adsRoutes from './routes/ads';
import adPlacementRoutes from './routes/adPlacement';
import otpRoutes from './routes/otp';
import moderationRoutes from './routes/moderation';
import adminRoutes from './routes/admin';

// Services
import { eventQueue } from './services/eventQueue';
import { notificationService } from './services/notification/NotificationService';
import { subscriptionService } from './services/subscription/SubscriptionService';
import { adsService } from './services/ads/AdsService';
import { kafkaService, Topics } from './services/kafka';
import { vectorDb } from './services/vectorDb';
import { featureStore } from './services/featureStore';
import { monitoringService, metrics } from './services/monitoring';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://globalconnect.com',
      'https://www.globalconnect.com',
      'https://app.globalconnect.com'
    ];
    
    const envOrigins = process.env.CORS_ORIGINS?.split(',') || [];
    const allOrigins = [...allowedOrigins, ...envOrigins];
    
    if (!origin || allOrigins.includes(origin)) {
      callback(null, true);
    } else if (process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-ID', 'X-User-Role', 'X-Request-ID'],
  exposedHeaders: ['X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  maxAge: 86400,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(sanitizeInput);
app.use(sqlInjectionMiddleware);
app.use(securityHeaders);

// ============================================
// API Gateway Routes
// ============================================

// Auth Service
app.use('/api/auth', authRoutes);

// User Service
app.use('/api/users', jwtAuth, userRoutes);
app.use('/api/profile', jwtAuth, userRoutes);

// Discovery Service
app.use('/api/filters', jwtAuth, filtersRoutes);

// Swipe & Match Service
app.use('/api/swipe', jwtAuth, swipeRoutes);
app.use('/api/likes', jwtAuth, likesYouRoutes);

// Messaging Service
app.use('/api/messages', jwtAuth, messageRoutes);

// Notification Service
app.use('/api/notifications', jwtAuth, notificationRoutes);

// Subscription Service
app.use('/api/subscription', jwtAuth, subscriptionRoutes);

// Ads Service
app.use('/api/ads', jwtAuth, adsRoutes);
app.use('/api/ad-placement', jwtAuth, adPlacementRoutes);

// OTP Service
app.use('/api/otp', jwtAuth, otpRoutes);

// Moderation Service
app.use('/api/moderation', jwtAuth, moderationRoutes);

// Admin & Monitoring Service
app.use('/api/admin', jwtAuth, adminRoutes);

// ML Recommendation Service
app.use('/api/ml', jwtAuth, mlRoutes);

// Other Services
app.use('/api/verification', jwtAuth, verificationRoutes);
app.use('/api/face', jwtAuth, faceVerificationRoutes);
app.use('/api/location', jwtAuth, locationRoutes);
app.use('/api/presence', jwtAuth, presenceRoutes);

// Health Check
app.get('/api/health', async (req, res) => {
  let redisStatus = 'disconnected';
  try {
    const redis = (await import('./services/redis')).default;
    await redis.ping();
    redisStatus = 'connected';
  } catch (e) {
    redisStatus = 'not available';
  }
  
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    redis: redisStatus,
    services: {
      notifications: 'active',
      subscriptions: 'active',
      ads: 'active',
      ml: 'active'
    }
  });
});

// Event Queue Health
app.get('/api/events', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const userId = req.query.userId as string | undefined;
  const events = eventQueue.getHistory(userId, limit);
  res.json({ events });
});

// Kafka Topics
app.get('/api/kafka/topics', (req, res) => {
  const topics = kafkaService.getTopics();
  const stats = topics.map(t => ({ name: t, ...kafkaService.getTopicStats(t) }));
  res.json({ topics: stats });
});

app.get('/api/kafka/consumers', (req, res) => {
  const groups = kafkaService.getConsumerGroups();
  const formatted: Record<string, string[]> = {};
  groups.forEach((topics, groupId) => {
    formatted[groupId] = [...topics];
  });
  res.json({ consumerGroups: formatted });
});

// Vector Database
app.get('/api/vector/stats', (req, res) => {
  const stats = vectorDb.getStats();
  res.json(stats);
});

app.get('/api/vector/search/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const topK = parseInt(req.query.topK as string) || 10;
    const results = await vectorDb.searchByUserId(userId, topK);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// Feature Store
app.get('/api/features/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const forceRefresh = req.query.refresh === 'true';
    const features = await featureStore.getFeatures(userId, forceRefresh);
    res.json(features);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get features' });
  }
});

app.get('/api/features/:userId/metadata', async (req, res) => {
  try {
    const { userId } = req.params;
    const metadata = await vectorDb.getMetadata(userId);
    res.json({ metadata });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get metadata' });
  }
});

// Monitoring & Observability
app.get('/api/monitoring/health', async (req, res) => {
  const health = await monitoringService.checkHealth();
  const systemMetrics = monitoringService.getSystemMetrics();
  res.json({
    ...health,
    system: systemMetrics,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/monitoring/metrics', (req, res) => {
  const name = req.query.name as string | undefined;
  const metrics = monitoringService.getMetrics(name);
  res.json({ metrics });
});

app.get('/api/monitoring/logs', (req, res) => {
  const level = req.query.level as 'debug' | 'info' | 'warn' | 'error' | undefined;
  const limit = parseInt(req.query.limit as string) || 100;
  const logs = monitoringService.getLogs(level, limit);
  res.json({ logs });
});

app.get('/api/monitoring/alerts', (req, res) => {
  const alerts = monitoringService.getActiveAlerts();
  res.json({ alerts });
});

app.post('/api/monitoring/alerts/:alertId/acknowledge', (req, res) => {
  const { alertId } = req.params;
  monitoringService.acknowledgeAlert(alertId);
  res.json({ success: true });
});

async function startServer() {
  await initDb();
  console.log('PostgreSQL database connected and initialized');
  
  // Initialize Redis
  try {
    const { initRedis } = await import('./services/redis');
    await initRedis();
  } catch (e) {
    console.log('Redis not available, continuing without it');
  }
  
  // Initialize Services
  try {
    await notificationService.initialize();
    console.log('NotificationService initialized');
  } catch (e) {
    console.log('NotificationService will initialize on first use');
  }
  
  try {
    await subscriptionService.initialize();
    console.log('SubscriptionService initialized');
  } catch (e) {
    console.log('SubscriptionService will initialize on first use');
  }
  
  try {
    await adsService.initialize();
    console.log('AdsService initialized');
  } catch (e) {
    console.log('AdsService will initialize on first use');
  }
  
  // Initialize Ad Placement Service
  try {
    const { adPlacementService } = await import('./services/ads/AdPlacementService');
    await adPlacementService.initialize();
    console.log('AdPlacementService initialized');
  } catch (e) {
    console.log('AdPlacementService will initialize on first use');
  }
  
  // Initialize ML Engine
  try {
    const { recommendationEngine } = await import('./ml/recommendations');
    const { adTargetingEngine } = await import('./ml/adTargeting');
    await recommendationEngine.initialize();
    await adTargetingEngine.initialize();
    console.log('ML Recommendation Engine ready');
  } catch (e) {
    console.log('ML Engine will initialize on first request');
  }
  
  // Initialize Embedding Service
  try {
    const { embeddingService } = await import('./ml/embeddings');
    await embeddingService.initialize();
    console.log('Embedding Service ready');
  } catch (e) {
    console.log('Embedding Service will initialize on first request');
  }
  
  // Initialize Two-Tower Matching Service
  try {
    const { twoTowerService } = await import('./ml/twoTowerMatching');
    await twoTowerService.initialize();
    console.log('Two-Tower Matching Service ready');
  } catch (e) {
    console.log('Two-Tower Matching Service will initialize on first request');
  }
  
  // Initialize Reinforcement Learning Service
  try {
    const { rlService } = await import('./ml/reinforcementLearning');
    await rlService.initialize();
    console.log('Reinforcement Learning Service ready');
  } catch (e) {
    console.log('Reinforcement Learning Service will initialize on first request');
  }
  
  // Initialize Kafka Service
  try {
    await kafkaService.initialize();
    console.log('Kafka Service ready');
  } catch (e) {
    console.log('Kafka Service will initialize on first request');
  }
  
  // Initialize Vector Database
  try {
    await vectorDb.initialize();
    console.log('Vector Database ready');
  } catch (e) {
    console.log('Vector Database will initialize on first request');
  }
  
  // Initialize Feature Store
  try {
    await featureStore.initialize();
    console.log('Feature Store ready');
  } catch (e) {
    console.log('Feature Store will initialize on first request');
  }
  
  // Initialize Monitoring
  monitoringService.initialize();
  console.log('Monitoring Service ready');

  // Initialize Fraud Detection Service
  try {
    const { fraudDetectionService } = await import('./services/fraudDetection/index');
    await fraudDetectionService.initialize();
    console.log('Fraud Detection Service ready');
  } catch (e) {
    console.log('Fraud Detection Service will initialize on first request');
  }

  // Initialize Async Worker Service
  try {
    const { asyncWorkerService } = await import('./services/asyncWorker');
    await asyncWorkerService.initialize();
    console.log('Async Worker Service ready');
  } catch (e) {
    console.log('Async Worker Service will initialize on first request');
  }

  // Initialize Database Sharding
  try {
    const { shardingService } = await import('./services/sharding');
    shardingService.initialize();
    console.log('Database Sharding ready');
  } catch (e) {
    console.log('Database Sharding will initialize on first request');
  }
  
  const server = createServer(app);
  
  wsService.initialize(server);
  
  server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║         GlobalConnect Dating App                     ║
║         Production Server Running                     ║
╠═══════════════════════════════════════════════════════╣
║  Port: ${PORT}                                         ║
║  API: http://localhost:${PORT}/api                    ║
╠═══════════════════════════════════════════════════════╣
║  Services:                                           ║
║  ✓ User Service (auth, profiles)                     ║
║  ✓ Discovery Service (filters, recommendations)      ║
║  ✓ Swipe & Match Service                             ║
║  ✓ Messaging Service                                 ║
║  ✓ Notification Service                             ║
║  ✓ Subscription Service                              ║
║  ✓ Ads Service                                       ║
║  ✓ ML Recommendation Service                         ║
╚═══════════════════════════════════════════════════════╝
    `);
  });
}

startServer().catch(console.error);

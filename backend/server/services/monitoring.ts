interface Metric {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
  type: 'counter' | 'gauge' | 'histogram';
}

interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, any>;
  timestamp: number;
  service: string;
}

interface HealthCheck {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency?: number;
  message?: string;
}

interface Alert {
  id: string;
  name: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  triggeredAt: Date;
  acknowledged: boolean;
}

export class MonitoringService {
  private static instance: MonitoringService;
  private metrics: Map<string, Metric[]> = new Map();
  private logs: LogEntry[] = [];
  private healthChecks: Map<string, HealthCheck> = new Map();
  private alerts: Alert[] = [];
  private maxLogs = 1000;
  private maxMetricsPerName = 100;

  static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  initialize(): void {
    console.log('Initializing Monitoring Service...');
    
    setInterval(() => this.cleanupOldMetrics(), 60000);
    
    console.log('Monitoring Service initialized');
  }

  recordMetric(name: string, value: number, labels: Record<string, string> = {}, type: 'counter' | 'gauge' | 'histogram' = 'gauge'): void {
    const metric: Metric = {
      name,
      value,
      labels,
      timestamp: Date.now(),
      type
    };

    const key = `${name}:${JSON.stringify(labels)}`;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    const metricsArray = this.metrics.get(key)!;
    metricsArray.push(metric);

    if (metricsArray.length > this.maxMetricsPerName) {
      metricsArray.shift();
    }
  }

  incrementCounter(name: string, labels: Record<string, string> = {}): void {
    this.recordMetric(name, 1, labels, 'counter');
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    this.recordMetric(name, value, labels, 'gauge');
  }

  recordHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    this.recordMetric(name, value, labels, 'histogram');
  }

  log(level: LogEntry['level'], message: string, metadata?: Record<string, any>, service = 'app'): void {
    const entry: LogEntry = {
      level,
      message,
      metadata,
      timestamp: Date.now(),
      service
    };

    this.logs.push(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    if (level === 'error') {
      console.error(`[${service.toUpperCase()}]`, message, metadata);
    } else if (level === 'warn') {
      console.warn(`[${service.toUpperCase()}]`, message, metadata);
    } else {
      console.log(`[${service.toUpperCase()}]`, message, metadata);
    }
  }

  info(message: string, metadata?: Record<string, any>): void {
    this.log('info', message, metadata);
  }

  warn(message: string, metadata?: Record<string, any>): void {
    this.log('warn', message, metadata);
  }

  error(message: string, metadata?: Record<string, any>): void {
    this.log('error', message, metadata);
  }

  debug(message: string, metadata?: Record<string, any>): void {
    this.log('debug', message, metadata);
  }

  registerHealthCheck(service: string, status: HealthCheck['status'], latency?: number, message?: string): void {
    this.healthChecks.set(service, {
      service,
      status,
      latency,
      message
    });
  }

  async checkHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    services: HealthCheck[];
  }> {
    const services = [...this.healthChecks.values()];
    const healthyCount = services.filter(s => s.status === 'healthy').length;
    const totalCount = services.length;

    let overallStatus: HealthCheck['status'] = 'healthy';
    if (healthyCount < totalCount * 0.5) {
      overallStatus = 'unhealthy';
    } else if (healthyCount < totalCount) {
      overallStatus = 'degraded';
    }

    return { status: overallStatus, services };
  }

  triggerAlert(name: string, severity: Alert['severity'], message: string): void {
    const alert: Alert = {
      id: crypto.randomUUID(),
      name,
      severity,
      message,
      triggeredAt: new Date(),
      acknowledged: false
    };

    this.alerts.push(alert);

    this.error(`ALERT [${severity.toUpperCase()}]: ${name} - ${message}`);
  }

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
    }
  }

  getActiveAlerts(): Alert[] {
    return this.alerts.filter(a => !a.acknowledged);
  }

  getMetrics(name?: string): Metric[] {
    if (!name) {
      const allMetrics: Metric[] = [];
      for (const metrics of this.metrics.values()) {
        allMetrics.push(...metrics);
      }
      return allMetrics;
    }

    const results: Metric[] = [];
    for (const [key, metrics] of this.metrics) {
      if (key.startsWith(name)) {
        results.push(...metrics);
      }
    }
    return results;
  }

  getLogs(level?: LogEntry['level'], limit = 100): LogEntry[] {
    let filtered = this.logs;
    
    if (level) {
      filtered = filtered.filter(l => l.level === level);
    }

    return filtered.slice(-limit);
  }

  private cleanupOldMetrics(): void {
    const cutoff = Date.now() - 3600000;
    
    for (const [key, metrics] of this.metrics.entries()) {
      const filtered = metrics.filter(m => m.timestamp > cutoff);
      if (filtered.length === 0) {
        this.metrics.delete(key);
      } else {
        this.metrics.set(key, filtered);
      }
    }
  }

  getSystemMetrics(): {
    memoryUsage: NodeJS.MemoryUsage;
    uptime: number;
    cpuUsage: NodeJS.CpuUsage;
    metricsCount: number;
    logsCount: number;
    activeAlerts: number;
  } {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memoryUsage: memUsage,
      uptime: process.uptime(),
      cpuUsage,
      metricsCount: [...this.metrics.values()].reduce((sum, arr) => sum + arr.length, 0),
      logsCount: this.logs.length,
      activeAlerts: this.getActiveAlerts().length
    };
  }

  createTimer(name: string, labels: Record<string, string> = {}): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.recordHistogram(`${name}.duration_ms`, duration, labels);
    };
  }
}

export const monitoringService = MonitoringService.getInstance();

export const metrics = {
  apiRequest: (method: string, route: string, status: number) => {
    monitoringService.incrementCounter('api_requests_total', { method, route: route.split('/')[2] || 'unknown', status: status.toString() });
  },
  swipeAction: (direction: string) => {
    monitoringService.incrementCounter('swipes_total', { direction });
  },
  matchCreated: () => {
    monitoringService.incrementCounter('matches_total');
  },
  messageSent: () => {
    monitoringService.incrementCounter('messages_total');
  },
  latency: (operation: string, durationMs: number) => {
    monitoringService.recordHistogram(`${operation}_duration_ms`, durationMs);
  }
};

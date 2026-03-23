import { getPool, generateId } from '../db/init';

interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'security';
  event: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  action?: string;
  result: 'success' | 'failure';
  details?: any;
}

export class SecurityLoggingService {
  async log(entry: LogEntry): Promise<void> {
    const pool = getPool();
    
    try {
      await pool.query(
        `INSERT INTO security_logs (event_type, user_id, ip_address, user_agent, resource, action, result, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          entry.event,
          entry.userId,
          entry.ipAddress,
          entry.userAgent,
          entry.resource,
          entry.action,
          entry.result,
          entry.details ? JSON.stringify(entry.details) : null
        ]
      );
    } catch (error) {
      console.error('Failed to log security event:', error);
    }

    if (entry.level === 'security' || entry.level === 'error') {
      console.log(`[SECURITY] ${entry.event}:`, entry);
    }
  }

  async logLogin(userId: string, ipAddress: string, userAgent: string, success: boolean): Promise<void> {
    await this.log({
      timestamp: new Date(),
      level: 'security',
      event: 'login',
      userId,
      ipAddress,
      userAgent,
      result: success ? 'success' : 'failure'
    });
  }

  async logLogout(userId: string, ipAddress: string): Promise<void> {
    await this.log({
      timestamp: new Date(),
      level: 'info',
      event: 'logout',
      userId,
      ipAddress,
      result: 'success'
    });
  }

  async logFailedLogin(email: string, ipAddress: string, reason: string): Promise<void> {
    await this.log({
      timestamp: new Date(),
      level: 'security',
      event: 'login_failed',
      ipAddress,
      result: 'failure',
      details: { email: email.substring(0, 5) + '***', reason }
    });
  }

  async logPasswordChange(userId: string, ipAddress: string): Promise<void> {
    await this.log({
      timestamp: new Date(),
      level: 'security',
      event: 'password_change',
      userId,
      ipAddress,
      result: 'success'
    });
  }

  async logTokenRefresh(userId: string, ipAddress: string, success: boolean): Promise<void> {
    await this.log({
      timestamp: new Date(),
      level: 'info',
      event: 'token_refresh',
      userId,
      ipAddress,
      result: success ? 'success' : 'failure'
    });
  }

  async logPermissionDenied(userId: string, resource: string, action: string, ipAddress: string): Promise<void> {
    await this.log({
      timestamp: new Date(),
      level: 'security',
      event: 'permission_denied',
      userId,
      ipAddress,
      resource,
      action,
      result: 'failure'
    });
  }

  async logSensitiveAction(userId: string, action: string, ipAddress: string, details?: any): Promise<void> {
    await this.log({
      timestamp: new Date(),
      level: 'security',
      event: action,
      userId,
      ipAddress,
      action,
      result: 'success',
      details
    });
  }

  async getSecurityLogs(userId?: string, event?: string, limit: number = 100): Promise<any[]> {
    const pool = getPool();
    
    let query = 'SELECT * FROM security_logs';
    const params: any[] = [];
    const conditions: string[] = [];

    if (userId) {
      conditions.push(`user_id = $${params.length + 1}`);
      params.push(userId);
    }

    if (event) {
      conditions.push(`event_type = $${params.length + 1}`);
      params.push(event);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return result.rows;
  }

  async getFailedLogins(ipAddress: string, hours: number = 24): Promise<number> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM security_logs 
       WHERE ip_address = $1 AND event_type = 'login_failed' 
       AND created_at > NOW() - INTERVAL '${hours} hours'`,
      [ipAddress]
    );

    return parseInt(result.rows[0].count);
  }

  async isIPBlocked(ipAddress: string): Promise<boolean> {
    const failedLogins = await this.getFailedLogins(ipAddress, 1);
    return failedLogins >= 10;
  }
}

export const securityLoggingService = new SecurityLoggingService();

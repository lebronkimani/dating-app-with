import { Request, Response, NextFunction } from 'express';

interface SQLInjectionPattern {
  pattern: RegExp;
  severity: 'low' | 'medium' | 'high';
  description: string;
}

const SQL_INJECTION_PATTERNS: SQLInjectionPattern[] = [
  { pattern: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b)/i, severity: 'high', description: 'SQL keyword detected' },
  { pattern: /(\bOR\b.*=.*\bOR\b)/i, severity: 'high', description: 'OR condition injection' },
  { pattern: /(;|\/\*|\*\/|@@|char\(|nchar\(|varchar\(|nvarchar\(|alter |begin |cast\(|create |cursor |declare |delete |drop |end |exec |execute |fetch |insert |kill |select |sys\.|sysobjects|syscolumns|table |update)/i, severity: 'high', description: 'Common SQL injection patterns' },
  { pattern: /(\bAND\b.*=.*\bAND\b)/i, severity: 'medium', description: 'AND condition injection' },
  { pattern: /(\bUNION\b.*\bSELECT\b)/i, severity: 'high', description: 'UNION-based injection' },
  { pattern: /(--|#|\/\*)/, severity: 'medium', description: 'SQL comment detected' },
  { pattern: /(0x[0-9a-fA-F]+|CHAR\(|0x)/i, severity: 'medium', description: 'Hex encoding attempt' },
  { pattern: /(\bEXEC\b|\bEXECUTE\b)/i, severity: 'high', description: 'Stored procedure execution attempt' },
  { pattern: /(\bWAITFOR\b|\bDELAY\b)/i, severity: 'high', description: 'Time-based injection attempt' },
  { pattern: /(\bINTO\s+(OUTFILE|DUMPFILE)\b)/i, severity: 'high', description: 'File write attempt' },
  { pattern: /(\bLOAD_FILE\b|\bLOAD_DATA\b)/i, severity: 'high', description: 'File read attempt' },
];

const DANGEROUS_PARAMETRIC_PATTERNS = [
  /\$[\d]+\s*=\s*['"]/,
  /\$[\d]+\s*\|\s*/,
  /\$[\d]+\s*\&\s*/,
];

export class SQLInjectionDetector {
  private logEnabled: boolean = true;
  private blockOnDetection: boolean = true;
  private severityThreshold: 'low' | 'medium' | 'high' = 'medium';

  constructor() {
    this.logEnabled = process.env.SQL_INJECTION_LOG !== 'false';
    this.blockOnDetection = process.env.SQL_INJECTION_BLOCK !== 'false';
    this.severityThreshold = (process.env.SQL_INJECTION_THRESHOLD as any) || 'medium';
  }

  private severityLevel(severity: 'low' | 'medium' | 'high'): number {
    switch (severity) {
      case 'low': return 1;
      case 'medium': return 2;
      case 'high': return 3;
      default: return 2;
    }
  }

  private shouldBlock(severity: 'low' | 'medium' | 'high'): boolean {
    return this.severityLevel(severity) >= this.severityLevel(this.severityThreshold);
  }

  detect(value: string): { detected: boolean; severity: 'low' | 'medium' | 'high'; description: string } | null {
    if (!value || typeof value !== 'string') {
      return null;
    }

    for (const { pattern, severity, description } of SQL_INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        return { detected: true, severity, description };
      }
    }

    for (const pattern of DANGEROUS_PARAMETRIC_PATTERNS) {
      if (pattern.test(value)) {
        return { detected: true, severity: 'high', description: 'Dangerous parametric pattern' };
      }
    }

    return null;
  }

  sanitizeString(value: string): string {
    if (!value || typeof value !== 'string') {
      return '';
    }

    let sanitized = value
      .replace(/['"]/g, '')
      .replace(/[;]/g, '')
      .replace(/(\/\*|\*\/)/g, '')
      .replace(/(--|#)/g, '')
      .replace(/\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b/gi, '')
      .trim();

    return sanitized;
  }

  validateOrderByField(field: string, allowedFields: string[]): string | null {
    if (!field || typeof field !== 'string') {
      return null;
    }

    const cleanField = field.replace(/[^a-zA-Z0-9_]/g, '');
    
    if (allowedFields.includes(cleanField)) {
      return cleanField;
    }
    
    return null;
  }

  validateLimit(value: any): number {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1) {
      return 50;
    }
    if (num > 1000) {
      return 1000;
    }
    return num;
  }

  validateOffset(value: any): number {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) {
      return 0;
    }
    return num;
  }

  buildWhereClause(conditions: Record<string, any>, allowedOperators: string[] = ['=', '>', '<', '>=', '<=', '!=', 'LIKE', 'ILIKE']): { clause: string; params: any[] } {
    const params: any[] = [];
    const clauses: string[] = [];
    let paramIndex = 1;

    for (const [field, value] of Object.entries(conditions)) {
      if (!field || typeof field !== 'string') continue;
      
      const cleanField = field.replace(/[^a-zA-Z0-9_]/g, '');
      if (!cleanField) continue;

      const sanitizedValue = typeof value === 'string' ? this.sanitizeString(value) : value;
      
      if (typeof value === 'object' && value !== null) {
        const operator = (value.operator || '=').toUpperCase();
        if (!allowedOperators.includes(operator)) continue;
        
        clauses.push(`${cleanField} ${operator} $${paramIndex}`);
        params.push(value.value);
        paramIndex++;
      } else {
        clauses.push(`${cleanField} = $${paramIndex}`);
        params.push(sanitizedValue);
        paramIndex++;
      }
    }

    return {
      clause: clauses.length > 0 ? clauses.join(' AND ') : '1=1',
      params
    };
  }
}

export const sqlInjectionDetector = new SQLInjectionDetector();

export const sqlInjectionMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const checkValue = (value: any, path: string): boolean => {
    if (typeof value === 'string') {
      const result = sqlInjectionDetector.detect(value);
      if (result && sqlInjectionDetector.shouldBlock(result.severity)) {
        console.warn(`[SQL INJECTION DETECTED] ${result.description} at ${path}: ${value.substring(0, 50)}...`);
        return true;
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, val] of Object.entries(value)) {
        if (checkValue(val, `${path}.${key}`)) {
          return true;
        }
      }
    }
    return false;
  };

  if (checkValue(req.body, 'body')) {
    if (sqlInjectionDetector['blockOnDetection']) {
      res.status(400).json({ error: 'Invalid input detected' });
      return;
    }
  }

  if (checkValue(req.query, 'query')) {
    if (sqlInjectionDetector['blockOnDetection']) {
      res.status(400).json({ error: 'Invalid query parameters' });
      return;
    }
  }

  if (checkValue(req.params, 'params')) {
    if (sqlInjectionDetector['blockOnDetection']) {
      res.status(400).json({ error: 'Invalid path parameters' });
      return;
    }
  }

  next();
};

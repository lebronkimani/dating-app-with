import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth';
import { rbacService } from '../services/rbac';
import { validationService } from '../services/validation';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
  };
}

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    const payload = await authService.verifyAccessToken(token);

    if (!payload) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

export const requireRole = (...roles: string[]) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
};

export const requirePermission = (resource: string, action: string) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const hasPermission = await rbacService.checkPermission(req.user.userId, resource, action);
    
    if (!hasPermission) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
};

export const validateInput = (schema: {
  required?: string[];
  email?: string[];
  phone?: string[];
  uuid?: string[];
  coordinates?: { lat: string; lon: string };
}) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const data = req.body;

    if (schema.required) {
      const validation = validationService.validateRequiredFields(data, schema.required);
      if (!validation.valid) {
        res.status(400).json({ error: `Missing required field: ${validation.missing}` });
        return;
      }
    }

    if (schema.email) {
      for (const field of schema.email) {
        if (data[field]) {
          const validation = validationService.validateEmail(data[field]);
          if (!validation.valid) {
            res.status(400).json({ error: validation.error });
            return;
          }
        }
      }
    }

    if (schema.phone) {
      for (const field of schema.phone) {
        if (data[field]) {
          const validation = validationService.validatePhone(data[field]);
          if (!validation.valid) {
            res.status(400).json({ error: validation.error });
            return;
          }
        }
      }
    }

    if (schema.uuid) {
      for (const field of schema.uuid) {
        if (data[field]) {
          const validation = validationService.validateUUID(data[field]);
          if (!validation.valid) {
            res.status(400).json({ error: validation.error });
            return;
          }
        }
      }
    }

    if (schema.coordinates) {
      const { lat, lon } = schema.coordinates;
      if (data[lat] !== undefined && data[lon] !== undefined) {
        const validation = validationService.validateCoordinates(data[lat], data[lon]);
        if (!validation.valid) {
          res.status(400).json({ error: validation.error });
          return;
        }
      }
    }

    next();
  };
};

export const sanitizeInput = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const sanitizeObject = (obj: any): any => {
    if (typeof obj !== 'object' || obj === null) return obj;
    
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        sanitized[key] = validationService.sanitizeString(value);
      } else if (typeof value === 'object') {
        sanitized[key] = sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  };

  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  next();
};

export const securityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
};

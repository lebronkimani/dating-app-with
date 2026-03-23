import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
  };
}

export const jwtAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const xUserId = req.headers['x-user-id'] as string;

    let userId: string | undefined;
    let userRole = 'user';
    let userEmail = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = await authService.verifyAccessToken(token);

      if (payload) {
        userId = payload.userId;
        userRole = payload.role;
        userEmail = payload.email;

        req.user = {
          userId: payload.userId,
          email: payload.email,
          role: payload.role
        };
      }
    } else if (xUserId) {
      userId = xUserId;
    }

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No valid authentication' });
      return;
    }

    (req as any).headers['x-user-id'] = userId;
    (req as any).headers['x-user-role'] = userRole;
    (req as any).headers['x-user-email'] = userEmail;

    next();
  } catch (error) {
    console.error('JWT auth middleware error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

export const requireAuth = jwtAuth;

export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = await authService.verifyAccessToken(token);

      if (payload) {
        req.user = {
          userId: payload.userId,
          email: payload.email,
          role: payload.role
        };
        (req as any).headers['x-user-id'] = payload.userId;
        (req as any).headers['x-user-role'] = payload.role;
        (req as any).headers['x-user-email'] = payload.email;
      }
    }

    next();
  } catch (error) {
    next();
  }
};

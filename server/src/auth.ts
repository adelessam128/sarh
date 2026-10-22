import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthUserPayload {
  sub: number;
  email: string;
  role: 'ADMIN' | 'AGENT';
  name?: string;
  iat?: number;
  exp?: number;
}

// Extend Express Request interface to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: JWT_SECRET environment variable is missing in production!');
    }
    return 'sarh-fallback-dev-secret-key-change-me';
  }
  return secret;
}

/**
 * requireAuth middleware:
 * Fixes contractor problems:
 * 1. Uses jwt.verify() instead of jwt.decode() so signature cannot be forged.
 * 2. Only extracts Bearer token from Authorization header (prevents query param leak).
 * 3. Handles expiration and signature verification gracefully.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Missing or malformed Bearer token.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Token missing.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as unknown as AuthUserPayload;
    if (!decoded || !decoded.sub || !decoded.role) {
      res.status(401).json({ error: 'Malformed authentication token claims.' });
      return;
    }
    req.user = decoded;
    next();
  } catch (err: unknown) {
    const error = err as Error;
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Authentication token has expired. Please log in again.' });
      return;
    }
    res.status(401).json({ error: 'Invalid or forged authentication token.' });
    return;
  }
}

/**
 * requireRole middleware:
 * Fixes contractor problem:
 * Enforces Role-Based Access Control (RBAC) securely on the SERVER.
 * Never delegates authorization to client-side components.
 */
export function requireRole(...allowedRoles: Array<'ADMIN' | 'AGENT'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Forbidden: This resource requires one of [${allowedRoles.join(', ')}] role privileges.`
      });
      return;
    }

    next();
  };
}


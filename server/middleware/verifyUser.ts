/**
 * server/middleware/verifyUser.ts
 * ────────────────────────────────
 * Verifies a Firebase ID token for any authenticated user (not admin-only).
 * Attaches `req.userId` and `req.userEmail` for downstream handlers.
 *
 * Usage:
 *   router.post('/payments/create-intent', verifyUser, handler)
 */

import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../firebaseAdmin';

export interface UserAuthRequest extends Request {
  userId:    string;
  userEmail: string;
}

export async function verifyUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization ?? '';

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing Authorization header.' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    (req as UserAuthRequest).userId    = decoded.uid;
    (req as UserAuthRequest).userEmail = decoded.email ?? '';
    next();
  } catch (err: any) {
    console.warn('[verifyUser] Token verification failed:', err.message);
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired token.' });
  }
}

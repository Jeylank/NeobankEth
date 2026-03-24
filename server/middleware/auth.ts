/**
 * middleware/auth.ts
 * ──────────────────
 * Verifies Firebase ID token and enforces admin-only access.
 *
 * Checks two layers:
 *   1. Firebase token validity (via Admin SDK)
 *   2. Custom claim `isAdmin: true`  OR  Firestore role field `role: "admin"`
 *
 * Usage:
 *   router.get('/api/admin/payouts', verifyAdmin, handler)
 */

import { Request, Response, NextFunction } from 'express';
import { adminAuth, adminDb } from '../firebaseAdmin';

export interface AuthRequest extends Request {
  adminId: string;
  adminEmail: string;
}

export async function verifyAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = await adminAuth.verifyIdToken(token);

    // Layer 1: custom claim
    if (decoded.isAdmin === true) {
      (req as AuthRequest).adminId    = decoded.uid;
      (req as AuthRequest).adminEmail = decoded.email ?? '';
      next();
      return;
    }

    // Layer 2: Firestore role field (fallback for existing users)
    const userSnap = await adminDb.collection('users').doc(decoded.uid).get();
    if (userSnap.exists && userSnap.data()?.role === 'admin') {
      (req as AuthRequest).adminId    = decoded.uid;
      (req as AuthRequest).adminEmail = decoded.email ?? '';
      next();
      return;
    }

    res.status(403).json({ error: 'Admin access required' });
  } catch (err: any) {
    res.status(401).json({ error: 'Invalid or expired token', detail: err.message });
  }
}

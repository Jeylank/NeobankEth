/**
 * server/routes/userProfile.ts
 * ──────────────────────────────
 * GET /api/user/profile — returns the authenticated user's profile,
 * backed by the Firestore `users` collection (same collection used by
 * verifyAdmin's role fallback check).
 */

import { Router, Request, Response } from 'express';
import { verifyUser, UserAuthRequest } from '../middleware/verifyUser';
import { adminDb } from '../firebaseAdmin';

const router = Router();

router.get('/user/profile', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { userId, userEmail } = req as UserAuthRequest;
  try {
    const snap = await adminDb.collection('users').doc(userId).get();
    const data = snap.exists ? snap.data()! : {};

    res.json({
      id: userId,
      username: data.username ?? userEmail?.split('@')[0] ?? userId,
      email: data.email ?? userEmail ?? '',
      fullName: data.fullName ?? data.name ?? '',
      phone: data.phone ?? undefined,
      preferredCurrency: data.preferredCurrency ?? 'USD',
      language: data.language ?? 'en',
      role: data.role ?? 'user',
    });
  } catch (err: any) {
    console.error('[userProfile] GET error:', err.message);
    res.status(500).json({ error: 'PROFILE_UNAVAILABLE', message: err.message });
  }
});

export default router;

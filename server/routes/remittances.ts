/**
 * server/routes/remittances.ts
 * ─────────────────────────────
 * User-facing remittance history endpoints.
 *
 * Routes (mounted at /api)
 * ────────────────────────
 *   GET  /api/remittances   — returns the authenticated user's transfer list
 */

import { Router, Response } from 'express';
import { verifyUser, UserAuthRequest } from '../middleware/verifyUser';
import { adminDb } from '../firebaseAdmin';

const router = Router();

// ─── GET /api/remittances ──────────────────────────────────────────────────────
// Returns the current user's remittance history, ordered newest-first.
// Falls back to an empty list if Firestore is unavailable.

router.get('/remittances', verifyUser, async (req, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;

  try {
    const snap = await adminDb
      .collection('remittances')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const remittances = snap.docs.map((doc) => ({
      id:              doc.id,
      ...doc.data(),
      // Firestore Timestamps → ISO strings for JSON serialisation
      createdAt:    doc.data().createdAt?.toDate?.()?.toISOString() ?? null,
      processingAt: doc.data().processingAt?.toDate?.()?.toISOString() ?? null,
      sentAt:       doc.data().sentAt?.toDate?.()?.toISOString() ?? null,
      completedAt:  doc.data().completedAt?.toDate?.()?.toISOString() ?? null,
    }));

    res.json({ remittances });
  } catch (err: any) {
    console.error('[remittances] Firestore query failed:', err.message);
    // Non-fatal — return empty list rather than a 500
    res.json({ remittances: [] });
  }
});

export default router;

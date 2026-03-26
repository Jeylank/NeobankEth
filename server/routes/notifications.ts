/**
 * server/routes/notifications.ts
 * ────────────────────────────────
 * Allows authenticated users to create their own in-app notifications
 * via the Admin SDK, bypassing Firestore client security rules.
 *
 *   POST /api/notifications  — requires Firebase ID token
 */

import { Router, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import { verifyUser, UserAuthRequest } from '../middleware/verifyUser';

const router = Router();

// ── GET /api/notifications — return current user's notifications ─────────────
router.get('/', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;

  try {
    // Single equality where — no composite index required.
    // Sort by createdAt descending on the client.
    const snap = await adminDb
      .collection('notifications')
      .where('userId', '==', userId)
      .limit(50)
      .get();

    const notifications = snap.docs.map((d) => {
      const data = d.data();
      return {
        id:        d.id,
        userId:    data.userId,
        type:      data.type,
        title:     data.title,
        message:   data.message,
        read:      data.read ?? false,
        data:      data.data ?? {},
        createdAt: data.createdAt?.toMillis?.() ?? null,
      };
    });

    // Sort descending by createdAt server-side before sending
    notifications.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    res.json({ notifications });
  } catch (err: any) {
    console.error('[Notifications] Failed to fetch notifications:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch notifications.' });
  }
});

// ── POST /api/notifications — create a notification via Admin SDK ─────────────
router.post('/', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;
  const { type, title, message, data } = req.body ?? {};

  if (!type || !title || !message) {
    res.status(400).json({ error: 'BAD_REQUEST', message: 'type, title, and message are required.' });
    return;
  }

  const ALLOWED_TYPES = ['transaction', 'remittance', 'security', 'promotion', 'system'];
  if (!ALLOWED_TYPES.includes(type)) {
    res.status(400).json({ error: 'BAD_REQUEST', message: `Invalid notification type: ${type}` });
    return;
  }

  try {
    const ref = await adminDb.collection('notifications').add({
      userId,
      type,
      title,
      message,
      read:      false,
      data:      data ?? {},
      createdAt: FieldValue.serverTimestamp(),
    });

    res.status(201).json({ id: ref.id });
  } catch (err: any) {
    console.error('[Notifications] Failed to create notification:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create notification.' });
  }
});

export default router;

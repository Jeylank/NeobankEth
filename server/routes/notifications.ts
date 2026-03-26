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

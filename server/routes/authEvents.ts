/**
 * server/routes/authEvents.ts
 * ───────────────────────────
 * POST /api/auth/log-login — recorded by the client immediately after a
 * successful Firebase sign-in, so the Admin Audit Logs screen has a real
 * LOGIN event trail (Firebase Auth itself only exposes lastSignInTime, not
 * a full history).
 */

import { Router, Request, Response } from 'express';
import { verifyUser, UserAuthRequest } from '../middleware/verifyUser';
import { writeLimiter } from '../middleware/rateLimiter';
import { logLoginEvent } from '../services/auditLogService';

const router = Router();

router.post('/auth/log-login', verifyUser, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  const { method } = req.body as { method?: string };
  const authReq = req as UserAuthRequest;

  try {
    await logLoginEvent({
      uid: authReq.userId,
      email: authReq.userEmail || null,
      method: method ?? 'email',
      ip: req.ip ?? '',
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[AuthEvents] log-login error:', err.message);
    // Never block sign-in on audit logging failure.
    res.status(200).json({ success: false });
  }
});

export default router;

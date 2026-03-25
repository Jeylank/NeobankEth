/**
 * server/routes/adminUsers.ts
 * ───────────────────────────
 * Admin user management — set / remove Firebase custom claims.
 *
 * Routes
 * ──────
 *   POST /api/admin/users/bootstrap   — one-time first-admin setup (ADMIN_BOOTSTRAP_SECRET)
 *   POST /api/admin/users/promote     — grant admin claim (requires existing admin)
 *   POST /api/admin/users/demote      — revoke admin claim (requires existing admin)
 *   GET  /api/admin/users/:uid/claims — view current claims for a user (requires admin)
 *
 * Bootstrap flow (first admin only)
 * ──────────────────────────────────
 *   Set ADMIN_BOOTSTRAP_SECRET in Replit Secrets to any strong passphrase.
 *   POST { "uid": "<firebase-uid>", "secret": "<ADMIN_BOOTSTRAP_SECRET>" }
 *   Once the first admin is promoted, use that account for all future promotes.
 */

import { Router, Request, Response } from 'express';
import { adminAuth, adminDb }        from '../firebaseAdmin';
import { verifyAdmin, AuthRequest }  from '../middleware/auth';
import { writeAuditLog }             from '../middleware/auditLog';

const router = Router();

// ─── Bootstrap (no admin token required — uses a shared secret) ───────────────

router.post('/users/bootstrap', async (req: Request, res: Response): Promise<void> => {
  const bootstrapSecret = process.env.ADMIN_BOOTSTRAP_SECRET;

  if (!bootstrapSecret) {
    res.status(503).json({
      error: 'BOOTSTRAP_DISABLED',
      message: 'Set the ADMIN_BOOTSTRAP_SECRET environment variable to enable this endpoint.',
    });
    return;
  }

  const { uid, email, secret } = req.body as {
    uid?: string;
    email?: string;
    secret?: string;
  };

  if (!secret || secret !== bootstrapSecret) {
    res.status(403).json({ error: 'INVALID_SECRET', message: 'Incorrect bootstrap secret.' });
    return;
  }

  if (!uid && !email) {
    res.status(400).json({ error: 'MISSING_FIELD', message: 'Provide uid or email.' });
    return;
  }

  try {
    let targetUid = uid;

    if (!targetUid && email) {
      const user = await adminAuth.getUserByEmail(email);
      targetUid = user.uid;
    }

    await adminAuth.setCustomUserClaims(targetUid!, { isAdmin: true });

    // Also write role to Firestore so verifyAdmin layer-2 check works immediately
    await adminDb.collection('users').doc(targetUid!).set(
      { role: 'admin', promotedAt: new Date().toISOString(), promotedBy: 'bootstrap' },
      { merge: true },
    );

    console.log(`[AdminBootstrap] Promoted uid=${targetUid} to admin`);

    res.json({
      success: true,
      message: 'User promoted to admin. They must sign out and back in for the claim to take effect.',
      uid: targetUid,
    });
  } catch (err: any) {
    console.error('[AdminBootstrap] Error:', err.message);
    res.status(500).json({ error: 'PROMOTION_FAILED', message: err.message });
  }
});

// ─── Promote (existing admin required) ───────────────────────────────────────

router.post('/users/promote', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  const { uid, email } = req.body as { uid?: string; email?: string };
  const adminId = (req as AuthRequest).adminId;

  if (!uid && !email) {
    res.status(400).json({ error: 'MISSING_FIELD', message: 'Provide uid or email.' });
    return;
  }

  try {
    let targetUid = uid;
    let targetEmail = email;

    if (!targetUid && email) {
      const user = await adminAuth.getUserByEmail(email);
      targetUid  = user.uid;
      targetEmail = user.email;
    } else if (targetUid && !targetEmail) {
      const user = await adminAuth.getUser(targetUid);
      targetEmail = user.email;
    }

    await adminAuth.setCustomUserClaims(targetUid!, { isAdmin: true });

    await adminDb.collection('users').doc(targetUid!).set(
      { role: 'admin', promotedAt: new Date().toISOString(), promotedBy: adminId },
      { merge: true },
    );

    await writeAuditLog({
      adminId,
      adminEmail: (req as AuthRequest).adminEmail,
      action: 'PROMOTE_ADMIN',
      entityId: targetUid!,
      entityType: 'user',
      payload: { targetUid, targetEmail },
      ip: req.ip ?? '',
    });

    res.json({
      success: true,
      message: 'User promoted to admin. They must sign out and back in for the claim to take effect.',
      uid: targetUid,
      email: targetEmail,
    });
  } catch (err: any) {
    console.error('[AdminUsers] Promote error:', err.message);
    res.status(500).json({ error: 'PROMOTION_FAILED', message: err.message });
  }
});

// ─── Demote (existing admin required) ────────────────────────────────────────

router.post('/users/demote', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  const { uid, email } = req.body as { uid?: string; email?: string };
  const adminId = (req as AuthRequest).adminId;

  if (!uid && !email) {
    res.status(400).json({ error: 'MISSING_FIELD', message: 'Provide uid or email.' });
    return;
  }

  try {
    let targetUid = uid;
    let targetEmail = email;

    if (!targetUid && email) {
      const user = await adminAuth.getUserByEmail(email);
      targetUid  = user.uid;
      targetEmail = user.email;
    }

    // Remove admin claim — set to false rather than delete to make it explicit
    await adminAuth.setCustomUserClaims(targetUid!, { isAdmin: false });

    await adminDb.collection('users').doc(targetUid!).set(
      { role: 'user', demotedAt: new Date().toISOString(), demotedBy: adminId },
      { merge: true },
    );

    await writeAuditLog({
      adminId,
      adminEmail: (req as AuthRequest).adminEmail,
      action: 'DEMOTE_ADMIN',
      entityId: targetUid!,
      entityType: 'user',
      payload: { targetUid, targetEmail },
      ip: req.ip ?? '',
    });

    res.json({
      success: true,
      message: 'Admin access revoked. Takes effect on their next sign-in.',
      uid: targetUid,
      email: targetEmail,
    });
  } catch (err: any) {
    console.error('[AdminUsers] Demote error:', err.message);
    res.status(500).json({ error: 'DEMOTION_FAILED', message: err.message });
  }
});

// ─── View claims (existing admin required) ────────────────────────────────────

router.get('/users/:uid/claims', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  const { uid } = req.params;

  try {
    const user = await adminAuth.getUser(uid);
    const firestoreSnap = await adminDb.collection('users').doc(uid).get();

    res.json({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      customClaims: user.customClaims ?? {},
      firestoreRole: firestoreSnap.exists ? firestoreSnap.data()?.role : null,
      disabled: user.disabled,
      createdAt: user.metadata.creationTime,
      lastSignIn: user.metadata.lastSignInTime,
    });
  } catch (err: any) {
    console.error('[AdminUsers] Get claims error:', err.message);
    res.status(404).json({ error: 'USER_NOT_FOUND', message: err.message });
  }
});

export default router;

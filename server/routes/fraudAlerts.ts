/**
 * routes/fraudAlerts.ts
 * ─────────────────────
 * GET  /api/admin/fraud-alerts
 * POST /api/admin/fraud-action
 *
 * Fraud alerts live in `fraud_alerts` collection.
 * Actions are written to `transaction_flags` + audit log.
 * Source payout_transactions are NEVER modified directly.
 */

import { Router, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import { verifyAdmin, AuthRequest } from '../middleware/auth';
import { writeAuditLog } from '../middleware/auditLog';
import { requireFields, requireEnum } from '../middleware/validate';

const router = Router();
const FRAUD_COL = 'fraud_alerts';
const FLAGS_COL = 'transaction_flags';

const FRAUD_ACTIONS = ['APPROVE', 'BLOCK', 'FREEZE'] as const;
type FraudAction = typeof FRAUD_ACTIONS[number];

// ─── GET /api/admin/fraud-alerts ─────────────────────────────────────────────

router.get('/fraud-alerts', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, provider, limitParam } = req.query as Record<string, string>;
    const pageLimit = Math.min(parseInt(limitParam ?? '50', 10), 200);

    let q = adminDb.collection(FRAUD_COL).orderBy('createdAt', 'desc').limit(pageLimit) as any;
    if (status) q = adminDb.collection(FRAUD_COL).where('status', '==', status).orderBy('createdAt', 'desc').limit(pageLimit);

    const snap = await q.get();

    const alerts = snap.docs.map((d: any) => {
      const data = d.data();
      return {
        alertId   : d.id,
        txId      : data.txId      ?? null,
        userId    : data.userId    ?? null,
        riskScore : data.riskScore ?? 0,
        reason    : data.reason    ?? null,
        status    : data.status    ?? 'REVIEW_REQUIRED',
        provider  : data.provider  ?? null,
        amount    : data.amount    ?? 0,
        currency  : data.currency  ?? 'ETB',
        createdAt : data.createdAt ?? null,
      };
    });

    const reviewRequired = alerts.filter((a: any) => a.status === 'REVIEW_REQUIRED').length;
    const blocked        = alerts.filter((a: any) => a.status === 'BLOCKED').length;

    res.json({ alerts, total: alerts.length, reviewRequired, blocked });
  } catch (err: any) {
    console.error('[/api/admin/fraud-alerts]', err.message);
    res.status(500).json({ error: 'Failed to fetch fraud alerts', detail: err.message });
  }
});

// ─── POST /api/admin/fraud-action ────────────────────────────────────────────

router.post(
  '/fraud-action',
  verifyAdmin,
  requireFields('txId', 'action'),
  requireEnum('action', FRAUD_ACTIONS),
  async (req: Request, res: Response): Promise<void> => {
    const { txId, action, alertId, reason } = req.body as {
      txId: string; action: FraudAction; alertId?: string; reason?: string;
    };
    const adminReq = req as AuthRequest;

    try {
      const now = new Date().toISOString();

      const statusMap: Record<FraudAction, string> = {
        APPROVE: 'APPROVED',
        BLOCK  : 'BLOCKED',
        FREEZE : 'FROZEN',
      };

      const batch = adminDb.batch();

      // 1. Update fraud_alert document (if alertId provided)
      if (alertId) {
        const alertRef = adminDb.collection(FRAUD_COL).doc(alertId);
        batch.update(alertRef, {
          status    : statusMap[action],
          resolvedBy: adminReq.adminId,
          resolvedAt: now,
          resolution: reason ?? null,
        });
      }

      // 2. Write transaction_flag (does NOT modify payout_transactions)
      const flagRef = adminDb.collection(FLAGS_COL).doc(txId);
      batch.set(flagRef, {
        txId,
        flag     : `FRAUD_${action}`,
        status   : statusMap[action],
        adminId  : adminReq.adminId,
        reason   : reason ?? null,
        flaggedAt: now,
      }, { merge: true });

      await batch.commit();

      // 3. Audit log
      await writeAuditLog({
        adminId   : adminReq.adminId,
        adminEmail: adminReq.adminEmail,
        action    : `FRAUD_${action}`,
        entityId  : txId,
        entityType: 'fraud_alert',
        payload   : { txId, action, alertId, reason },
        ip        : req.ip ?? '',
      });

      res.json({ success: true, txId, action, status: statusMap[action] });
    } catch (err: any) {
      console.error('[/api/admin/fraud-action]', err.message);
      res.status(500).json({ error: 'Failed to process fraud action', detail: err.message });
    }
  },
);

export default router;

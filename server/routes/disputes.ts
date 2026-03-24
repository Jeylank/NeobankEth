/**
 * routes/disputes.ts
 * ──────────────────
 * GET  /api/admin/disputes
 * POST /api/admin/dispute-action
 *
 * Collection: disputes
 * Each dispute links to: txId, providerRef, userId
 */

import { Router, Request, Response } from 'express';
import { adminDb } from '../firebaseAdmin';
import { verifyAdmin, AuthRequest } from '../middleware/auth';
import { writeAuditLog } from '../middleware/auditLog';
import { requireFields, requireEnum } from '../middleware/validate';

const router = Router();
const DISPUTES_COL = 'disputes';

const DISPUTE_ACTIONS = ['INVESTIGATE', 'REFUND', 'REJECT', 'RESOLVE'] as const;
type DisputeAction = typeof DISPUTE_ACTIONS[number];

// Status each action transitions the dispute to
const ACTION_STATUS_MAP: Record<DisputeAction, string> = {
  INVESTIGATE: 'UNDER_INVESTIGATION',
  REFUND     : 'REFUNDED',
  REJECT     : 'REJECTED',
  RESOLVE    : 'RESOLVED',
};

// ─── GET /api/admin/disputes ──────────────────────────────────────────────────

router.get('/disputes', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, userId, provider, limit: limitParam } = req.query as Record<string, string>;
    const pageLimit = Math.min(parseInt(limitParam ?? '50', 10), 200);

    let q = adminDb.collection(DISPUTES_COL).orderBy('createdAt', 'desc').limit(pageLimit) as any;
    if (status) {
      q = adminDb.collection(DISPUTES_COL)
        .where('status', '==', status)
        .orderBy('createdAt', 'desc')
        .limit(pageLimit);
    }
    if (userId) {
      q = adminDb.collection(DISPUTES_COL)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(pageLimit);
    }

    const snap = await q.get();

    const disputes = snap.docs.map((d: any) => {
      const data = d.data();
      return {
        disputeId  : d.id,
        txId       : data.txId        ?? null,
        providerRef: data.providerRef  ?? null,
        userId     : data.userId      ?? null,
        provider   : data.provider    ?? null,
        amount     : data.amount      ?? 0,
        currency   : data.currency    ?? 'ETB',
        reason     : data.reason      ?? null,
        description: data.description ?? null,
        status     : data.status      ?? 'OPEN',
        priority   : data.priority    ?? 'NORMAL',
        createdAt  : data.createdAt   ?? null,
        updatedAt  : data.updatedAt   ?? null,
        resolvedAt : data.resolvedAt  ?? null,
        resolvedBy : data.resolvedBy  ?? null,
      };
    });

    const open          = disputes.filter((d: any) => d.status === 'OPEN').length;
    const investigating = disputes.filter((d: any) => d.status === 'UNDER_INVESTIGATION').length;
    const refunded      = disputes.filter((d: any) => d.status === 'REFUNDED').length;

    res.json({ disputes, total: disputes.length, open, investigating, refunded });
  } catch (err: any) {
    console.error('[/api/admin/disputes]', err.message);
    res.status(500).json({ error: 'Failed to fetch disputes', detail: err.message });
  }
});

// ─── POST /api/admin/dispute-action ──────────────────────────────────────────

router.post(
  '/dispute-action',
  verifyAdmin,
  requireFields('disputeId', 'action'),
  requireEnum('action', DISPUTE_ACTIONS),
  async (req: Request, res: Response): Promise<void> => {
    const { disputeId, action, note, refundAmount, refundRef } = req.body as {
      disputeId  : string;
      action     : DisputeAction;
      note?      : string;
      refundAmount?: number;
      refundRef? : string;
    };
    const adminReq = req as AuthRequest;

    try {
      const now       = new Date().toISOString();
      const newStatus = ACTION_STATUS_MAP[action];

      const updates: Record<string, any> = {
        status   : newStatus,
        updatedAt: now,
        updatedBy: adminReq.adminId,
      };

      if (note) updates['adminNote'] = note;

      if (action === 'REFUND') {
        updates['refundedAt']    = now;
        updates['refundedBy']    = adminReq.adminId;
        if (refundAmount) updates['refundAmount'] = refundAmount;
        if (refundRef)    updates['refundRef']    = refundRef;
      }

      if (action === 'RESOLVE' || action === 'REJECT') {
        updates['resolvedAt'] = now;
        updates['resolvedBy'] = adminReq.adminId;
      }

      await adminDb.collection(DISPUTES_COL).doc(disputeId).update(updates);

      await writeAuditLog({
        adminId   : adminReq.adminId,
        adminEmail: adminReq.adminEmail,
        action    : `DISPUTE_${action}`,
        entityId  : disputeId,
        entityType: 'dispute',
        payload   : { disputeId, action, note, refundAmount, refundRef },
        ip        : req.ip ?? '',
      });

      res.json({ success: true, disputeId, action, status: newStatus });
    } catch (err: any) {
      console.error('[/api/admin/dispute-action]', err.message);
      res.status(500).json({ error: 'Failed to process dispute action', detail: err.message });
    }
  },
);

export default router;

/**
 * routes/payouts.ts
 * ─────────────────
 * GET /api/admin/payouts
 *
 * Returns paginated payout transactions from `payout_transactions` collection.
 * Supports query filters: status, provider, dateFrom, dateTo.
 * Never modifies any transaction data.
 *
 * Global safety guards:
 *   - Checks systemConfigService.isSystemEnabled() — rejects if platform disabled.
 *   - Checks systemConfigService.isPayoutEnabled() — rejects payout reads when
 *     payouts are administratively disabled (signals potential fraud response).
 */

import { Router, Request, Response } from 'express';
import { adminDb } from '../firebaseAdmin';
import { verifyAdmin, AuthRequest } from '../middleware/auth';
import { systemConfigService } from '../services/systemConfigService';
import type { Query, CollectionReference } from 'firebase-admin/firestore';

const router = Router();
const PAYOUTS_COL = 'payout_transactions';

router.get('/payouts', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    // ── Global system-config guards ───────────────────────────────────────────
    const [systemEnabled, payoutEnabled] = await Promise.all([
      systemConfigService.isSystemEnabled(),
      systemConfigService.isPayoutEnabled(),
    ]);

    if (!systemEnabled) {
      console.warn('[/payouts] Blocked — SYSTEM_DISABLED');
      res.status(503).json({ error: 'SYSTEM_DISABLED', message: 'The platform is currently disabled.' });
      return;
    }
    if (!payoutEnabled) {
      console.warn('[/payouts] Blocked — PAYOUT_DISABLED');
      res.status(503).json({ error: 'PAYOUT_DISABLED', message: 'Payout operations are currently disabled.' });
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const { status, provider, dateFrom, dateTo, limit: limitParam, page } = req.query as Record<string, string>;

    const pageLimit = Math.min(parseInt(limitParam ?? '50', 10), 200);

    let q: Query = adminDb.collection(PAYOUTS_COL) as CollectionReference;

    if (status)   q = q.where('payoutStatus', '==', status.toUpperCase());
    if (provider) q = q.where('provider',     '==', provider.toUpperCase());
    if (dateFrom) q = q.where('createdAt',    '>=', dateFrom);
    if (dateTo)   q = q.where('createdAt',    '<=', dateTo);

    q = q.orderBy('createdAt', 'desc').limit(pageLimit);

    const snap = await q.get();

    const payouts = snap.docs.map((d) => {
      const data = d.data();
      return {
        txId       : data.id ?? d.id,
        userId     : data.userId     ?? null,
        provider   : data.provider   ?? null,
        providerRef: data.providerRef ?? null,
        amount     : data.amount     ?? 0,
        currency   : data.currency   ?? 'ETB',
        payoutStatus: data.payoutStatus ?? null,
        retryCount : data.retryCount ?? 0,
        createdAt  : data.createdAt  ?? null,
      };
    });

    // Counts by status for the dashboard
    const total   = snap.size;
    const failed  = payouts.filter(p => p.payoutStatus === 'FAILED').length;
    const pending = payouts.filter(p => ['PENDING', 'PROCESSING'].includes(p.payoutStatus ?? '')).length;

    res.json({ payouts, total, failed, pending });
  } catch (err: any) {
    console.error('[/api/admin/payouts]', err.message);
    res.status(500).json({ error: 'Failed to fetch payouts', detail: err.message });
  }
});

export default router;

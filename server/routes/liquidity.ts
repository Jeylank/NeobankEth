/**
 * routes/liquidity.ts
 * ───────────────────
 * GET /api/admin/liquidity
 *
 * Returns per-bank liquidity positions from `treasury_liquidity` collection.
 * Read-only — no writes.
 */

import { Router, Request, Response } from 'express';
import { adminDb } from '../firebaseAdmin';
import { verifyAdmin } from '../middleware/auth';

const router = Router();
const LIQUIDITY_COL = 'treasury_liquidity';

router.get('/liquidity', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { currency, bank } = req.query as Record<string, string>;

    let q = adminDb.collection(LIQUIDITY_COL).orderBy('bank', 'asc') as any;
    if (currency) q = adminDb.collection(LIQUIDITY_COL).where('currency', '==', currency.toUpperCase()).orderBy('bank', 'asc');
    if (bank)     q = adminDb.collection(LIQUIDITY_COL).where('bank',     '==', bank.toUpperCase()).orderBy('currency', 'asc');

    const snap = await q.get();

    const pools = snap.docs.map((d: any) => {
      const data = d.data();
      const available = data.available ?? data.balance ?? 0;
      const reserved  = data.reserved  ?? 0;
      const threshold = data.threshold ?? data.lowThreshold ?? 0;

      return {
        poolId   : d.id,
        bank     : data.bank     ?? data.provider ?? 'UNKNOWN',
        currency : data.currency ?? 'ETB',
        available,
        reserved,
        net      : available - reserved,
        threshold,
        isLow    : available < threshold,
        lastUpdated: data.lastUpdated ?? data.updatedAt ?? null,
      };
    });

    // Aggregate totals per currency
    const totals: Record<string, { available: number; reserved: number; net: number }> = {};
    for (const pool of pools) {
      if (!totals[pool.currency]) {
        totals[pool.currency] = { available: 0, reserved: 0, net: 0 };
      }
      totals[pool.currency].available += pool.available;
      totals[pool.currency].reserved  += pool.reserved;
      totals[pool.currency].net       += pool.net;
    }

    const lowLiquidityCount = pools.filter((p: any) => p.isLow).length;

    res.json({ pools, totals, total: pools.length, lowLiquidityCount });
  } catch (err: any) {
    console.error('[/api/admin/liquidity]', err.message);
    res.status(500).json({ error: 'Failed to fetch liquidity data', detail: err.message });
  }
});

export default router;

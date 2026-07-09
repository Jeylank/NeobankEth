/**
 * server/routes/adminTransfers.ts
 * ─────────────────────────────────
 * Admin Transfers screen API. Mounted at /api/admin in server/index.ts.
 *
 * GET  /api/admin/transfers            — search/filter transfers
 * GET  /api/admin/transfers/:txId      — full detail (timeline, fraud, KYC)
 * POST /api/admin/transfers/:txId/retry — retry reconciliation (agent reassignment
 *                                         or provider/quote resume, as appropriate)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireApiKey } from '../middleware/apiKeyAuth';
import { verifyAdmin }   from '../middleware/auth';
import { readLimiter, writeLimiter } from '../middleware/rateLimiter';
import {
  searchTransfers,
  getTransferDetail,
  retryTransferReconciliation,
  TransferRetryError,
} from '../services/adminTransfersService';

const router = Router();

function requireAdminOrApiKey(req: Request, res: Response, next: NextFunction): void {
  const hasApiKey = Boolean(req.headers['x-api-key']);
  if (hasApiKey) {
    requireApiKey(req, res, next);
  } else {
    verifyAdmin(req, res, next);
  }
}

function handleError(res: Response, err: unknown, context: string): void {
  if (err instanceof TransferRetryError) {
    res.status(err.status).json({ error: 'RETRY_NOT_ELIGIBLE', message: err.message });
    return;
  }
  const msg = (err as Error).message ?? 'Unexpected error';
  console.error(`[AdminTransfers] ${context}: ${msg}`);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: msg });
}

router.get(
  '/transfers',
  requireAdminOrApiKey,
  readLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { txId, q, status, limit } = req.query as Record<string, string | undefined>;
      const data = await searchTransfers({
        txId,
        query: q,
        status,
        limit: limit ? Number(limit) : undefined,
      });
      res.json({ ...data, fetchedAt: new Date().toISOString() });
    } catch (err) { handleError(res, err, 'GET /transfers'); }
  },
);

router.get(
  '/transfers/:txId',
  requireAdminOrApiKey,
  readLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const detail = await getTransferDetail(req.params.txId);
      if (!detail) {
        res.status(404).json({ error: 'TRANSFER_NOT_FOUND', message: `Transfer '${req.params.txId}' not found.` });
        return;
      }
      res.json(detail);
    } catch (err) { handleError(res, err, `GET /transfers/${req.params.txId}`); }
  },
);

router.post(
  '/transfers/:txId/retry',
  requireAdminOrApiKey,
  writeLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await retryTransferReconciliation(req.params.txId);
      res.json({ ok: true, txId: req.params.txId, ...result });
    } catch (err) { handleError(res, err, `POST /transfers/${req.params.txId}/retry`); }
  },
);

export default router;

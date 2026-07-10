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
  moveTransferToRecovery,
  initiatePermittedRefund,
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
  console.error(`[AdminTransfers] ${context}: internal failure`);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'The request could not be completed.' });
}

const VALID_STATUSES = new Set(['PAYMENT_PENDING','PAYMENT_CONFIRMING','FUNDS_RECEIVED','AGENT_ASSIGNED','OTP_SENT','READY_FOR_PAYOUT','PAID_OUT','COMPLETED','FAILED','TIMED_OUT','REFUNDED','PENDING_LIQUIDITY','PENDING_REQUOTE','RECOVERY_PENDING','BLOCKED_FRAUD','PAYMENT_FAILED','PAYMENT_EXPIRED']);
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function validId(value: string): boolean { return VALID_ID.test(value); }

router.get(
  '/transfers',
  requireAdminOrApiKey,
  readLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { txId, q, status, limit } = req.query as Record<string, string | undefined>;
      const parsedLimit = limit === undefined ? undefined : Number(limit);
      if (limit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit! < 1 || parsedLimit! > 200)) {
        res.status(400).json({ error: 'INVALID_LIMIT', message: 'limit must be an integer from 1 to 200.' }); return;
      }
      if (status && !VALID_STATUSES.has(status)) { res.status(400).json({ error: 'INVALID_STATUS', message: 'Unsupported transfer status.' }); return; }
      if (txId && !validId(txId)) { res.status(400).json({ error: 'INVALID_ID', message: 'Invalid transfer ID.' }); return; }
      const data = await searchTransfers({
        txId,
        query: q,
        status,
        limit: parsedLimit,
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
      if (!validId(req.params.txId)) { res.status(400).json({ error: 'INVALID_ID', message: 'Invalid transfer ID.' }); return; }
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
  verifyAdmin,
  writeLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!validId(req.params.txId)) { res.status(400).json({ error: 'INVALID_ID', message: 'Invalid transfer ID.' }); return; }
      const result = await retryTransferReconciliation(req.params.txId);
      res.json({ ok: true, txId: req.params.txId, ...result });
    } catch (err) { handleError(res, err, `POST /transfers/${req.params.txId}/retry`); }
  },
);

router.post('/transfers/:txId/recovery', verifyAdmin, writeLimiter, async (req, res) => {
  try {
    if (!validId(req.params.txId)) { res.status(400).json({ error: 'INVALID_ID', message: 'Invalid transfer ID.' }); return; }
    res.json({ ok: true, txId: req.params.txId, ...(await moveTransferToRecovery(req.params.txId)) });
  } catch (err) { handleError(res, err, `POST /transfers/${req.params.txId}/recovery`); }
});

router.post('/transfers/:txId/refund', verifyAdmin, writeLimiter, async (req, res) => {
  try {
    if (!validId(req.params.txId)) { res.status(400).json({ error: 'INVALID_ID', message: 'Invalid transfer ID.' }); return; }
    res.json({ ok: true, txId: req.params.txId, ...(await initiatePermittedRefund(req.params.txId)) });
  } catch (err) { handleError(res, err, `POST /transfers/${req.params.txId}/refund`); }
});

export default router;

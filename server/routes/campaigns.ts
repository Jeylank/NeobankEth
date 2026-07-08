/**
 * server/routes/campaigns.ts
 * ───────────────────────────
 * RESTful campaign contribution endpoint.
 * Mounted at /api/campaigns in server/index.ts.
 *
 * POST /api/campaigns/:campaignId/contribute
 *
 * This is an alias of the v1 simulation endpoint
 * POST /api/v1/campaign/contribute
 * but follows the RESTful convention (campaignId in URL path) that
 * external QA simulation tools expect.
 *
 * Authentication: X-API-Key header (same as simulation API).
 */

import { Router, Request, Response } from 'express';
import {
  extractIdempotencyKey,
  checkIdempotency,
  FX_BASE_RATES,
  SimError,
} from '../services/simulationEngine';
import { remittanceProvider } from '../services/remittance';

const router = Router();

// ─── API Key Middleware ────────────────────────────────────────────────────────

function requireApiKey(req: Request, res: Response, next: () => void): void {
  const expectedKey = process.env.SIMULATION_API_KEY;
  if (!expectedKey) return next();
  const provided =
    (req.headers['x-api-key'] as string | undefined) ??
    (req.query['api_key']     as string | undefined) ?? '';
  if (provided !== expectedKey) {
    res.status(401).json({ error: 'INVALID_API_KEY', message: 'Provide a valid X-API-Key header.' });
    return;
  }
  next();
}

// ─── POST /api/campaigns/:campaignId/contribute ───────────────────────────────
/**
 * Body:
 *   userId       string  — required
 *   amount       number  — required (positive)
 *   currency     string  — EUR|USD|GBP (default EUR)
 *   purpose      string  — required (AML compliance)
 *   quoteId      string  — optional locked FX quote
 *
 * Idempotency:
 *   Send Idempotency-Key header (or idempotencyKey body field) to prevent
 *   double-charges on network retries.
 *
 * Errors:
 *   400 INVALID_USER_ID | INVALID_AMOUNT | MISSING_PURPOSE | UNSUPPORTED_CURRENCY
 *   402 INSUFFICIENT_FUNDS
 *   404 CAMPAIGN_NOT_FOUND
 *   422 COMPLIANCE_METADATA_MISSING | LIQUIDITY_SHORTAGE
 *   503 PROVIDER_UNAVAILABLE
 */
router.post('/:campaignId/contribute', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const campaignId = req.params.campaignId;

  // FIX B: Idempotency check runs BEFORE field validation so a duplicate request
  // with a missing field returns the cached 200 response, not a 400 error.
  const idempotencyKey = extractIdempotencyKey(req.headers as any, req.body ?? {});
  const cached = await checkIdempotency(idempotencyKey);
  if (cached) { res.status(cached.status).json(cached.payload); return; }

  const { userId, amount, currency = 'EUR', purpose, quoteId } = req.body ?? {};

  // ── Input validation ──────────────────────────────────────────────────────────
  if (!userId || typeof userId !== 'string') {
    res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' });
    return;
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' });
    return;
  }
  if (!purpose || typeof purpose !== 'string') {
    res.status(400).json({ error: 'MISSING_PURPOSE', message: 'purpose is required for campaign contributions (AML compliance).' });
    return;
  }
  const ccy = (currency as string).toUpperCase();
  if (!FX_BASE_RATES[ccy]) {
    res.status(400).json({ error: 'UNSUPPORTED_CURRENCY', message: `Currency ${currency} is not supported. Use EUR, USD, or GBP.` });
    return;
  }

  // ── Validate campaign exists (simulation: all non-empty campaignIds are valid) ──
  // In production this would query a Firestore campaigns collection.
  if (!campaignId || campaignId.trim().length === 0) {
    res.status(404).json(SimError.campaignNotFound(campaignId));
    return;
  }

  // ── Delegate to shared engine ─────────────────────────────────────────────────
  const result = await remittanceProvider.initiate({
    userId,
    recipientId:     `campaign:${campaignId}`,
    amount,
    currency:        ccy,
    type:            'campaign_contribution',
    quoteId,
    metadata:        { campaignId, purpose, transactionCode: 'DONATION_CHARITY' },
    idempotencyKey,
  });

  res.status(result.status).json(result.payload);
});

export default router;

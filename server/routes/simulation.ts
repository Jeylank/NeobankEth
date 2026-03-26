/**
 * server/routes/simulation.ts
 * ────────────────────────────
 * Simulation API v1 routes. Mounted at /api/v1 in server/index.ts.
 *
 * All business logic and Firestore persistence live in
 * server/services/simulationEngine.ts — this file is a thin HTTP layer only.
 *
 * Authentication: X-API-Key header (set SIMULATION_API_KEY env var).
 * CORS: open (*) — external simulation apps can call directly from a browser.
 */

import { Router, Request, Response } from 'express';
import {
  FX_BASE_RATES, jitter, liveRate,
  QUOTE_TTL_MS, QUOTE_BUFFER_MS,
  DEFAULT_LIQUIDITY, REPLENISH_THRESHOLD, REPLENISH_TARGET,
  providers, selectProvider, tripProvider, resetAllProviders,
  processRemittance, extractIdempotencyKey,
  createQuote, getWalletBalances, getLiquidityETB,
  getOrAgeTx, stripeTopUp, fullReset, resetLiquidityPool,
} from '../services/simulationEngine';
import { adminDb } from '../firebaseAdmin';

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

// ─── GET /api/v1/health ───────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok', service: 'habeshare-simulation-api', version: 'v1',
    persistence: 'firestore',
    timestamp: new Date().toISOString(),
    selfHealingFeatures: [
      'quote-auto-refresh',
      'treasury-auto-replenish',
      'provider-deterministic-failover',
      'idempotency-firestore-backed',
      'atomic-wallet-deduction',
      'audit-logs',
    ],
    endpoints: [
      'POST /api/v1/fx/quote',
      'GET  /api/v1/fx/quotes',
      'POST /api/v1/wallet/topup',
      'GET  /api/v1/wallet/:userId',
      'POST /api/v1/remittance/initiate',
      'GET  /api/v1/remittance/:txId',
      'POST /api/v1/campaign/contribute',
      'POST /api/v1/recurring/process',
      'GET  /api/v1/liquidity',
      'GET  /api/v1/circuit-breaker/status',
      'POST /api/v1/circuit-breaker/trip/:provider',
      'POST /api/v1/circuit-breaker/reset',
      'POST /api/v1/simulation/reset',
      'POST /api/campaigns/:campaignId/contribute',
    ],
  });
});

// ─── POST /api/v1/fx/quote ────────────────────────────────────────────────────

router.post('/fx/quote', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { from, to } = req.body ?? {};
  const f = (from ?? '').toString().toUpperCase();
  const t = (to   ?? '').toString().toUpperCase();
  if (!f || !t) { res.status(400).json({ error: 'MISSING_PARAMS', message: 'from and to are required.' }); return; }
  if (!FX_BASE_RATES[f]?.[t]) { res.status(404).json({ error: 'PAIR_NOT_FOUND', message: `No rate for ${f}→${t}.` }); return; }

  try {
    const quote = await createQuote(f, t);
    res.json({
      quoteId:             quote.quoteId,
      from:                quote.from,
      to:                  quote.to,
      rate:                quote.rate,
      expiresAt:           new Date(quote.expiresAt).toISOString(),
      expiresInSeconds:    QUOTE_TTL_MS / 1000,
      bufferSeconds:       QUOTE_BUFFER_MS / 1000,
      autoRefreshOnExpiry: true,
      lockedAt:            quote.lockedAt,
      persistence:         'firestore',
    });
  } catch (err: any) {
    console.error('[SimAPI] /fx/quote error:', err.message);
    res.status(500).json({ error: 'QUOTE_CREATION_FAILED', message: err.message });
  }
});

// ─── GET /api/v1/fx/quotes ────────────────────────────────────────────────────

router.get('/fx/quotes', requireApiKey, (req: Request, res: Response) => {
  const from = ((req.query.from as string) ?? '').toUpperCase();
  const to   = ((req.query.to   as string) ?? '').toUpperCase();
  if (from && to) {
    const rate = FX_BASE_RATES[from]?.[to];
    if (!rate) { res.status(404).json({ error: 'PAIR_NOT_FOUND', message: `No rate for ${from}→${to}.` }); return; }
    res.json({ from, to, rate: parseFloat((rate * jitter()).toFixed(6)), timestamp: new Date().toISOString(), source: 'habeshare-fx' });
    return;
  }
  const quotes: object[] = [];
  for (const [b, targets] of Object.entries(FX_BASE_RATES))
    for (const [tgt, r] of Object.entries(targets))
      quotes.push({ from: b, to: tgt, rate: parseFloat((r * jitter()).toFixed(6)), timestamp: new Date().toISOString(), source: 'habeshare-fx' });
  res.json({ quotes, count: quotes.length });
});

// ─── POST /api/v1/wallet/topup ────────────────────────────────────────────────

router.post('/wallet/topup', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { userId, amount, currency = 'EUR' } = req.body as { userId?: unknown; amount?: unknown; currency?: unknown };
  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' }); return; }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' }); return; }
  try {
    const result = await stripeTopUp(userId, amount as number, currency as string);
    res.status(200).json({ ...result, message: 'PaymentIntent created. Use clientSecret to confirm via Stripe.js.' });
  } catch (err: any) {
    console.error('[SimAPI] /wallet/topup error:', err.message);
    res.status(500).json({ error: 'PAYMENT_PROVIDER_ERROR', message: err.message ?? 'Internal server error' });
  }
});

// ─── GET /api/v1/wallet/:userId ───────────────────────────────────────────────

router.get('/wallet/:userId', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  try {
    // Try Firestore app wallet first (real wallet), fall back to sim wallet
    const appWalletDoc = await adminDb.collection('wallets').doc(userId).get();
    if (appWalletDoc.exists) {
      const data = appWalletDoc.data() ?? {};
      res.json({ userId, balances: data.balances ?? {}, updatedAt: data.updatedAt ?? null, source: 'firestore-app' });
      return;
    }
    const balances = await getWalletBalances(userId);
    res.json({ userId, balances, source: 'firestore-sim' });
  } catch (err: any) {
    console.error('[SimAPI] /wallet/:userId error:', err.message);
    res.status(500).json({ error: 'WALLET_READ_FAILED', message: err.message });
  }
});

// ─── POST /api/v1/remittance/initiate ─────────────────────────────────────────

router.post('/remittance/initiate', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { userId, recipientId, amount, currency = 'EUR', quoteId, metadata } = req.body ?? {};
  const idempotencyKey = extractIdempotencyKey(req.headers as any, req.body ?? {});

  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' }); return; }
  if (!recipientId || typeof recipientId !== 'string') { res.status(400).json({ error: 'INVALID_RECIPIENT', message: 'recipientId is required.' }); return; }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' }); return; }
  if (!FX_BASE_RATES[(currency as string).toUpperCase()]) { res.status(400).json({ error: 'UNSUPPORTED_CURRENCY', message: `Currency ${currency} is not supported.` }); return; }

  const result = await processRemittance({
    userId, recipientId, amount,
    currency: (currency as string).toUpperCase(),
    type: 'standard', quoteId, metadata, idempotencyKey,
  });
  res.status(result.status).json(result.payload);
});

// ─── POST /api/v1/campaign/contribute ────────────────────────────────────────

router.post('/campaign/contribute', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { userId, campaignId, amount, currency = 'EUR', purpose, quoteId } = req.body ?? {};
  const idempotencyKey = extractIdempotencyKey(req.headers as any, req.body ?? {});

  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' }); return; }
  if (!campaignId || typeof campaignId !== 'string') { res.status(400).json({ error: 'INVALID_CAMPAIGN_ID', message: 'campaignId is required.' }); return; }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' }); return; }
  if (!purpose || typeof purpose !== 'string') { res.status(400).json({ error: 'MISSING_PURPOSE', message: 'purpose is required for campaign contributions (AML compliance).' }); return; }

  const result = await processRemittance({
    userId, recipientId: `campaign:${campaignId}`, amount,
    currency: (currency as string).toUpperCase(), type: 'campaign_contribution',
    quoteId, metadata: { campaignId, purpose, transactionCode: 'DONATION_CHARITY' }, idempotencyKey,
  });
  res.status(result.status).json(result.payload);
});

// ─── POST /api/v1/recurring/process ──────────────────────────────────────────

router.post('/recurring/process', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { userId, scheduleId, recipientId, amount, currency = 'EUR', quoteId } = req.body ?? {};
  const idempotencyKey =
    extractIdempotencyKey(req.headers as any, req.body ?? {}) ??
    (scheduleId ? `sched:${scheduleId}` : null);

  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' }); return; }
  if (!scheduleId || typeof scheduleId !== 'string') { res.status(400).json({ error: 'INVALID_SCHEDULE_ID', message: 'scheduleId is required.' }); return; }
  if (!recipientId || typeof recipientId !== 'string') { res.status(400).json({ error: 'INVALID_RECIPIENT', message: 'recipientId is required.' }); return; }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' }); return; }

  const result = await processRemittance({
    userId, recipientId, amount,
    currency: (currency as string).toUpperCase(), type: 'recurring_support',
    quoteId, metadata: { scheduleId }, idempotencyKey,
  });
  res.status(result.status).json(result.payload);
});

// ─── GET /api/v1/remittance/:txId ────────────────────────────────────────────

router.get('/remittance/:txId', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const tx = await getOrAgeTx(req.params.txId);
    if (!tx) { res.status(404).json({ error: 'NOT_FOUND', message: `Transaction ${req.params.txId} not found.` }); return; }
    res.json({ ...tx, transactionId: tx.txId });
  } catch (err: any) {
    console.error('[SimAPI] /remittance/:txId error:', err.message);
    res.status(500).json({ error: 'TX_READ_FAILED', message: err.message });
  }
});

// ─── GET /api/v1/liquidity ────────────────────────────────────────────────────

router.get('/liquidity', requireApiKey, async (_req: Request, res: Response): Promise<void> => {
  try {
    const availableETB = await getLiquidityETB();
    const level = availableETB < 1_000_000 ? 'CRITICAL' :
                  availableETB < 5_000_000 ? 'WARNING'  : 'OK';
    res.json({
      pool: 'settlement_etb', availableETB,
      replenishThresholdETB: REPLENISH_THRESHOLD,
      replenishTargetETB:    REPLENISH_TARGET,
      status: level, autoReplenishEnabled: true,
      persistence: 'firestore',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'LIQUIDITY_READ_FAILED', message: err.message });
  }
});

// ─── GET /api/v1/circuit-breaker/status ──────────────────────────────────────

router.get('/circuit-breaker/status', requireApiKey, (_req: Request, res: Response) => {
  const now = Date.now();
  const status = Object.fromEntries(Object.entries(providers).map(([key, p]) => [key, {
    name: p.name, state: p.open ? 'OPEN' : 'CLOSED', failures: p.failures,
    lastFailureAgo: p.lastFailAt ? `${Math.round((now - p.lastFailAt) / 1000)}s ago` : 'never',
    resetAfterMs: p.resetMs,
  }]));
  res.json({ providers: status, persistence: 'in-memory', timestamp: new Date().toISOString() });
});

// ─── POST /api/v1/circuit-breaker/trip/:provider ─────────────────────────────

router.post('/circuit-breaker/trip/:provider', requireApiKey, (req: Request, res: Response) => {
  const key = req.params.provider.toLowerCase();
  if (!tripProvider(key)) {
    res.status(404).json({ error: 'UNKNOWN_PROVIDER', message: `Unknown provider '${key}'.`, available: Object.keys(providers) });
    return;
  }
  const p = providers[key]!;
  res.json({ provider: key, name: p.name, state: 'OPEN', message: `${p.name} circuit is now OPEN. Remittance calls will route to other providers.`, hint: 'Call POST /api/v1/circuit-breaker/reset to restore.', timestamp: new Date().toISOString() });
});

// ─── POST /api/v1/circuit-breaker/reset ──────────────────────────────────────

router.post('/circuit-breaker/reset', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const doLiquidity = (req.body?.resetLiquidity !== false);
  resetAllProviders();
  if (doLiquidity) await resetLiquidityPool();
  const liq = await getLiquidityETB();
  res.json({
    message:         'Reset complete.',
    providers:       Object.fromEntries(Object.keys(providers).map(k => [k, 'CLOSED'])),
    liquidityReset:  doLiquidity,
    liquidityPoolETB: liq,
    timestamp:       new Date().toISOString(),
  });
});

// ─── POST /api/v1/simulation/reset ───────────────────────────────────────────

router.post('/simulation/reset', requireApiKey, async (_req: Request, res: Response): Promise<void> => {
  try {
    await fullReset();
    res.json({
      message:          'Full simulation reset complete. All Firestore sim_ collections cleared.',
      liquidityPoolETB: REPLENISH_TARGET,
      providers:        Object.fromEntries(Object.keys(providers).map(k => [k, 'CLOSED'])),
      persistence:      'firestore',
      timestamp:        new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[SimAPI] /simulation/reset error:', err.message);
    res.status(500).json({ error: 'RESET_FAILED', message: err.message });
  }
});

export default router;

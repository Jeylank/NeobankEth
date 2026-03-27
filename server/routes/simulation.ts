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
import { readLimiter, writeLimiter, destructiveLimiter } from '../middleware/rateLimiter';
import {
  FX_BASE_RATES, jitter, liveRate,
  QUOTE_TTL_MS, QUOTE_BUFFER_MS,
  DEFAULT_LIQUIDITY, REPLENISH_THRESHOLD, REPLENISH_TARGET,
  providers, selectProvider, tripProvider, resetAllProviders,
  processRemittance, extractIdempotencyKey, checkIdempotency,
  createQuote, getWalletBalances, getLiquidityETB,
  getOrAgeTx, stripeTopUp, fullReset, resetLiquidityPool,
  resumeTransaction, type ResumeAction,
  seedSimulation, SEED_USERS, SEED_BALANCES_PER_CCY,
} from '../services/simulationEngine';
import {
  getProviderLiquidityAll,
  PROVIDER_LIQUIDITY_DEFAULTS,
  drainAllProviderLiquidity,
} from '../services/treasuryRouter';
import {
  evaluateFraud, type FraudContext, FRAUD_COL,
} from '../services/fraudEngine';
import {
  getRiskConfig, updateRiskConfig, resetRiskConfig, DEFAULT_RISK_CONFIG,
  forceInvalidateCache,
} from '../services/riskConfig';
import { getQuoteState } from '../services/quoteStateMachine';
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
      'POST /api/v1/simulation/seed',
      'POST /api/v1/simulation/drain',
      'POST /api/campaigns/:campaignId/contribute',
    ],
  });
});

// ─── POST /api/v1/fx/quote ────────────────────────────────────────────────────

router.post('/fx/quote', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
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
      ttlMs:               QUOTE_TTL_MS,
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

router.get('/fx/quotes', requireApiKey, readLimiter, (req: Request, res: Response) => {
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

router.post('/wallet/topup', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  const { userId, amount, currency = 'EUR' } = req.body as { userId?: unknown; amount?: unknown; currency?: unknown };
  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' }); return; }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' }); return; }
  try {
    const result = await stripeTopUp(userId, amount as number, currency as string);
    res.status(200).json({ ...result, message: 'PaymentIntent created. Use clientSecret to confirm via Stripe.js.' });
  } catch (err: any) {
    // FIX A: Stripe errors get an explicit STRIPE_NETWORK_ERROR code so they are
    // NEVER confused with LIQUIDITY_SHORTAGE or any remittance domain error.
    const isStripeError = err?.type?.startsWith('Stripe') || err?.name?.startsWith('Stripe');
    const errorCode     = isStripeError ? 'STRIPE_NETWORK_ERROR' : 'PAYMENT_PROVIDER_ERROR';
    console.error(`[SimAPI] /wallet/topup ${errorCode}:`, err.message);
    res.status(502).json({
      error:   errorCode,
      message: isStripeError
        ? 'The payment gateway encountered a network error. No funds were debited. Please retry.'
        : (err.message ?? 'Payment provider error.'),
    });
  }
});

// ─── GET /api/v1/wallet/:userId ───────────────────────────────────────────────

router.get('/wallet/:userId', requireApiKey, readLimiter, async (req: Request, res: Response): Promise<void> => {
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

router.post('/remittance/initiate', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  // FIX B: Idempotency check runs FIRST, before any field validation.
  // A duplicate request with a missing/invalid field must still return the
  // cached response (HTTP 200), not a 400 validation error.
  const idempotencyKey = extractIdempotencyKey(req.headers as any, req.body ?? {});
  const cached = await checkIdempotency(idempotencyKey);
  if (cached) { res.status(cached.status).json(cached.payload); return; }

  const { userId, recipientId, amount, currency = 'EUR', quoteId, metadata } = req.body ?? {};
  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' }); return; }
  if (!recipientId || typeof recipientId !== 'string') { res.status(400).json({ error: 'INVALID_RECIPIENT', message: 'recipientId is required.' }); return; }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' }); return; }
  if (!FX_BASE_RATES[(currency as string).toUpperCase()]) { res.status(400).json({ error: 'UNSUPPORTED_CURRENCY', message: `Currency ${currency} is not supported.` }); return; }

  // ── Fraud gate — runs BEFORE any wallet debit ──────────────────────────────
  const fraudCtx: FraudContext = {
    userId, recipientId, amount,
    currency: (currency as string).toUpperCase(),
    type: 'standard',
    deviceId:  req.body?.deviceId  ?? req.headers['x-device-id'] as string | undefined,
    ipAddress: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
               ?? req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    metadata,
  };
  const fraud = await evaluateFraud(fraudCtx);
  if (fraud.decision === 'BLOCK') {
    res.status(403).json({
      error:   'FRAUD_BLOCKED',
      message: 'Transaction blocked by fraud risk controls.',
      score:   fraud.score,
      rules:   fraud.rulesTriggered,
      decisionId: fraud.decisionId,
    });
    return;
  }
  if (fraud.decision === 'REVIEW') {
    res.status(202).json({
      status:   'PENDING_REVIEW',
      message:  'Transaction queued for fraud review. Wallet not debited.',
      score:    fraud.score,
      rules:    fraud.rulesTriggered,
      decisionId: fraud.decisionId,
    });
    return;
  }

  const result = await processRemittance({
    userId, recipientId, amount,
    currency: (currency as string).toUpperCase(),
    type: 'standard', quoteId, metadata, idempotencyKey,
  });
  res.status(result.status).json(result.payload);
});

// ─── POST /api/v1/campaign/contribute ────────────────────────────────────────

router.post('/campaign/contribute', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  // FIX B: Idempotency check before field validation
  const idempotencyKey = extractIdempotencyKey(req.headers as any, req.body ?? {});
  const cached = await checkIdempotency(idempotencyKey);
  if (cached) { res.status(cached.status).json(cached.payload); return; }

  const { userId, campaignId, amount, currency = 'EUR', purpose, quoteId } = req.body ?? {};
  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' }); return; }
  if (!campaignId || typeof campaignId !== 'string') { res.status(400).json({ error: 'INVALID_CAMPAIGN_ID', message: 'campaignId is required.' }); return; }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' }); return; }
  if (!purpose || typeof purpose !== 'string') { res.status(400).json({ error: 'MISSING_PURPOSE', message: 'purpose is required for campaign contributions (AML compliance).' }); return; }

  // ── Fraud gate ──────────────────────────────────────────────────────────────
  const fraudCtx: FraudContext = {
    userId, recipientId: `campaign:${campaignId}`, amount,
    currency: (currency as string).toUpperCase(),
    type: 'campaign_contribution',
    deviceId:  req.body?.deviceId ?? req.headers['x-device-id'] as string | undefined,
    ipAddress: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
               ?? req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  };
  const fraud = await evaluateFraud(fraudCtx);
  if (fraud.decision === 'BLOCK') {
    res.status(403).json({ error: 'FRAUD_BLOCKED', message: 'Contribution blocked by fraud risk controls.', score: fraud.score, rules: fraud.rulesTriggered, decisionId: fraud.decisionId });
    return;
  }
  if (fraud.decision === 'REVIEW') {
    res.status(202).json({ status: 'PENDING_REVIEW', message: 'Contribution queued for fraud review. Wallet not debited.', score: fraud.score, rules: fraud.rulesTriggered, decisionId: fraud.decisionId });
    return;
  }

  const result = await processRemittance({
    userId, recipientId: `campaign:${campaignId}`, amount,
    currency: (currency as string).toUpperCase(), type: 'campaign_contribution',
    quoteId, metadata: { campaignId, purpose, transactionCode: 'DONATION_CHARITY' }, idempotencyKey,
  });
  res.status(result.status).json(result.payload);
});

// ─── POST /api/v1/recurring/process ──────────────────────────────────────────

router.post('/recurring/process', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  // FIX B: Idempotency check before field validation
  const idempotencyKey =
    extractIdempotencyKey(req.headers as any, req.body ?? {}) ??
    (req.body?.scheduleId ? `sched:${req.body.scheduleId}` : null);
  const cached = await checkIdempotency(idempotencyKey);
  if (cached) { res.status(cached.status).json(cached.payload); return; }

  const { userId, scheduleId, recipientId, amount, currency = 'EUR', quoteId } = req.body ?? {};
  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' }); return; }
  if (!scheduleId || typeof scheduleId !== 'string') { res.status(400).json({ error: 'INVALID_SCHEDULE_ID', message: 'scheduleId is required.' }); return; }
  if (!recipientId || typeof recipientId !== 'string') { res.status(400).json({ error: 'INVALID_RECIPIENT', message: 'recipientId is required.' }); return; }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' }); return; }

  // ── Fraud gate ──────────────────────────────────────────────────────────────
  const fraudCtx: FraudContext = {
    userId, recipientId, amount,
    currency: (currency as string).toUpperCase(),
    type: 'recurring_support',
    deviceId:  req.body?.deviceId ?? req.headers['x-device-id'] as string | undefined,
    ipAddress: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
               ?? req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  };
  const fraud = await evaluateFraud(fraudCtx);
  if (fraud.decision === 'BLOCK') {
    res.status(403).json({ error: 'FRAUD_BLOCKED', message: 'Recurring payment blocked by fraud risk controls.', score: fraud.score, rules: fraud.rulesTriggered, decisionId: fraud.decisionId });
    return;
  }
  if (fraud.decision === 'REVIEW') {
    res.status(202).json({ status: 'PENDING_REVIEW', message: 'Recurring payment queued for fraud review. Wallet not debited.', score: fraud.score, rules: fraud.rulesTriggered, decisionId: fraud.decisionId });
    return;
  }

  const result = await processRemittance({
    userId, recipientId, amount,
    currency: (currency as string).toUpperCase(), type: 'recurring_support',
    quoteId, metadata: { scheduleId }, idempotencyKey,
  });
  res.status(result.status).json(result.payload);
});

// ─── GET /api/v1/remittance/:txId ────────────────────────────────────────────

router.get('/remittance/:txId', requireApiKey, readLimiter, async (req: Request, res: Response): Promise<void> => {
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
//
// Returns the global settlement pool status with multi-tier alerting:
//   < 10% of capacity (5M ETB)  → CRITICAL (immediate intervention required)
//   < 20% of capacity (10M ETB) → LOW      (automated replenishment imminent)
//   ≥ 20%                       → OK

const ALERT_LOW_THRESHOLD      = REPLENISH_TARGET * 0.20;  // 10M ETB
const ALERT_CRITICAL_THRESHOLD = REPLENISH_TARGET * 0.10;  // 5M ETB

router.get('/liquidity', requireApiKey, readLimiter, async (_req: Request, res: Response): Promise<void> => {
  try {
    const availableETB     = await getLiquidityETB();
    const providerLiquidity = await getProviderLiquidityAll();

    // Global pool alert level
    const alertLevel =
      availableETB < ALERT_CRITICAL_THRESHOLD ? 'CRITICAL' :
      availableETB < ALERT_LOW_THRESHOLD       ? 'LOW'      : 'OK';

    const alerts: string[] = [];
    if (alertLevel === 'CRITICAL') {
      alerts.push(`CRITICAL: Global pool at ${((availableETB / REPLENISH_TARGET) * 100).toFixed(1)}% capacity (${availableETB.toLocaleString()} ETB). Immediate replenishment required.`);
    } else if (alertLevel === 'LOW') {
      alerts.push(`LOW: Global pool at ${((availableETB / REPLENISH_TARGET) * 100).toFixed(1)}% capacity (${availableETB.toLocaleString()} ETB). Auto-replenishment will trigger at next transaction.`);
    }

    // Per-provider alerts
    const providerAlerts: Record<string, { availableETB: number; alertLevel: string; alerts: string[] }> = {};
    for (const [key, avail] of Object.entries(providerLiquidity)) {
      const cap  = (PROVIDER_LIQUIDITY_DEFAULTS as Record<string, number>)[key] ?? avail;
      const pct  = cap > 0 ? avail / cap : 1;
      const pAlertLevel = pct < 0.10 ? 'CRITICAL' : pct < 0.20 ? 'LOW' : 'OK';
      const pAlerts: string[] = [];
      if (pAlertLevel !== 'OK') {
        pAlerts.push(`${pAlertLevel}: ${key} provider pool at ${(pct * 100).toFixed(1)}% capacity (${avail.toLocaleString()} ETB).`);
        alerts.push(pAlerts[0]);
      }
      providerAlerts[key] = { availableETB: avail, alertLevel: pAlertLevel, alerts: pAlerts };
    }

    res.json({
      pool:                  'settlement_etb',
      availableETB,
      capacityETB:           REPLENISH_TARGET,
      utilizedPct:           parseFloat((((REPLENISH_TARGET - availableETB) / REPLENISH_TARGET) * 100).toFixed(1)),
      alertLevel,
      alerts:                alerts.length ? alerts : undefined,
      replenishThresholdETB: REPLENISH_THRESHOLD,
      replenishTargetETB:    REPLENISH_TARGET,
      autoReplenishEnabled:  true,
      providers:             providerAlerts,
      persistence:           'firestore',
      timestamp:             new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'LIQUIDITY_READ_FAILED', message: err.message });
  }
});

// ─── GET /api/v1/circuit-breaker/status ──────────────────────────────────────

router.get('/circuit-breaker/status', requireApiKey, readLimiter, (_req: Request, res: Response) => {
  const now = Date.now();
  const status = Object.fromEntries(Object.entries(providers).map(([key, p]) => [key, {
    name: p.name, state: p.open ? 'OPEN' : 'CLOSED', failures: p.failures,
    lastFailureAgo: p.lastFailAt ? `${Math.round((now - p.lastFailAt) / 1000)}s ago` : 'never',
    resetAfterMs: p.resetMs,
  }]));
  res.json({ providers: status, persistence: 'in-memory', timestamp: new Date().toISOString() });
});

// ─── POST /api/v1/circuit-breaker/trip/:provider ─────────────────────────────

router.post('/circuit-breaker/trip/:provider', requireApiKey, destructiveLimiter, (req: Request, res: Response) => {
  const key = req.params.provider.toLowerCase();
  if (!tripProvider(key)) {
    res.status(404).json({ error: 'UNKNOWN_PROVIDER', message: `Unknown provider '${key}'.`, available: Object.keys(providers) });
    return;
  }
  const p = providers[key]!;
  res.json({ provider: key, name: p.name, state: 'OPEN', message: `${p.name} circuit is now OPEN. Remittance calls will route to other providers.`, hint: 'Call POST /api/v1/circuit-breaker/reset to restore.', timestamp: new Date().toISOString() });
});

// ─── POST /api/v1/circuit-breaker/reset ──────────────────────────────────────

router.post('/circuit-breaker/reset', requireApiKey, destructiveLimiter, async (req: Request, res: Response): Promise<void> => {
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
//
// Clears all sim_ Firestore collections and resets in-memory circuit breakers.
// Optional body: { seed: true } — immediately pre-funds the default test wallets
// so QA scenarios can run without a separate seed call.

router.post('/simulation/reset', requireApiKey, destructiveLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    await fullReset();
    const shouldSeed = req.body?.seed === true;
    const seedResult = shouldSeed ? await seedSimulation() : undefined;
    res.json({
      message:          'Full simulation reset complete. All Firestore sim_ collections cleared.',
      liquidityPoolETB: REPLENISH_TARGET,
      providers:        Object.fromEntries(Object.keys(providers).map(k => [k, 'CLOSED'])),
      persistence:      'firestore',
      ...(seedResult ? { seed: seedResult } : {}),
      hint:             shouldSeed
        ? `Seeded ${seedResult!.seededUsers.length} wallets: ${seedResult!.seededUsers.join(', ')}`
        : 'Pass { seed: true } to pre-fund test wallets immediately after reset.',
      timestamp:        new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[SimAPI] /simulation/reset error:', err.message);
    res.status(500).json({ error: 'RESET_FAILED', message: err.message });
  }
});

// ─── POST /api/v1/simulation/seed ────────────────────────────────────────────
//
// Pre-funds test wallets so QA scenarios start with known, non-zero balances.
// Idempotent — repeated calls overwrite wallet docs with the specified balances.
//
// Body (all optional):
//   users:    string[]            — user IDs to fund (default: SEED_USERS list)
//   balances: { EUR, USD, GBP }  — per-user balances (default: 50_000 each)
//
// Also tops up the global liquidity pool if it is below REPLENISH_THRESHOLD.

router.post('/simulation/seed', requireApiKey, destructiveLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      users    = SEED_USERS,
      balances = SEED_BALANCES_PER_CCY,
    } = (req.body ?? {}) as {
      users?:    string[];
      balances?: Record<string, number>;
    };

    if (!Array.isArray(users) || users.length === 0) {
      res.status(400).json({ error: 'INVALID_USERS', message: '`users` must be a non-empty array of user ID strings.' });
      return;
    }
    if (typeof balances !== 'object' || Object.keys(balances).length === 0) {
      res.status(400).json({ error: 'INVALID_BALANCES', message: '`balances` must be a non-empty object (e.g. { EUR: 50000, USD: 50000 }).' });
      return;
    }

    const result = await seedSimulation(users, balances);
    res.status(200).json({
      message:  `Seeded ${result.seededUsers.length} test wallet(s) successfully.`,
      ...result,
    });
  } catch (err: any) {
    console.error('[SimAPI] /simulation/seed error:', err.message);
    res.status(500).json({ error: 'SEED_FAILED', message: err.message });
  }
});

// ─── POST /api/v1/simulation/drain ───────────────────────────────────────────
//
// Drains all per-provider liquidity pools to 0 ETB so the next transaction
// exhausts every provider and returns PENDING_LIQUIDITY (202).
//
// Use this as a test setup step for the LIQUIDITY_SHORTAGE scenario:
//   1. POST /api/v1/simulation/drain
//   2. POST /api/v1/remittance/initiate  →  202 PENDING_LIQUIDITY
//   3. POST /api/v1/remittance/resume    →  retry once pools are restored
//
// Restore with POST /api/v1/simulation/reset or POST /api/v1/simulation/reset + { seed: true }.

router.post('/simulation/drain', requireApiKey, destructiveLimiter, async (_req: Request, res: Response): Promise<void> => {
  try {
    const pools = await drainAllProviderLiquidity();
    res.json({
      message:    'All provider liquidity pools drained to 0 ETB. The next remittance call will return PENDING_LIQUIDITY (202).',
      pools,
      hint:       'To restore: POST /api/v1/simulation/reset (full reset) or wait for manual replenishment via the treasury/providers endpoint.',
      timestamp:  new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[SimAPI] /simulation/drain error:', err.message);
    res.status(500).json({ error: 'DRAIN_FAILED', message: err.message });
  }
});

// ─── POST /api/v1/quote/refresh ──────────────────────────────────────────────
//
// Re-fetch the live FX rate for an existing quote. Returns the current state of
// the quote along with a rate comparison. The client uses this to decide whether
// to show the "Rate Changed — Confirm" modal.

router.post('/quote/refresh', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  const { quoteId, sourceCcy = 'EUR' } = req.body ?? {};
  if (!quoteId || typeof quoteId !== 'string') {
    res.status(400).json({ error: 'MISSING_FIELD', message: "'quoteId' is required." });
    return;
  }

  try {
    const quoteDoc = await adminDb.collection('sim_quotes').doc(quoteId).get();
    if (!quoteDoc.exists) {
      res.status(404).json({ error: 'QUOTE_NOT_FOUND', message: `Quote '${quoteId}' not found or already consumed.` });
      return;
    }

    const qd         = quoteDoc.data()!;
    const expiresMs  = (qd.expiresAt as import('firebase-admin').firestore.Timestamp).toMillis();
    const lockedRate = qd.rate as number;
    const state      = getQuoteState(expiresMs);
    const freshRate  = liveRate(sourceCcy as string);
    const delta      = Math.abs(freshRate - lockedRate) / lockedRate;

    res.json({
      quoteId,
      state,
      lockedRate,
      freshRate,
      delta:               parseFloat(delta.toFixed(6)),
      deltaPercent:        `${(delta * 100).toFixed(2)}%`,
      requiresConfirmation: delta > 0.005,
      canAutoAccept:       delta <= 0.005,
      expiresAt:           new Date(expiresMs).toISOString(),
      remainingMs:         Math.max(0, expiresMs - Date.now()),
      timestamp:           new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[SimAPI] /quote/refresh error:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

// ─── POST /api/v1/remittance/resume ──────────────────────────────────────────
//
// Resume a paused transaction.
//
// For PENDING_REQUOTE:
//   { transactionId, action: "confirm_rate" }  → proceed with new rate
//   { transactionId, action: "cancel" }         → cancel the transfer
//
// For PENDING_LIQUIDITY:
//   { transactionId }                           → retry (action defaults to "retry")
//   { transactionId, action: "cancel" }         → cancel the transfer

router.post('/remittance/resume', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  const { transactionId, action = 'retry' } = req.body ?? {};

  if (!transactionId || typeof transactionId !== 'string') {
    res.status(400).json({ error: 'MISSING_FIELD', message: "'transactionId' is required." });
    return;
  }

  const validActions: ResumeAction[] = ['retry', 'confirm_rate', 'cancel'];
  if (!validActions.includes(action as ResumeAction)) {
    res.status(400).json({
      error:          'INVALID_ACTION',
      message:        `'action' must be one of: ${validActions.join(', ')}.`,
      validActions,
    });
    return;
  }

  try {
    const result = await resumeTransaction(transactionId, action as ResumeAction);
    res.status(result.status).json(result.payload);
  } catch (err: any) {
    console.error('[SimAPI] /remittance/resume error:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

// ─── GET /api/v1/treasury/providers ──────────────────────────────────────────
// Per-provider liquidity snapshot (admin-facing).

router.get('/treasury/providers', requireApiKey, readLimiter, async (_req: Request, res: Response): Promise<void> => {
  try {
    const liquidityMap = await getProviderLiquidityAll();
    const snapshot = Object.entries(liquidityMap).map(([key, availableETB]) => ({
      key, availableETB,
    }));
    res.json({ providers: snapshot, timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[SimAPI] /treasury/providers error:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FRAUD ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/v1/fraud/decisions ─────────────────────────────────────────────
// Query recent fraud decisions with optional filters.
// Query params:
//   userId    — filter to a specific user
//   decision  — ALLOW | REVIEW | BLOCK
//   limit     — 1–200 (default 50)
//   since     — ISO timestamp (default: last 24 hours)

router.get('/fraud/decisions', requireApiKey, readLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId    = req.query.userId   as string | undefined;
    const decision  = req.query.decision as string | undefined;
    const limit     = Math.min(200, Math.max(1, parseInt(req.query.limit as string ?? '50', 10) || 50));
    const since     = req.query.since
      ? new Date(req.query.since as string)
      : new Date(Date.now() - 24 * 60 * 60 * 1000); // default: last 24h

    // Single-field queries only (no composite indexes needed).
    // Apply additional filters in-memory.
    let query: FirebaseFirestore.Query = adminDb.collection(FRAUD_COL.decisions);
    if (userId) {
      query = query.where('userId', '==', userId);
    }
    // Fetch extra docs to compensate for in-memory filtering
    const snap = await query.limit(limit * 4).get();

    const sinceMs = since.getTime();
    const docs = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter((d: any) => {
        const ts: number = d.timestamp?.seconds
          ? d.timestamp.seconds * 1000
          : (typeof d.timestamp === 'number' ? d.timestamp : 0);
        if (ts < sinceMs) return false;
        if (decision && d.decision !== decision) return false;
        return true;
      })
      .sort((a: any, b: any) => {
        const ta = a.timestamp?.seconds ?? 0;
        const tb = b.timestamp?.seconds ?? 0;
        return tb - ta; // newest first
      })
      .slice(0, limit)
      .map((d: any) => ({
        decisionId:    d.id,
        userId:        d.userId,
        decision:      d.decision,
        score:         d.score,
        rulesTriggered: d.rulesTriggered ?? [],
        amount:        d.amount,
        currency:      d.currency,
        recipientId:   d.recipientId,
        transactionId: d.transactionId,
        configVersion: d.configVersion,
        timestamp:     d.timestamp?.seconds
          ? new Date(d.timestamp.seconds * 1000).toISOString()
          : null,
      }));

    res.json({
      decisions: docs,
      count:     docs.length,
      filters:   { userId: userId ?? null, decision: decision ?? null, since: since.toISOString(), limit },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[SimAPI] /fraud/decisions error:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

// ─── GET /api/v1/fraud/stats ──────────────────────────────────────────────────
// Aggregate fraud statistics for the specified time window.
// Query params:
//   since  — ISO timestamp (default: last 24 hours)
//   userId — optional scope to one user

router.get('/fraud/stats', requireApiKey, readLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.query.userId as string | undefined;
    const since  = req.query.since
      ? new Date(req.query.since as string)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    let query: FirebaseFirestore.Query = adminDb.collection(FRAUD_COL.decisions);
    if (userId) query = query.where('userId', '==', userId);
    const snap = await query.limit(2000).get(); // cap to avoid runaway reads

    const sinceMs = since.getTime();
    const docs = snap.docs
      .map(d => d.data())
      .filter(d => {
        const ts: number = d.timestamp?.seconds
          ? d.timestamp.seconds * 1000
          : 0;
        return ts >= sinceMs;
      });

    // Aggregate counts
    const counts = { ALLOW: 0, REVIEW: 0, BLOCK: 0 };
    const ruleCounts: Record<string, number> = {};
    const scores: number[] = [];
    const blockedUsers = new Set<string>();
    const reviewedUsers = new Set<string>();

    for (const d of docs) {
      const dec = d.decision as 'ALLOW' | 'REVIEW' | 'BLOCK';
      counts[dec] = (counts[dec] ?? 0) + 1;
      scores.push(d.score ?? 0);
      if (dec === 'BLOCK')  blockedUsers.add(d.userId);
      if (dec === 'REVIEW') reviewedUsers.add(d.userId);
      for (const rule of (d.rulesTriggered ?? [])) {
        ruleCounts[rule] = (ruleCounts[rule] ?? 0) + 1;
      }
    }

    const total = docs.length;
    const avgScore = total > 0
      ? Math.round(scores.reduce((s, n) => s + n, 0) / total * 10) / 10
      : 0;
    const maxScore = total > 0 ? Math.max(...scores) : 0;

    const topRules = Object.entries(ruleCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([rule, count]) => ({ rule, count, pct: Math.round(count / total * 1000) / 10 }));

    res.json({
      window: { since: since.toISOString(), userId: userId ?? 'all' },
      total,
      decisions: {
        allow:  counts.ALLOW,
        review: counts.REVIEW,
        block:  counts.BLOCK,
      },
      rates: {
        blockRate:  total > 0 ? Math.round(counts.BLOCK  / total * 10000) / 100 : 0,
        reviewRate: total > 0 ? Math.round(counts.REVIEW / total * 10000) / 100 : 0,
      },
      scores: { avg: avgScore, max: maxScore },
      topRules,
      uniqueUsers: {
        blocked:  blockedUsers.size,
        reviewed: reviewedUsers.size,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[SimAPI] /fraud/stats error:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// RISK CONFIGURATION TUNING
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/v1/risk/config ──────────────────────────────────────────────────
// Returns the currently active risk configuration including rule weights,
// decision thresholds, and velocity/anomaly limits.

router.get('/risk/config', requireApiKey, readLimiter, async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await getRiskConfig();
    res.json({ config, defaults: DEFAULT_RISK_CONFIG, timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[SimAPI] /risk/config GET error:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

// ─── PATCH /api/v1/risk/config ────────────────────────────────────────────────
// Partially update the live risk configuration.
// Body: { scores?: {...}, thresholds?: {...}, limits?: {...} }
// All fields are optional — only provided fields are changed.
//
// Example — raise the block threshold to 80:
//   PATCH /api/v1/risk/config  { "thresholds": { "block": 80 } }
//
// Example — increase velocity score and shorten the window to 5 minutes:
//   PATCH /api/v1/risk/config  { "scores": { "VELOCITY_SPIKE": 40 }, "limits": { "velocityWindowMs": 300000 } }

router.patch('/risk/config', requireApiKey, destructiveLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { scores, thresholds, limits } = req.body ?? {};
    if (!scores && !thresholds && !limits) {
      res.status(400).json({
        error: 'EMPTY_PATCH',
        message: 'Request body must include at least one of: scores, thresholds, limits.',
        example: { scores: { VELOCITY_SPIKE: 40 }, thresholds: { block: 75 } },
      });
      return;
    }

    // Validate thresholds if provided
    if (thresholds) {
      if (thresholds.block !== undefined && (typeof thresholds.block !== 'number' || thresholds.block < 1)) {
        res.status(400).json({ error: 'INVALID_THRESHOLD', message: 'thresholds.block must be a positive number.' });
        return;
      }
      if (thresholds.review !== undefined && (typeof thresholds.review !== 'number' || thresholds.review < 1)) {
        res.status(400).json({ error: 'INVALID_THRESHOLD', message: 'thresholds.review must be a positive number.' });
        return;
      }
      if (thresholds.block !== undefined && thresholds.review !== undefined && thresholds.block <= thresholds.review) {
        res.status(400).json({ error: 'INVALID_THRESHOLD', message: 'thresholds.block must be greater than thresholds.review.' });
        return;
      }
    }

    const updatedBy = (req.headers['x-updated-by'] as string | undefined) ?? 'api';
    const config = await updateRiskConfig({ scores, thresholds, limits }, updatedBy);
    console.info(`[SimAPI] Risk config patched to v${config.version} by ${updatedBy}.`);
    res.json({ message: 'Risk configuration updated.', config, timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[SimAPI] /risk/config PATCH error:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

// ─── POST /api/v1/risk/config/reset ──────────────────────────────────────────
// Reset risk configuration to factory defaults.

router.post('/risk/config/reset', requireApiKey, destructiveLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const updatedBy = (req.headers['x-updated-by'] as string | undefined) ?? 'api';
    const config = await resetRiskConfig(updatedBy);
    res.json({ message: 'Risk configuration reset to defaults.', config, timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[SimAPI] /risk/config/reset error:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

export default router;

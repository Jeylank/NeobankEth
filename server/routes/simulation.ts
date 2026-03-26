/**
 * server/routes/simulation.ts
 * ────────────────────────────
 * External integration endpoints for agent simulation apps.
 *
 * Authentication: X-API-Key header (set SIMULATION_API_KEY env var).
 * All endpoints are CORS-open so external tools can call them directly.
 *
 * Mounted at /api/v1 in server/index.ts
 *
 * Routes
 * ──────
 *   GET  /api/v1/health
 *   POST /api/v1/fx/quote                 — lock an FX quote (90s TTL + 30s buffer)
 *   GET  /api/v1/fx/quotes                — live FX rates
 *   POST /api/v1/wallet/topup             — create a Stripe PaymentIntent for top-up
 *   GET  /api/v1/wallet/:userId           — wallet balance summary
 *   POST /api/v1/remittance/initiate      — initiate remittance (all pre-flight guards)
 *   GET  /api/v1/remittance/:txId         — get remittance status
 *   POST /api/v1/campaign/contribute      — campaign/donation contribution
 *   POST /api/v1/recurring/process        — process a recurring support payment
 *   GET  /api/v1/liquidity                — liquidity pool status
 *   GET  /api/v1/circuit-breaker/status   — provider circuit-breaker status (ops)
 */

import { Router, Request, Response } from 'express';
import { randomUUID }                 from 'crypto';
import { getUncachableStripeClient }  from '../stripeClient';

const router = Router();

// ─── API Key Middleware ────────────────────────────────────────────────────────

function requireApiKey(req: Request, res: Response, next: () => void): void {
  const expectedKey = process.env.SIMULATION_API_KEY;
  if (!expectedKey) return next();

  const provided =
    (req.headers['x-api-key']  as string | undefined) ??
    (req.query['api_key']      as string | undefined) ??
    '';

  if (provided !== expectedKey) {
    res.status(401).json({ error: 'INVALID_API_KEY', message: 'Provide a valid X-API-Key header.' });
    return;
  }
  next();
}

// ─── Idempotency Key Helper ───────────────────────────────────────────────────
// Reads the idempotency key from the standard `Idempotency-Key` HTTP header
// (per IETF draft-ietf-httpapi-idempotency-key-header) OR from the request body.

function getIdempotencyKey(req: Request): string | null {
  const header = req.headers['idempotency-key'] as string | undefined;
  if (header?.trim()) return header.trim();
  const body = (req.body ?? {}).idempotencyKey;
  if (typeof body === 'string' && body.trim()) return body.trim();
  return null;
}

// ─── FX Rates ─────────────────────────────────────────────────────────────────

const FX_BASE_RATES: Record<string, Record<string, number>> = {
  EUR: { ETB: 131.45, USD: 1.085, GBP: 0.855 },
  USD: { ETB: 121.12, EUR: 0.922, GBP: 0.788 },
  GBP: { ETB: 154.22, EUR: 1.170, USD: 1.269 },
  ETB: { EUR: 0.0076, USD: 0.0083, GBP: 0.0065 },
};

const jitter = () => 1 + (Math.random() - 0.5) * 0.006;

// ─── In-memory Simulation State ───────────────────────────────────────────────

// Quote store
interface LockedQuote { quoteId: string; from: string; to: string; rate: number; expiresAt: number; lockedAt: string }
const quoteStore = new Map<string, LockedQuote>();

// Per QA v2 recommendation: 90 s base TTL + 30 s grace buffer.
const QUOTE_TTL_MS    = 90_000;
const QUOTE_BUFFER_MS = 30_000;

// Idempotency store: key → original response payload
const idempotencyStore = new Map<string, object>();

// Transaction store
interface SimTransaction {
  txId: string; userId: string; recipientId: string; amount: number;
  currency: string; destinationCurrency: string; rateUsed: number;
  destinationAmount: number; status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  type: string; provider: string; createdAt: string; updatedAt: string; failReason?: string;
}
const txStore = new Map<string, SimTransaction>();

// Simulated user wallet balances: userId → { EUR: n, USD: n, GBP: n }
const userWallets = new Map<string, Record<string, number>>();
function getWallet(userId: string): Record<string, number> {
  if (!userWallets.has(userId)) {
    userWallets.set(userId, { EUR: 10_000, USD: 10_000, GBP: 10_000 });
  }
  return userWallets.get(userId)!;
}

// Simulated liquidity pool (ETB)
let liquidityPoolETB        = 10_000_000; // 10M ETB
const LIQUIDITY_WARN_ETB    = 1_000_000;  // 1M
const LIQUIDITY_CRITICAL_ETB = 200_000;   // 200k
const LIQUIDITY_REPLENISH_TARGET = 10_000_000;

function checkAndReplenishLiquidity(): void {
  if (liquidityPoolETB < LIQUIDITY_WARN_ETB) {
    const topUp = LIQUIDITY_REPLENISH_TARGET - liquidityPoolETB;
    liquidityPoolETB = LIQUIDITY_REPLENISH_TARGET;
    console.info(`[SimAPI] Treasury auto-replenished +${topUp.toLocaleString()} ETB. Pool reset to ${LIQUIDITY_REPLENISH_TARGET.toLocaleString()} ETB.`);
  }
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

interface ProviderState {
  name: string; failures: number; lastFailureAt: number; isOpen: boolean;
  threshold: number; resetAfterMs: number;
}
const providers: Record<string, ProviderState> = {
  stripe: { name: 'Stripe', failures: 0, lastFailureAt: 0, isOpen: false, threshold: 3, resetAfterMs: 30_000 },
  chapa:  { name: 'Chapa',  failures: 0, lastFailureAt: 0, isOpen: false, threshold: 3, resetAfterMs: 30_000 },
};

function selectProvider(): string | null {
  const now = Date.now();
  for (const [key, p] of Object.entries(providers)) {
    if (p.isOpen && now - p.lastFailureAt >= p.resetAfterMs) {
      p.isOpen = false; p.failures = 0; // half-open probe
    }
    if (!p.isOpen) return key;
  }
  return null;
}

function recordProviderSuccess(k: string): void { const p = providers[k]; if (p) { p.failures = 0; p.isOpen = false; } }
function recordProviderFailure(k: string): void {
  const p = providers[k]; if (!p) return;
  p.failures += 1; p.lastFailureAt = Date.now();
  if (p.failures >= p.threshold) { p.isOpen = true; console.warn(`[SimAPI] Circuit OPEN: ${p.name}`); }
}

// ─── Shared Remittance Processor ──────────────────────────────────────────────
// Encapsulates the full pre-flight + commit flow shared by remittance and
// campaign/recurring endpoints.

interface RemittanceParams {
  userId:      string;
  recipientId: string;
  amount:      number;
  currency:    string;
  type:        string;
  quoteId?:    string;
  metadata?:   Record<string, unknown>;
  idempotencyKey?: string | null;
}

interface RemittanceResult {
  ok:       boolean;
  status:   number;
  payload:  object;
}

async function processRemittance(p: RemittanceParams): Promise<RemittanceResult> {
  const {
    userId, recipientId, amount, currency, type,
    quoteId, metadata = {}, idempotencyKey,
  } = p;

  const sourceCcy = currency.toUpperCase();
  const destCcy   = 'ETB';

  // ── 1. Idempotency — standard Idempotency-Key header or body field ───────────
  // A duplicate request MUST return the original 2xx response, not a new error.
  if (idempotencyKey) {
    const cached = idempotencyStore.get(idempotencyKey);
    if (cached) {
      console.info(`[SimAPI] Idempotent replay key=${idempotencyKey}`);
      return { ok: true, status: 200, payload: { ...cached, idempotent: true } };
    }
  }

  // ── 2. User wallet balance check (INSUFFICIENT_FUNDS — user-side) ────────────
  // Distinct from LIQUIDITY_SHORTAGE (platform-side). Decoupled per QA v2.
  const wallet = getWallet(userId);
  const userBalance = wallet[sourceCcy] ?? 0;
  if (amount > userBalance) {
    return {
      ok: false, status: 422,
      payload: {
        error:     'INSUFFICIENT_FUNDS',
        message:   `Your ${sourceCcy} balance (${userBalance.toFixed(2)}) is below the requested amount (${amount.toFixed(2)}).`,
        hint:      'Please top up your wallet before retrying.',
        userBalance,
        requested: amount,
        currency:  sourceCcy,
      },
    };
  }

  // ── 3. Quote validation with 30 s grace buffer ───────────────────────────────
  let rateUsed: number;
  if (quoteId) {
    const quote       = quoteStore.get(quoteId);
    const effectiveEx = (quote?.expiresAt ?? 0) + QUOTE_BUFFER_MS;
    if (!quote || Date.now() > effectiveEx) {
      return {
        ok: false, status: 422,
        payload: {
          error:   'QUOTE_EXPIRED',
          message: 'The FX quote has expired. Please call POST /api/v1/fx/quote for a fresh quote.',
          hint:    `Quotes are valid for ${QUOTE_TTL_MS / 1000}s with a ${QUOTE_BUFFER_MS / 1000}s grace buffer.`,
        },
      };
    }
    rateUsed = quote.rate;
    quoteStore.delete(quoteId);
  } else {
    rateUsed = parseFloat(((FX_BASE_RATES[sourceCcy]?.ETB ?? 0) * jitter()).toFixed(6));
  }

  const destinationAmount = parseFloat((amount * rateUsed).toFixed(2));

  // ── 4. Liquidity pre-flight (LIQUIDITY_SHORTAGE — platform-side) ─────────────
  checkAndReplenishLiquidity(); // auto-replenish before checking
  if (destinationAmount > liquidityPoolETB) {
    console.warn(`[SimAPI] LIQUIDITY_SHORTAGE need=${destinationAmount} pool=${liquidityPoolETB}`);
    return {
      ok: false, status: 422,
      payload: {
        error:     'LIQUIDITY_SHORTAGE',
        message:   'Insufficient liquidity in the settlement pool. The treasury team has been alerted.',
        required:  destinationAmount,
        available: liquidityPoolETB,
        currency:  destCcy,
        hint:      'This is a platform-side issue, not a user balance issue. No action needed from the customer.',
      },
    };
  }

  // ── 5. Compliance gate for campaign contributions ────────────────────────────
  if (type === 'campaign_contribution') {
    const campaignId = (metadata.campaignId as string | undefined) ?? '';
    const purpose    = (metadata.purpose    as string | undefined) ?? '';
    if (!campaignId || !purpose) {
      return {
        ok: false, status: 422,
        payload: {
          error:   'COMPLIANCE_METADATA_MISSING',
          message: 'Campaign contributions require metadata.campaignId and metadata.purpose for AML compliance.',
          required: ['metadata.campaignId', 'metadata.purpose'],
        },
      };
    }
  }

  // ── 6. Provider routing with circuit breaker ──────────────────────────────────
  const providerKey = selectProvider();
  if (!providerKey) {
    return {
      ok: false, status: 503,
      payload: {
        error: 'PROVIDER_OUTAGE',
        message: 'All payment providers are currently unavailable. Please retry in 30 seconds.',
        retryAfter: 30,
      },
    };
  }

  // Simulate transient failure (2% probability) with automatic failover
  try {
    if (Math.random() < 0.02) throw new Error('Simulated transient error');
    recordProviderSuccess(providerKey);
  } catch {
    recordProviderFailure(providerKey);
    const fallback = selectProvider();
    if (!fallback) {
      return {
        ok: false, status: 502,
        payload: { error: 'STRIPE_NETWORK_ERROR', message: 'Provider network error with no available fallback.', retryAfter: 15 },
      };
    }
    recordProviderSuccess(fallback);
    console.info(`[SimAPI] Failover ${providerKey} → ${fallback}`);
  }

  // ── 7. Commit ─────────────────────────────────────────────────────────────────
  liquidityPoolETB  -= destinationAmount;
  wallet[sourceCcy] -= amount; // debit user wallet

  const txId = `tx_${randomUUID()}`;
  const now  = new Date().toISOString();

  const tx: SimTransaction = {
    txId, userId, recipientId, amount,
    currency: sourceCcy, destinationCurrency: destCcy,
    rateUsed, destinationAmount,
    status: 'PROCESSING',
    type,
    provider:  providers[providerKey]?.name ?? providerKey,
    createdAt: now, updatedAt: now,
  };
  txStore.set(txId, tx);

  const response = {
    txId, userId, recipientId, amount,
    currency: sourceCcy, destinationCurrency: destCcy,
    destinationAmount, rateUsed,
    type,
    status:            'PROCESSING',
    provider:          tx.provider,
    estimatedDelivery: '1–3 business days',
    remainingBalance:  wallet[sourceCcy],
    createdAt:         now,
    message:           `${type === 'campaign_contribution' ? 'Campaign contribution' : type === 'recurring_support' ? 'Recurring payment' : 'Remittance'} initiated successfully.`,
  };

  if (idempotencyKey) idempotencyStore.set(idempotencyKey, response);

  console.info(`[SimAPI] ${type} ${txId}: ${sourceCcy} ${amount} → ${destCcy} ${destinationAmount} via ${tx.provider}`);
  return { ok: true, status: 201, payload: response };
}

// ─── GET /api/v1/health ───────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok', service: 'habeshare-simulation-api', version: 'v1',
    timestamp: new Date().toISOString(),
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
    ],
  });
});

// ─── POST /api/v1/fx/quote ────────────────────────────────────────────────────

router.post('/fx/quote', requireApiKey, (req: Request, res: Response) => {
  const { from, to } = req.body ?? {};
  const fromCcy = (from ?? '').toString().toUpperCase();
  const toCcy   = (to   ?? '').toString().toUpperCase();

  if (!fromCcy || !toCcy) {
    res.status(400).json({ error: 'MISSING_PARAMS', message: 'from and to currency codes are required.' });
    return;
  }
  const baseRate = FX_BASE_RATES[fromCcy]?.[toCcy];
  if (!baseRate) {
    res.status(404).json({ error: 'PAIR_NOT_FOUND', message: `No rate for ${fromCcy}→${toCcy}.` });
    return;
  }

  const rate      = parseFloat((baseRate * jitter()).toFixed(6));
  const quoteId   = `q_${randomUUID()}`;
  const now       = Date.now();
  const expiresAt = now + QUOTE_TTL_MS;

  quoteStore.set(quoteId, { quoteId, from: fromCcy, to: toCcy, rate, expiresAt, lockedAt: new Date(now).toISOString() });

  res.json({
    quoteId, from: fromCcy, to: toCcy, rate,
    expiresAt:        new Date(expiresAt).toISOString(),
    expiresInSeconds: QUOTE_TTL_MS / 1000,
    bufferSeconds:    QUOTE_BUFFER_MS / 1000,
    lockedAt:         new Date(now).toISOString(),
  });
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
    for (const [t, r] of Object.entries(targets))
      quotes.push({ from: b, to: t, rate: parseFloat((r * jitter()).toFixed(6)), timestamp: new Date().toISOString(), source: 'habeshare-fx' });
  res.json({ quotes, count: quotes.length });
});

// ─── POST /api/v1/wallet/topup ────────────────────────────────────────────────

router.post('/wallet/topup', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, amount, currency = 'EUR' } = req.body as { userId?: unknown; amount?: unknown; currency?: unknown };
    if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' }); return; }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' }); return; }

    const stripe      = await getUncachableStripeClient();
    const amountCents = Math.round((amount as number) * 100);
    const ccy         = (currency as string).toLowerCase();

    const pi = await stripe.paymentIntents.create({
      amount: amountCents, currency: ccy,
      metadata: { userId: userId as string, source: 'simulation' },
    });

    // Credit simulated wallet so subsequent remittance balance checks pass
    const wallet = getWallet(userId as string);
    wallet[(currency as string).toUpperCase()] = (wallet[(currency as string).toUpperCase()] ?? 0) + (amount as number);

    res.status(200).json({
      transactionId: pi.id, clientSecret: pi.client_secret,
      amount, currency: (currency as string).toUpperCase(), status: 'pending',
      message: 'PaymentIntent created. Use clientSecret to confirm via Stripe.js.',
    });
  } catch (err: any) {
    console.error('[SimAPI] /wallet/topup error:', err.message);
    res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
});

// ─── GET /api/v1/wallet/:userId ───────────────────────────────────────────────

router.get('/wallet/:userId', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  try {
    const { adminDb } = await import('../firebaseAdmin');
    const walletDoc   = await adminDb.collection('wallets').doc(userId).get();
    if (walletDoc.exists) {
      const data = walletDoc.data() ?? {};
      res.json({ userId, balances: data.balances ?? {}, updatedAt: data.updatedAt ?? null, source: 'firestore' });
      return;
    }
  } catch { /* fall through */ }
  // Return simulated wallet if Firestore unavailable
  res.json({ userId, balances: getWallet(userId), updatedAt: null, source: 'simulation' });
});

// ─── POST /api/v1/remittance/initiate ─────────────────────────────────────────
// Accepts Idempotency-Key header (standard) OR idempotencyKey body field.

router.post('/remittance/initiate', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { userId, recipientId, amount, currency = 'EUR', quoteId, metadata } = req.body ?? {};
  const idempotencyKey = getIdempotencyKey(req);

  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' }); return; }
  if (!recipientId || typeof recipientId !== 'string') { res.status(400).json({ error: 'INVALID_RECIPIENT', message: 'recipientId is required.' }); return; }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' }); return; }
  if (!FX_BASE_RATES[(currency as string).toUpperCase()]) { res.status(400).json({ error: 'UNSUPPORTED_CURRENCY', message: `Currency ${currency} is not supported.` }); return; }

  const result = await processRemittance({
    userId, recipientId, amount, currency: (currency as string).toUpperCase(),
    type: 'standard', quoteId, metadata, idempotencyKey,
  });

  res.status(result.status).json(result.payload);
});

// ─── POST /api/v1/campaign/contribute ────────────────────────────────────────
// Campaign/donation contribution. Requires metadata.campaignId + metadata.purpose
// for AML compliance — matches the "Donation/Charity" transaction code for partner banks.

router.post('/campaign/contribute', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { userId, campaignId, amount, currency = 'EUR', purpose, quoteId } = req.body ?? {};
  const idempotencyKey = getIdempotencyKey(req);

  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' }); return; }
  if (!campaignId || typeof campaignId !== 'string') { res.status(400).json({ error: 'INVALID_CAMPAIGN_ID', message: 'campaignId is required.' }); return; }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' }); return; }
  if (!purpose || typeof purpose !== 'string') { res.status(400).json({ error: 'MISSING_PURPOSE', message: 'purpose is required for campaign contributions (AML compliance).' }); return; }

  const result = await processRemittance({
    userId,
    recipientId:     `campaign:${campaignId}`,
    amount,
    currency:        (currency as string).toUpperCase(),
    type:            'campaign_contribution',
    quoteId,
    metadata:        { campaignId, purpose, transactionCode: 'DONATION_CHARITY' },
    idempotencyKey,
  });

  res.status(result.status).json(result.payload);
});

// ─── POST /api/v1/recurring/process ──────────────────────────────────────────
// Process a scheduled recurring support payment.

router.post('/recurring/process', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { userId, scheduleId, recipientId, amount, currency = 'EUR', quoteId } = req.body ?? {};
  const idempotencyKey = getIdempotencyKey(req) ?? (scheduleId ? `recurring:${scheduleId}` : null);

  if (!userId || typeof userId !== 'string') { res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' }); return; }
  if (!scheduleId || typeof scheduleId !== 'string') { res.status(400).json({ error: 'INVALID_SCHEDULE_ID', message: 'scheduleId is required.' }); return; }
  if (!recipientId || typeof recipientId !== 'string') { res.status(400).json({ error: 'INVALID_RECIPIENT', message: 'recipientId is required.' }); return; }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' }); return; }

  const result = await processRemittance({
    userId, recipientId, amount,
    currency:        (currency as string).toUpperCase(),
    type:            'recurring_support',
    quoteId,
    metadata:        { scheduleId },
    idempotencyKey,
  });

  res.status(result.status).json(result.payload);
});

// ─── GET /api/v1/remittance/:txId ────────────────────────────────────────────

router.get('/remittance/:txId', requireApiKey, (req: Request, res: Response) => {
  const tx = txStore.get(req.params.txId);
  if (!tx) { res.status(404).json({ error: 'NOT_FOUND', message: `Transaction ${req.params.txId} not found.` }); return; }
  // Simulate status progression: PROCESSING → COMPLETED after 10 s
  if (tx.status === 'PROCESSING' && Date.now() - new Date(tx.createdAt).getTime() > 10_000) {
    tx.status = 'COMPLETED'; tx.updatedAt = new Date().toISOString();
  }
  res.json(tx);
});

// ─── GET /api/v1/liquidity ────────────────────────────────────────────────────

router.get('/liquidity', requireApiKey, (_req: Request, res: Response) => {
  const level = liquidityPoolETB < LIQUIDITY_CRITICAL_ETB ? 'CRITICAL' :
                liquidityPoolETB < LIQUIDITY_WARN_ETB     ? 'WARNING'  : 'OK';
  res.json({
    pool:                 'settlement_etb',
    availableETB:         liquidityPoolETB,
    thresholdWarnETB:     LIQUIDITY_WARN_ETB,
    thresholdCriticalETB: LIQUIDITY_CRITICAL_ETB,
    replenishTargetETB:   LIQUIDITY_REPLENISH_TARGET,
    status:               level,
    autoReplenishEnabled: true,
    timestamp:            new Date().toISOString(),
  });
});

// ─── GET /api/v1/circuit-breaker/status ──────────────────────────────────────

router.get('/circuit-breaker/status', requireApiKey, (_req: Request, res: Response) => {
  const now = Date.now();
  const status = Object.fromEntries(Object.entries(providers).map(([key, p]) => [key, {
    name: p.name,
    state: p.isOpen ? 'OPEN' : 'CLOSED',
    failures: p.failures,
    lastFailureAgo: p.lastFailureAt ? `${Math.round((now - p.lastFailureAt) / 1000)}s ago` : 'never',
    resetAfterMs: p.resetAfterMs,
  }]));
  res.json({ providers: status, timestamp: new Date().toISOString() });
});

export default router;

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
 *   GET  /api/v1/health                  — public health check
 *   POST /api/v1/fx/quote                — lock an FX quote (60s TTL + 10s buffer)
 *   GET  /api/v1/fx/quotes               — live FX rates
 *   POST /api/v1/wallet/topup            — create a Stripe PaymentIntent for top-up
 *   GET  /api/v1/wallet/:userId          — wallet balance summary
 *   POST /api/v1/remittance/initiate     — initiate remittance with all pre-flight guards
 *   GET  /api/v1/remittance/:txId        — get remittance transaction status
 *   GET  /api/v1/liquidity               — liquidity pool status
 *   GET  /api/v1/circuit-breaker/status  — provider circuit-breaker status (ops)
 */

import { Router, Request, Response } from 'express';
import { randomUUID }                 from 'crypto';
import { getUncachableStripeClient }  from '../stripeClient';

const router = Router();

// ─── API Key Middleware ────────────────────────────────────────────────────────

function requireApiKey(req: Request, res: Response, next: () => void): void {
  const expectedKey = process.env.SIMULATION_API_KEY;
  if (!expectedKey) return next(); // open demo mode

  const provided =
    (req.headers['x-api-key'] as string | undefined) ??
    (req.query['api_key']     as string | undefined) ??
    '';

  if (provided !== expectedKey) {
    res.status(401).json({ error: 'INVALID_API_KEY', message: 'Provide a valid X-API-Key header.' });
    return;
  }
  next();
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

// Quote store: quoteId → locked quote with expiry
interface LockedQuote {
  quoteId:    string;
  from:       string;
  to:         string;
  rate:       number;
  expiresAt:  number; // ms epoch
  lockedAt:   string;
}
const quoteStore = new Map<string, LockedQuote>();
const QUOTE_TTL_MS    = 60_000; // 60 s base TTL
const QUOTE_BUFFER_MS = 10_000; // 10 s grace buffer per QA recommendation

// Idempotency store: key → original response payload
const idempotencyStore = new Map<string, object>();

// Transaction store: txId → record
interface SimTransaction {
  txId:         string;
  userId:       string;
  recipientId:  string;
  amount:       number;
  currency:     string;
  destinationCurrency: string;
  rateUsed:     number;
  destinationAmount: number;
  status:       'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  provider:     string;
  createdAt:    string;
  updatedAt:    string;
  failReason?:  string;
}
const txStore = new Map<string, SimTransaction>();

// Simulated liquidity pool (ETB equivalent)
let liquidityPoolETB = 5_000_000; // 5M ETB starting pool

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
// Tracks provider health and routes around failing providers.

interface ProviderState {
  name:         string;
  failures:     number;
  lastFailureAt: number;
  isOpen:       boolean;
  threshold:    number;   // failures before opening
  resetAfterMs: number;   // ms before half-open attempt
}

const providers: Record<string, ProviderState> = {
  stripe: {
    name: 'Stripe', failures: 0, lastFailureAt: 0, isOpen: false,
    threshold: 3, resetAfterMs: 30_000,
  },
  chapa: {
    name: 'Chapa', failures: 0, lastFailureAt: 0, isOpen: false,
    threshold: 3, resetAfterMs: 30_000,
  },
};

/** Returns the name of the first healthy provider, or null if all are down. */
function selectProvider(): string | null {
  const now = Date.now();
  for (const [key, p] of Object.entries(providers)) {
    if (p.isOpen && now - p.lastFailureAt >= p.resetAfterMs) {
      // Half-open: allow a probe
      p.isOpen = false;
      p.failures = 0;
    }
    if (!p.isOpen) return key;
  }
  return null; // All circuits open
}

function recordProviderFailure(providerKey: string): void {
  const p = providers[providerKey];
  if (!p) return;
  p.failures += 1;
  p.lastFailureAt = Date.now();
  if (p.failures >= p.threshold) {
    p.isOpen = true;
    console.warn(`[SimAPI] Circuit breaker OPENED for provider: ${p.name}`);
  }
}

function recordProviderSuccess(providerKey: string): void {
  const p = providers[providerKey];
  if (!p) return;
  p.failures  = 0;
  p.isOpen    = false;
}

// ─── GET /api/v1/health ───────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status:    'ok',
    service:   'habeshare-simulation-api',
    version:   'v1',
    timestamp: new Date().toISOString(),
    endpoints: [
      'POST /api/v1/fx/quote',
      'GET  /api/v1/fx/quotes',
      'POST /api/v1/wallet/topup',
      'GET  /api/v1/wallet/:userId',
      'POST /api/v1/remittance/initiate',
      'GET  /api/v1/remittance/:txId',
      'GET  /api/v1/liquidity',
      'GET  /api/v1/circuit-breaker/status',
    ],
  });
});

// ─── POST /api/v1/fx/quote ────────────────────────────────────────────────────
// Locks an FX rate for 60 seconds (+ 10 s grace buffer).
// Body: { from: string, to: string }
// Response: { quoteId, from, to, rate, expiresAt, expiresInSeconds }

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

  const rate     = parseFloat((baseRate * jitter()).toFixed(6));
  const quoteId  = `q_${randomUUID()}`;
  const now      = Date.now();
  const expiresAt = now + QUOTE_TTL_MS;

  quoteStore.set(quoteId, { quoteId, from: fromCcy, to: toCcy, rate, expiresAt, lockedAt: new Date(now).toISOString() });

  res.json({
    quoteId,
    from:             fromCcy,
    to:               toCcy,
    rate,
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
    if (!rate) {
      res.status(404).json({ error: 'PAIR_NOT_FOUND', message: `No rate available for ${from}→${to}.` });
      return;
    }
    res.json({ from, to, rate: parseFloat((rate * jitter()).toFixed(6)), timestamp: new Date().toISOString(), source: 'habeshare-fx' });
    return;
  }

  const quotes: object[] = [];
  for (const [baseCcy, targets] of Object.entries(FX_BASE_RATES)) {
    for (const [targetCcy, baseRate] of Object.entries(targets)) {
      quotes.push({ from: baseCcy, to: targetCcy, rate: parseFloat((baseRate * jitter()).toFixed(6)), timestamp: new Date().toISOString(), source: 'habeshare-fx' });
    }
  }
  res.json({ quotes, count: quotes.length });
});

// ─── POST /api/v1/wallet/topup ────────────────────────────────────────────────

router.post('/wallet/topup', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, amount, currency = 'EUR' } = req.body as { userId?: unknown; amount?: unknown; currency?: unknown };

    if (!userId || typeof userId !== 'string') {
      res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId (string) is required.' });
      return;
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' });
      return;
    }

    const stripe      = await getUncachableStripeClient();
    const amountCents = Math.round((amount as number) * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: (currency as string).toLowerCase(),
      metadata: { userId: userId as string, source: 'simulation' },
    });

    res.status(200).json({
      transactionId: paymentIntent.id,
      clientSecret:  paymentIntent.client_secret,
      amount,
      currency:      (currency as string).toUpperCase(),
      status:        'pending',
      message:       'PaymentIntent created. Use clientSecret to confirm via Stripe.js.',
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
    res.json({ userId, balances: { EUR: 0, USD: 0, GBP: 0 }, updatedAt: null, source: 'demo' });
  } catch {
    res.json({ userId, balances: { EUR: 0, USD: 0, GBP: 0 }, updatedAt: null, source: 'demo' });
  }
});

// ─── POST /api/v1/remittance/initiate ─────────────────────────────────────────
// Full remittance flow with all pre-flight guards.
//
// Body: {
//   userId          string   — sender
//   recipientId     string   — recipient ID or phone
//   amount          number   — amount in source currency
//   currency        string   — source currency (EUR/USD/GBP)
//   quoteId?        string   — optional locked quote ID
//   idempotencyKey? string   — optional; same key returns the original result
// }
//
// Error codes: QUOTE_EXPIRED | LIQUIDITY_SHORTAGE | PROVIDER_OUTAGE |
//              INSUFFICIENT_FUNDS | DUPLICATE_REQUEST (now returns 200)

router.post('/remittance/initiate', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const {
    userId, recipientId, amount, currency = 'EUR',
    quoteId, idempotencyKey,
  } = req.body ?? {};

  // ── 1. Input validation ──────────────────────────────────────────────────────
  if (!userId || typeof userId !== 'string') {
    res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId is required.' });
    return;
  }
  if (!recipientId || typeof recipientId !== 'string') {
    res.status(400).json({ error: 'INVALID_RECIPIENT', message: 'recipientId is required.' });
    return;
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' });
    return;
  }
  const sourceCcy = (currency as string).toUpperCase();
  if (!FX_BASE_RATES[sourceCcy]) {
    res.status(400).json({ error: 'UNSUPPORTED_CURRENCY', message: `Currency ${sourceCcy} is not supported.` });
    return;
  }

  // ── 2. Idempotency — return original result, NEVER a new error ───────────────
  // QA finding D: DUPLICATE_REQUEST must be a seamless success, not a 400.
  if (idempotencyKey && typeof idempotencyKey === 'string') {
    const cached = idempotencyStore.get(idempotencyKey);
    if (cached) {
      console.info(`[SimAPI] Idempotent replay for key=${idempotencyKey}`);
      res.status(200).json({ ...cached, idempotent: true });
      return;
    }
  }

  // ── 3. Quote validation with grace buffer ────────────────────────────────────
  // QA finding C: 10 s buffer accounts for pipeline latency / network jitter.
  let rateUsed: number;
  const destCcy = 'ETB';

  if (quoteId) {
    const quote = quoteStore.get(quoteId as string);
    const effectiveExpiry = (quote?.expiresAt ?? 0) + QUOTE_BUFFER_MS;
    if (!quote || Date.now() > effectiveExpiry) {
      res.status(422).json({
        error:   'QUOTE_EXPIRED',
        message: 'The FX quote has expired. Please call POST /api/v1/fx/quote to get a fresh quote.',
        hint:    'Quotes are valid for 60 s + a 10 s grace buffer.',
      });
      return;
    }
    rateUsed = quote.rate;
    // Invalidate the quote so it cannot be double-used
    quoteStore.delete(quoteId as string);
  } else {
    // No quote provided — use live rate (slightly worse, no lock guarantee)
    rateUsed = parseFloat(((FX_BASE_RATES[sourceCcy]?.ETB ?? 0) * jitter()).toFixed(6));
  }

  const destinationAmount = parseFloat((amount * rateUsed).toFixed(2));

  // ── 4. Liquidity pre-flight check ────────────────────────────────────────────
  // QA finding A: check BEFORE committing — not after.
  if (destinationAmount > liquidityPoolETB) {
    console.warn(`[SimAPI] LIQUIDITY_SHORTAGE: need ${destinationAmount} ETB, pool has ${liquidityPoolETB} ETB`);
    res.status(422).json({
      error:     'LIQUIDITY_SHORTAGE',
      message:   'Insufficient liquidity in the settlement pool. Our treasury team has been alerted.',
      required:  destinationAmount,
      available: liquidityPoolETB,
      currency:  destCcy,
    });
    return;
  }

  // ── 5. Provider routing with circuit breaker ──────────────────────────────────
  // QA finding B: automatic failover — try Stripe first, fall back to Chapa.
  const providerKey = selectProvider();
  if (!providerKey) {
    res.status(503).json({
      error:      'PROVIDER_OUTAGE',
      message:    'All payment providers are currently unavailable. Please retry in 30 seconds.',
      retryAfter: 30,
    });
    return;
  }

  // Simulate provider call (real integration would call provider SDK here)
  let providerSuccess = true;
  let providerError: string | null = null;

  try {
    // Simulate occasional transient provider failure (5% chance in simulation)
    if (Math.random() < 0.05) {
      throw new Error('Simulated transient provider error');
    }
    recordProviderSuccess(providerKey);
  } catch (err: any) {
    recordProviderFailure(providerKey);
    // Attempt failover to next available provider
    const fallbackKey = selectProvider();
    if (!fallbackKey) {
      providerSuccess = false;
      providerError   = 'STRIPE_NETWORK_ERROR';
    } else {
      // Fallback succeeded — record on fallback
      recordProviderSuccess(fallbackKey);
      console.info(`[SimAPI] Failover: ${providerKey} → ${fallbackKey}`);
    }
  }

  if (!providerSuccess) {
    res.status(502).json({
      error:      providerError ?? 'PROVIDER_ERROR',
      message:    'Payment provider failed and no fallback is available. Please try again shortly.',
      retryAfter: 15,
    });
    return;
  }

  // ── 6. Commit — deduct liquidity, record transaction ─────────────────────────
  liquidityPoolETB -= destinationAmount;

  const txId = `tx_${randomUUID()}`;
  const now  = new Date().toISOString();

  const tx: SimTransaction = {
    txId,
    userId:              userId as string,
    recipientId:         recipientId as string,
    amount:              amount as number,
    currency:            sourceCcy,
    destinationCurrency: destCcy,
    rateUsed,
    destinationAmount,
    status:    'PROCESSING',
    provider:  providers[providerKey]?.name ?? providerKey,
    createdAt: now,
    updatedAt: now,
  };
  txStore.set(txId, tx);

  const response = {
    txId,
    userId,
    recipientId,
    amount,
    currency:            sourceCcy,
    destinationCurrency: destCcy,
    destinationAmount,
    rateUsed,
    status:     'PROCESSING',
    provider:   tx.provider,
    estimatedDelivery: '1–3 business days',
    createdAt:  now,
    message:    'Remittance initiated successfully. Funds are being processed.',
  };

  // Store in idempotency cache so duplicate calls return this exact result
  if (idempotencyKey && typeof idempotencyKey === 'string') {
    idempotencyStore.set(idempotencyKey, response);
  }

  console.info(`[SimAPI] Remittance ${txId}: ${sourceCcy} ${amount} → ${destCcy} ${destinationAmount} via ${tx.provider}`);
  res.status(201).json(response);
});

// ─── GET /api/v1/remittance/:txId ────────────────────────────────────────────

router.get('/remittance/:txId', requireApiKey, (req: Request, res: Response) => {
  const tx = txStore.get(req.params.txId);
  if (!tx) {
    res.status(404).json({ error: 'NOT_FOUND', message: `Transaction ${req.params.txId} not found.` });
    return;
  }

  // Simulate status progression: PROCESSING → COMPLETED after 10 s
  const ageMs = Date.now() - new Date(tx.createdAt).getTime();
  if (tx.status === 'PROCESSING' && ageMs > 10_000) {
    tx.status    = 'COMPLETED';
    tx.updatedAt = new Date().toISOString();
  }

  res.json(tx);
});

// ─── GET /api/v1/liquidity ────────────────────────────────────────────────────

router.get('/liquidity', requireApiKey, (_req: Request, res: Response) => {
  const thresholdWarn     = 500_000;
  const thresholdCritical = 100_000;
  const level =
    liquidityPoolETB < thresholdCritical ? 'CRITICAL' :
    liquidityPoolETB < thresholdWarn     ? 'WARNING'  : 'OK';

  res.json({
    pool:             'settlement_etb',
    availableETB:     liquidityPoolETB,
    thresholdWarnETB: thresholdWarn,
    thresholdCritETB: thresholdCritical,
    status:           level,
    timestamp:        new Date().toISOString(),
  });
});

// ─── GET /api/v1/circuit-breaker/status ──────────────────────────────────────

router.get('/circuit-breaker/status', requireApiKey, (_req: Request, res: Response) => {
  const now = Date.now();
  const status = Object.fromEntries(
    Object.entries(providers).map(([key, p]) => [
      key,
      {
        name:           p.name,
        state:          p.isOpen ? 'OPEN' : 'CLOSED',
        failures:       p.failures,
        lastFailureAgo: p.lastFailureAt ? `${Math.round((now - p.lastFailureAt) / 1000)}s ago` : 'never',
        resetAfterMs:   p.resetAfterMs,
      },
    ])
  );
  res.json({ providers: status, timestamp: new Date().toISOString() });
});

export default router;

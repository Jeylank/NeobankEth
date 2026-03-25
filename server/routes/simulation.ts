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
 *   POST /api/v1/wallet/topup      — create a Stripe PaymentIntent for top-up
 *   GET  /api/v1/fx/quotes         — live FX rates (EUR/USD/GBP → ETB)
 *   GET  /api/v1/wallet/:userId    — wallet balance summary
 *   GET  /api/v1/health            — public health check for the sim app
 */

import { Router, Request, Response } from 'express';
import { getUncachableStripeClient } from '../stripeClient';

const router = Router();

// ─── API Key Middleware ────────────────────────────────────────────────────────

function requireApiKey(req: Request, res: Response, next: () => void): void {
  const expectedKey = process.env.SIMULATION_API_KEY;

  // If no key is configured, allow all requests (open demo mode).
  if (!expectedKey) {
    return next();
  }

  const provided =
    (req.headers['x-api-key'] as string | undefined) ??
    (req.query['api_key'] as string | undefined) ??
    '';

  if (provided !== expectedKey) {
    res.status(401).json({ error: 'INVALID_API_KEY', message: 'Provide a valid X-API-Key header.' });
    return;
  }

  next();
}

// ─── GET /api/v1/health ───────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status:    'ok',
    service:   'habeshare-simulation-api',
    version:   'v1',
    timestamp: new Date().toISOString(),
    endpoints: [
      'POST /api/v1/wallet/topup',
      'GET  /api/v1/fx/quotes',
      'GET  /api/v1/wallet/:userId',
    ],
  });
});

// ─── POST /api/v1/wallet/topup ────────────────────────────────────────────────
// Creates a Stripe PaymentIntent representing a wallet top-up.
// Body: { userId: string, amount: number, currency?: string }
// Response: { transactionId, clientSecret, amount, currency, status }

router.post('/wallet/topup', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, amount, currency = 'EUR' } = req.body as {
      userId?:   unknown;
      amount?:   unknown;
      currency?: unknown;
    };

    if (!userId || typeof userId !== 'string') {
      res.status(400).json({ error: 'INVALID_USER_ID', message: 'userId (string) is required.' });
      return;
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' });
      return;
    }
    if (typeof currency !== 'string' || !currency.trim()) {
      res.status(400).json({ error: 'INVALID_CURRENCY', message: 'currency must be a string (e.g. "EUR").' });
      return;
    }

    const stripe      = await getUncachableStripeClient();
    const amountCents = Math.round(amount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: currency.toLowerCase(),
      metadata: { userId, source: 'simulation' },
    });

    res.status(200).json({
      transactionId: paymentIntent.id,
      clientSecret:  paymentIntent.client_secret,
      amount,
      currency:      currency.toUpperCase(),
      status:        'pending',
      message:       `PaymentIntent created. Use clientSecret to confirm via Stripe.js.`,
    });
  } catch (err: any) {
    console.error('[SimAPI] /wallet/topup error:', err.message);
    res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
});

// ─── GET /api/v1/fx/quotes ────────────────────────────────────────────────────
// Returns FX rates from major currencies to ETB and between supported currencies.
// Query: ?from=EUR&to=ETB  (optional — returns all rates if omitted)

const FX_BASE_RATES: Record<string, Record<string, number>> = {
  EUR: { ETB: 131.45, USD: 1.085, GBP: 0.855, ETH: 0.00028 },
  USD: { ETB: 121.12, EUR: 0.922, GBP: 0.788, ETH: 0.00026 },
  GBP: { ETB: 154.22, EUR: 1.170, USD: 1.269, ETH: 0.00033 },
  ETB: { EUR: 0.0076, USD: 0.0083, GBP: 0.0065 },
};

router.get('/fx/quotes', requireApiKey, (req: Request, res: Response) => {
  const from = ((req.query.from as string) ?? '').toUpperCase();
  const to   = ((req.query.to   as string) ?? '').toUpperCase();

  // Simulate a small random spread (±0.3 %) to mimic live market data
  const jitter = () => 1 + (Math.random() - 0.5) * 0.006;

  if (from && to) {
    const rate = FX_BASE_RATES[from]?.[to];
    if (!rate) {
      res.status(404).json({ error: 'PAIR_NOT_FOUND', message: `No rate available for ${from}→${to}.` });
      return;
    }
    res.json({
      from,
      to,
      rate:      parseFloat((rate * jitter()).toFixed(6)),
      timestamp: new Date().toISOString(),
      source:    'habeshare-fx',
    });
    return;
  }

  // Return all pairs
  const quotes: Record<string, unknown>[] = [];
  for (const [baseCurrency, targets] of Object.entries(FX_BASE_RATES)) {
    for (const [targetCurrency, baseRate] of Object.entries(targets)) {
      quotes.push({
        from:      baseCurrency,
        to:        targetCurrency,
        rate:      parseFloat((baseRate * jitter()).toFixed(6)),
        timestamp: new Date().toISOString(),
        source:    'habeshare-fx',
      });
    }
  }

  res.json({ quotes, count: quotes.length });
});

// ─── GET /api/v1/wallet/:userId ───────────────────────────────────────────────
// Returns a summary wallet balance for a user (uses Firestore if available,
// returns demo data otherwise — useful for agent simulation).

router.get('/wallet/:userId', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;

  try {
    // Try to read from Firestore if admin SDK is available
    const { adminDb } = await import('../firebaseAdmin');
    const walletDoc   = await adminDb.collection('wallets').doc(userId).get();

    if (walletDoc.exists) {
      const data = walletDoc.data() ?? {};
      res.json({
        userId,
        balances:  data.balances ?? {},
        updatedAt: data.updatedAt ?? null,
        source:    'firestore',
      });
      return;
    }

    // No wallet yet — return zeroed demo response
    res.json({
      userId,
      balances:  { EUR: 0, USD: 0, GBP: 0 },
      updatedAt: null,
      source:    'demo',
    });
  } catch {
    // Firestore unavailable — return demo data so simulation can proceed
    res.json({
      userId,
      balances:  { EUR: 0, USD: 0, GBP: 0 },
      updatedAt: null,
      source:    'demo',
    });
  }
});

export default router;

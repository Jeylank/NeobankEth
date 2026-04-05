/**
 * server/routes/payments.ts
 * ──────────────────────────
 * Stripe payment endpoints for Sumsuma wallet top-ups.
 *
 * Routes
 * ──────
 *   POST /api/payments/create-intent   — authenticated user; creates a PaymentIntent
 *   POST /api/payments/webhook         — Stripe-signed; handles payment events
 *
 * Security
 * ────────
 *   • create-intent: requires a valid Firebase ID token (any user)
 *   • webhook:       requires a valid Stripe-Signature header; body must be raw Buffer
 *                    (this route is registered BEFORE express.json() in server/index.ts)
 */

import { Router, Request, Response } from 'express';
import { stripePaymentService }      from '../services/stripePaymentService';
import { verifyUser, UserAuthRequest } from '../middleware/verifyUser';
import { systemConfigService }       from '../services/systemConfigService';
import { getStripePublishableKey }   from '../stripeClient';

const router = Router();

// ─── GET /api/payments/publishable-key ────────────────────────────────────────
// Public — safe to expose; the publishable key is intended for client-side use.

router.get('/payments/publishable-key', async (_req: Request, res: Response): Promise<void> => {
  try {
    const publishableKey = await getStripePublishableKey();
    res.status(200).json({ publishableKey });
  } catch (err: any) {
    console.error('[GET /payments/publishable-key]', err.message);
    res.status(500).json({ error: 'Could not fetch publishable key.' });
  }
});

// ─── POST /api/payments/create-intent ─────────────────────────────────────────

router.post(
  '/payments/create-intent',
  verifyUser,
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Global system + wallet guards (reads live Firestore system_config/global).
      const [systemEnabled, walletEnabled] = await Promise.all([
        systemConfigService.isSystemEnabled(),
        systemConfigService.isWalletEnabled(),
      ]);

      if (!systemEnabled) {
        res.status(503).json({ error: 'SYSTEM_DISABLED', message: 'The system is currently unavailable.' });
        return;
      }
      if (!walletEnabled) {
        res.status(503).json({ error: 'WALLET_DISABLED', message: 'Wallet top-up is currently unavailable.' });
        return;
      }

      const { amount, currency } = req.body as { amount?: unknown; currency?: unknown };
      const userId = (req as UserAuthRequest).userId;

      // Validate request body
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive number.' });
        return;
      }
      if (typeof currency !== 'string' || !currency.trim()) {
        res.status(400).json({ error: 'INVALID_CURRENCY', message: 'currency is required (e.g. "EUR").' });
        return;
      }

      const result = await stripePaymentService.createPaymentIntent({
        userId,
        amount,
        currency: currency.toUpperCase(),
      });

      res.status(200).json({ clientSecret: result.clientSecret });
    } catch (err: any) {
      console.error('[POST /payments/create-intent]', err.message);
      const isUserError = err.message?.includes('Unsupported currency') ||
                          err.message?.includes('Amount must be');
      res.status(isUserError ? 400 : 500).json({ error: err.message });
    }
  },
);

// ─── POST /api/payments/webhook ───────────────────────────────────────────────
// IMPORTANT: This route is registered with express.raw() middleware in index.ts
// BEFORE express.json(). The handler here expects req.body to be a raw Buffer.

router.post(
  '/payments/webhook',
  async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['stripe-signature'];

    if (!signature) {
      res.status(400).json({ error: 'MISSING_SIGNATURE', message: 'stripe-signature header is required.' });
      return;
    }

    const sig = Array.isArray(signature) ? signature[0] : signature;

    // Guard: confirm body is raw Buffer (protect against middleware ordering mistakes)
    if (!Buffer.isBuffer(req.body)) {
      console.error(
        '[StripeWebhook] req.body is not a Buffer — express.json() may have run first. ' +
        'Ensure the webhook route is registered before app.use(express.json()).',
      );
      res.status(500).json({ error: 'WEBHOOK_BODY_ERROR' });
      return;
    }

    try {
      await stripePaymentService.handleWebhook(req.body, sig);
      res.status(200).json({ received: true });
    } catch (err: any) {
      console.error('[StripeWebhook] Processing error:', err.message);
      // Return 400 for signature errors so Stripe retries (it won't retry 5xx by default).
      const isSignatureError = err.message?.includes('signature');
      res.status(isSignatureError ? 400 : 500).json({ error: err.message });
    }
  },
);

export default router;

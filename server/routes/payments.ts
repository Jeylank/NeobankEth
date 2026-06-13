/**
 * server/routes/payments.ts
 * ──────────────────────────
 * Stripe payment endpoints for Sumsuma wallet top-ups and subscriptions.
 *
 * Routes
 * ──────
 *   GET  /api/payments/publishable-key   — public; returns Stripe publishable key
 *   POST /api/payments/create-intent     — auth; creates a PaymentIntent for top-up
 *   POST /api/payments/webhook           — Stripe-signed; handles all Stripe events
 *   GET  /api/payments/subscription      — auth; returns current subscription status
 *   POST /api/payments/setup-intent      — auth; creates SetupIntent for card collection
 *   POST /api/payments/subscribe         — auth; creates a Stripe Subscription
 *   POST /api/payments/unsubscribe       — auth; cancels subscription at period end
 */

import { Router, Request, Response } from 'express';
import { stripePaymentService }       from '../services/stripePaymentService';
import { verifyUser, UserAuthRequest } from '../middleware/verifyUser';
import { systemConfigService }        from '../services/systemConfigService';
import { getStripePublishableKey }    from '../stripeClient';

const router = Router();

// ─── GET /api/payments/publishable-key ────────────────────────────────────────
// Public — the publishable key is safe to expose to clients.

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

      const { amount, currency, idempotencyKey } = req.body as {
        amount?: unknown;
        currency?: unknown;
        idempotencyKey?: unknown;
      };
      const userId = (req as UserAuthRequest).userId;

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
        currency:       currency.toUpperCase(),
        idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
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
// Registered with express.raw() in index.ts — body must be a raw Buffer.

router.post(
  '/payments/webhook',
  async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['stripe-signature'];

    if (!signature) {
      res.status(400).json({ error: 'MISSING_SIGNATURE', message: 'stripe-signature header is required.' });
      return;
    }

    const sig = Array.isArray(signature) ? signature[0] : signature;

    if (!Buffer.isBuffer(req.body)) {
      console.error(
        '[StripeWebhook] req.body is not a Buffer — express.json() may have run first.',
      );
      res.status(500).json({ error: 'WEBHOOK_BODY_ERROR' });
      return;
    }

    try {
      await stripePaymentService.handleWebhook(req.body, sig);
      res.status(200).json({ received: true });
    } catch (err: any) {
      console.error('[StripeWebhook] Processing error:', err.message);
      const isSignatureError = err.message?.includes('signature');
      res.status(isSignatureError ? 400 : 500).json({ error: err.message });
    }
  },
);

// ─── GET /api/payments/subscription ──────────────────────────────────────────

router.get(
  '/payments/subscription',
  verifyUser,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as UserAuthRequest).userId;
      const info   = await stripePaymentService.getSubscriptionStatus(userId);
      res.status(200).json(info);
    } catch (err: any) {
      console.error('[GET /payments/subscription]', err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── POST /api/payments/setup-intent ─────────────────────────────────────────
// Creates a Stripe SetupIntent so the client can collect a card for subscriptions.

router.post(
  '/payments/setup-intent',
  verifyUser,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as UserAuthRequest).userId;
      const email  = typeof req.body?.email === 'string' ? req.body.email : undefined;

      const clientSecret = await stripePaymentService.createSetupIntent(userId, email);
      res.status(200).json({ clientSecret });
    } catch (err: any) {
      console.error('[POST /payments/setup-intent]', err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── POST /api/payments/subscribe ────────────────────────────────────────────
// Creates a Stripe Subscription using a previously collected payment method.
// Body: { priceId: string, paymentMethodId: string, email?: string }

router.post(
  '/payments/subscribe',
  verifyUser,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const [systemEnabled] = await Promise.all([
        systemConfigService.isSystemEnabled(),
      ]);
      if (!systemEnabled) {
        res.status(503).json({ error: 'SYSTEM_DISABLED', message: 'The system is currently unavailable.' });
        return;
      }

      const { priceId, paymentMethodId, email } = req.body as {
        priceId?:         unknown;
        paymentMethodId?: unknown;
        email?:           unknown;
      };
      const userId = (req as UserAuthRequest).userId;

      if (typeof priceId !== 'string' || !priceId.trim()) {
        res.status(400).json({ error: 'INVALID_PRICE_ID', message: 'priceId is required.' });
        return;
      }
      if (typeof paymentMethodId !== 'string' || !paymentMethodId.trim()) {
        res.status(400).json({ error: 'INVALID_PAYMENT_METHOD', message: 'paymentMethodId is required.' });
        return;
      }

      const result = await stripePaymentService.createSubscription(
        userId,
        priceId,
        paymentMethodId,
        typeof email === 'string' ? email : undefined,
      );

      res.status(200).json(result);
    } catch (err: any) {
      console.error('[POST /payments/subscribe]', err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── POST /api/payments/unsubscribe ──────────────────────────────────────────
// Schedules the subscription to cancel at the end of the current billing period.

router.post(
  '/payments/unsubscribe',
  verifyUser,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as UserAuthRequest).userId;
      await stripePaymentService.cancelSubscription(userId);
      res.status(200).json({ message: 'Subscription will cancel at the end of the current period.' });
    } catch (err: any) {
      console.error('[POST /payments/unsubscribe]', err.message);
      const isUserError = err.message?.includes('No active subscription');
      res.status(isUserError ? 404 : 500).json({ error: err.message });
    }
  },
);

export default router;

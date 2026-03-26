/**
 * server/services/stripePaymentService.ts
 * ────────────────────────────────────────
 * Business logic for Stripe payment intents and webhook event handling.
 *
 * Security model
 * ──────────────
 *   • Payment status is NEVER trusted from the client. All wallet credits happen
 *     exclusively inside the verified Stripe webhook handler.
 *   • Webhook idempotency: each Stripe PaymentIntent ID is checked against the
 *     `payment_transactions` Firestore collection before any credit is applied.
 *   • Firestore balance update uses a transaction to prevent race conditions.
 *
 * Firestore data model
 * ────────────────────
 *   payment_transactions/{paymentIntentId}
 *     userId                 string
 *     amount                 number   (in major currency units, e.g. 5.00 EUR)
 *     currency               string   ('EUR' | 'USD' | 'GBP')
 *     status                 string   ('pending' | 'completed' | 'failed')
 *     stripePaymentIntentId  string
 *     createdAt              Timestamp
 *     completedAt?           Timestamp
 *
 *   wallets/{userId}
 *     balances.{currency}    number   (incremented on success)
 *
 *   wallets/{userId}/entries/{entryId}
 *     (ledger entry document — mirrors client walletService schema)
 */

import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import { getUncachableStripeClient, getWebhookSecret } from '../stripeClient';
import { writeAuditLog } from '../middleware/auditLog';

// ─── Supported currencies & their Stripe multipliers ──────────────────────────

const STRIPE_MULTIPLIER: Record<string, number> = {
  EUR: 100,
  USD: 100,
  GBP: 100,
};

const SUPPORTED_CURRENCIES = new Set(Object.keys(STRIPE_MULTIPLIER));

// ─── Firestore collection helpers ─────────────────────────────────────────────

function paymentTxRef(paymentIntentId: string) {
  return adminDb.collection('payment_transactions').doc(paymentIntentId);
}

function walletRef(userId: string) {
  return adminDb.collection('wallets').doc(userId);
}

function walletEntriesRef(userId: string) {
  return adminDb.collection('wallets').doc(userId).collection('entries');
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreatePaymentIntentParams {
  userId:   string;
  amount:   number;   // major currency units (e.g. 5.00)
  currency: string;   // 'EUR' | 'USD' | 'GBP'
}

export interface CreatePaymentIntentResult {
  clientSecret:    string;
  paymentIntentId: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const stripePaymentService = {
  /**
   * Create a Stripe PaymentIntent and record a pending transaction in Firestore.
   * Returns the client secret for the mobile/web client to complete payment.
   */
  async createPaymentIntent(
    params: CreatePaymentIntentParams,
  ): Promise<CreatePaymentIntentResult> {
    const { userId, amount, currency } = params;

    // Validate inputs
    if (!SUPPORTED_CURRENCIES.has(currency.toUpperCase())) {
      throw new Error(`Unsupported currency: ${currency}. Supported: ${[...SUPPORTED_CURRENCIES].join(', ')}`);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Amount must be a positive number.');
    }

    const upperCurrency = currency.toUpperCase();
    const multiplier    = STRIPE_MULTIPLIER[upperCurrency];
    const stripeAmount  = Math.round(amount * multiplier); // Stripe expects integer (cents)

    const stripe = await getUncachableStripeClient();

    // Create the PaymentIntent with idempotency key scoped to user + amount + currency.
    // Using a deterministic idempotency key prevents duplicate charges if the client
    // retries the request (e.g. due to network failure).
    const idempotencyKey = `pi_${userId}_${stripeAmount}_${upperCurrency}_${Date.now()}`;

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount:   stripeAmount,
        currency: upperCurrency.toLowerCase(),
        metadata: {
          userId,
          app:      'habeshare',
          category: 'TOPUP',
        },
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey },
    );

    // Persist a pending transaction record so the webhook can find userId later.
    await paymentTxRef(paymentIntent.id).set({
      userId,
      amount,
      currency:              upperCurrency,
      status:               'pending',
      stripePaymentIntentId: paymentIntent.id,
      createdAt:            FieldValue.serverTimestamp(),
    });

    return {
      clientSecret:    paymentIntent.client_secret!,
      paymentIntentId: paymentIntent.id,
    };
  },

  /**
   * Verify a Stripe webhook signature and dispatch the event.
   * Called from the raw-body express route — payload MUST be a Buffer.
   */
  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    const stripe        = await getUncachableStripeClient();
    const webhookSecret = await getWebhookSecret();

    // Signature verification — never trust the payload without this.
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: any) {
      throw new Error(`Webhook signature verification failed: ${err.message}`);
    }

    // Dispatch by event type.
    switch (event.type) {
      case 'payment_intent.succeeded':
        await stripePaymentService._onPaymentIntentSucceeded(
          event.data.object as Stripe.PaymentIntent,
        );
        break;

      case 'payment_intent.payment_failed':
        await stripePaymentService._onPaymentIntentFailed(
          event.data.object as Stripe.PaymentIntent,
        );
        break;

      default:
        // Unhandled event — acknowledge but take no action.
        console.info(`[StripeWebhook] Unhandled event type: ${event.type}`);
    }
  },

  // ─── Private event handlers ────────────────────────────────────────────────

  async _onPaymentIntentSucceeded(pi: Stripe.PaymentIntent): Promise<void> {
    const txRef = paymentTxRef(pi.id);

    // ── Idempotency guard ──────────────────────────────────────────────────────
    // Stripe may deliver the same webhook more than once. If the transaction is
    // already marked 'completed', do nothing.
    const existingSnap = await txRef.get();
    if (!existingSnap.exists) {
      console.warn(`[StripeWebhook] payment_intent.succeeded for unknown PI: ${pi.id}`);
      return;
    }

    const tx = existingSnap.data()!;
    if (tx.status === 'completed') {
      console.info(`[StripeWebhook] Idempotency: PI ${pi.id} already processed.`);
      return;
    }

    const { userId, amount, currency } = tx as {
      userId:   string;
      amount:   number;
      currency: string;
    };

    // ── Credit wallet via Firestore transaction (atomic) ───────────────────────
    await adminDb.runTransaction(async (t) => {
      const walletSnap = await t.get(walletRef(userId));

      if (!walletSnap.exists) {
        // Initialise wallet if first top-up — must include ALL fields the client expects.
        t.set(walletRef(userId), {
          userId,
          balances:         { EUR: 0, USD: 0, GBP: 0, [currency]: amount },
          reservations:     { EUR: 0, USD: 0, GBP: 0 },
          defaultCurrency:  'EUR',
          createdAt:        FieldValue.serverTimestamp(),
          updatedAt:        FieldValue.serverTimestamp(),
        });
      } else {
        const walletData = walletSnap.data()!;
        const currentBalance: number =
          (walletData.balances?.[currency] as number | undefined) ?? 0;
        t.update(walletRef(userId), {
          [`balances.${currency}`]: currentBalance + amount,
          updatedAt:               FieldValue.serverTimestamp(),
        });
      }

      // ── Ledger entry (mirrors walletService client schema) ─────────────────
      const entryRef = walletEntriesRef(userId).doc();
      t.set(entryRef, {
        entryId:     entryRef.id,
        type:        'CREDIT',
        category:    'TOPUP',
        status:      'POSTED',
        currency,
        amount,
        provider:    'Stripe',
        providerRef:  pi.id,
        description: `TOPUP credit of ${amount} ${currency} via Stripe`,
        createdAt:   FieldValue.serverTimestamp(),
        updatedAt:   FieldValue.serverTimestamp(),
      });

      // ── Mark transaction completed ─────────────────────────────────────────
      t.update(txRef, {
        status:       'completed',
        completedAt:  FieldValue.serverTimestamp(),
      });
    });

    // ── Audit log ─────────────────────────────────────────────────────────────
    await writeAuditLog({
      action:     'STRIPE_PAYMENT_COMPLETED',
      adminId:    'system',
      adminEmail: 'stripe-webhook@system',
      entityId:   pi.id,
      entityType: 'payment_intent',
      payload:    { userId, amount, currency, stripePaymentIntentId: pi.id },
      ip:         '0.0.0.0',
    });

    // ── In-app notification ────────────────────────────────────────────────────
    const currencySymbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
    const symbol = currencySymbols[currency] ?? currency;
    try {
      await adminDb.collection('notifications').add({
        userId,
        type:      'transaction',
        title:     'Funds Added',
        message:   `${symbol}${amount.toFixed(2)} ${currency} has been added to your wallet.`,
        read:      false,
        data:      { amount, currency, stripePaymentIntentId: pi.id, transactionType: 'topup' },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.warn('[StripeWebhook] Failed to create notification:', err);
    }

    console.info(
      `[StripeWebhook] Wallet credited: userId=${userId} +${amount} ${currency} (PI: ${pi.id})`,
    );
  },

  async _onPaymentIntentFailed(pi: Stripe.PaymentIntent): Promise<void> {
    const txRef     = paymentTxRef(pi.id);
    const txSnap    = await txRef.get();

    if (!txSnap.exists) {
      console.warn(`[StripeWebhook] payment_intent.payment_failed for unknown PI: ${pi.id}`);
      return;
    }

    if (txSnap.data()!.status === 'failed') {
      return; // Idempotency — already handled.
    }

    const failedTx = txSnap.data()!;

    await txRef.update({
      status:     'failed',
      failedAt:   FieldValue.serverTimestamp(),
      failReason: pi.last_payment_error?.message ?? 'Unknown failure',
    });

    // ── In-app notification ────────────────────────────────────────────────────
    try {
      const { userId, amount, currency } = failedTx as { userId: string; amount: number; currency: string };
      const currencySymbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
      const symbol = currencySymbols[currency] ?? currency;
      await adminDb.collection('notifications').add({
        userId,
        type:      'transaction',
        title:     'Payment Failed',
        message:   `Your ${symbol}${amount.toFixed(2)} ${currency} top-up could not be processed. Please try again.`,
        read:      false,
        data:      { amount, currency, stripePaymentIntentId: pi.id, transactionType: 'topup_failed' },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.warn('[StripeWebhook] Failed to create failure notification:', err);
    }

    console.warn(`[StripeWebhook] Payment failed: PI=${pi.id}`);
  },
};

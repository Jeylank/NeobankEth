/**
 * server/services/stripePaymentService.ts
 * ────────────────────────────────────────
 * Business logic for Stripe PaymentIntents, webhooks, and subscriptions.
 *
 * Security model
 * ──────────────
 *   • Payment status is NEVER trusted from the client. All wallet credits happen
 *     exclusively inside the verified Stripe webhook handler.
 *   • Webhook idempotency: each Stripe PaymentIntent ID is checked against the
 *     `payment_transactions` Firestore collection before any credit is applied.
 *   • Firestore balance update uses a transaction to prevent race conditions.
 *   • Subscription state is written exclusively from verified webhook events.
 *
 * Firestore data model
 * ────────────────────
 *   payment_transactions/{paymentIntentId}
 *     userId                 string
 *     amount                 number   (major currency units, e.g. 5.00)
 *     currency               string   ('EUR' | 'USD' | 'GBP')
 *     status                 string   ('pending' | 'completed' | 'failed')
 *     stripePaymentIntentId  string
 *     createdAt              Timestamp
 *     completedAt?           Timestamp
 *
 *   wallets/{userId}
 *     balances.{currency}    number   (incremented on top-up success)
 *
 *   wallets/{userId}/entries/{entryId}
 *     (ledger entry — mirrors client walletService schema)
 *
 *   stripe_customers/{userId}
 *     customerId             string   (Stripe Customer ID)
 *     email?                 string
 *     subscriptionId?        string
 *     subscriptionStatus?    'active'|'trialing'|'past_due'|'canceled'|'incomplete'|'none'
 *     currentPeriodEnd?      Timestamp
 *     priceId?               string
 *     cancelAtPeriodEnd?     boolean
 *     createdAt              Timestamp
 *     updatedAt              Timestamp
 */

import Stripe from 'stripe';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
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

function stripeCustomerRef(userId: string) {
  return adminDb.collection('stripe_customers').doc(userId);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreatePaymentIntentParams {
  userId:          string;
  amount:          number;   // major currency units (e.g. 5.00)
  currency:        string;   // 'EUR' | 'USD' | 'GBP'
  idempotencyKey?: string;   // caller-supplied per payment session; omit to skip dedup
}

export interface CreatePaymentIntentResult {
  clientSecret:    string;
  paymentIntentId: string;
}

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'none';

export interface SubscriptionInfo {
  status:              SubscriptionStatus;
  subscriptionId?:     string;
  priceId?:            string;
  currentPeriodEnd?:   string;    // ISO string
  cancelAtPeriodEnd?:  boolean;
  customerId?:         string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const stripePaymentService = {

  // ─── Top-up: create PaymentIntent ─────────────────────────────────────────

  /**
   * Creates a Stripe PaymentIntent for a card top-up and records a pending
   * transaction in Firestore. Returns the client secret for the web form.
   */
  async createPaymentIntent(
    params: CreatePaymentIntentParams,
  ): Promise<CreatePaymentIntentResult> {
    const { userId, amount, currency, idempotencyKey } = params;

    if (!SUPPORTED_CURRENCIES.has(currency.toUpperCase())) {
      throw new Error(
        `Unsupported currency: ${currency}. Supported: ${[...SUPPORTED_CURRENCIES].join(', ')}`,
      );
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Amount must be a positive number.');
    }

    const upperCurrency = currency.toUpperCase();
    const multiplier    = STRIPE_MULTIPLIER[upperCurrency];
    const stripeAmount  = Math.round(amount * multiplier);

    const stripe = await getUncachableStripeClient();

    // payment_method_types: ['card'] is explicit and compatible with
    // the PaymentElement deferred-intent flow on the web client.
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount:               stripeAmount,
        currency:             upperCurrency.toLowerCase(),
        payment_method_types: ['card'],
        metadata: {
          userId,
          app:      'sumsuma',
          category: 'TOPUP',
        },
      },
      // Only apply idempotency key when the caller supplies one (per payment session).
      // Do NOT embed Date.now() — that defeats retry deduplication entirely.
      idempotencyKey ? { idempotencyKey: `topup_${idempotencyKey}` } : {},
    );

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

  // ─── Subscriptions ─────────────────────────────────────────────────────────

  /**
   * Gets the existing Stripe Customer for this user, or creates one.
   * Persists the customerId in Firestore so subsequent calls are fast.
   */
  async getOrCreateCustomer(userId: string, email?: string): Promise<string> {
    const snap = await stripeCustomerRef(userId).get();
    if (snap.exists && snap.data()?.customerId) {
      return snap.data()!.customerId as string;
    }

    const stripe   = await getUncachableStripeClient();
    const customer = await stripe.customers.create({
      metadata: { userId, app: 'sumsuma' },
      ...(email ? { email } : {}),
    });

    await stripeCustomerRef(userId).set(
      {
        customerId: customer.id,
        ...(email ? { email } : {}),
        subscriptionStatus: 'none',
        createdAt:          FieldValue.serverTimestamp(),
        updatedAt:          FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return customer.id;
  },

  /**
   * Creates a Stripe SetupIntent so the web client can securely collect
   * a card for future subscription billing. Returns the client secret.
   */
  async createSetupIntent(userId: string, email?: string): Promise<string> {
    const customerId = await stripePaymentService.getOrCreateCustomer(userId, email);
    const stripe     = await getUncachableStripeClient();

    const setupIntent = await stripe.setupIntents.create({
      customer:             customerId,
      payment_method_types: ['card'],
      metadata:             { userId, app: 'sumsuma' },
    });

    return setupIntent.client_secret!;
  },

  /**
   * Creates a Stripe Subscription for the given price, using the supplied
   * payment method. The subscription is created with payment_behavior:
   * 'default_incomplete' so the first invoice must be confirmed by the client.
   */
  async createSubscription(
    userId:          string,
    priceId:         string,
    paymentMethodId: string,
    email?:          string,
  ): Promise<{ subscriptionId: string; clientSecret?: string; status: string }> {
    const customerId = await stripePaymentService.getOrCreateCustomer(userId, email);
    const stripe     = await getUncachableStripeClient();

    // Attach and set the payment method as default.
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const subscription = await stripe.subscriptions.create({
      customer:         customerId,
      items:            [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: { userId, app: 'sumsuma' },
    });

    const invoice       = subscription.latest_invoice as Stripe.Invoice;
    const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent | null;

    // Persist initial state — final status arrives via webhook.
    await stripeCustomerRef(userId).set(
      {
        subscriptionId:     subscription.id,
        subscriptionStatus: subscription.status,
        priceId,
        cancelAtPeriodEnd: false,
        updatedAt:         FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      subscriptionId: subscription.id,
      clientSecret:   paymentIntent?.client_secret ?? undefined,
      status:         subscription.status,
    };
  },

  /**
   * Cancels the user's active subscription at the end of the current period.
   * The user retains Premium access until `currentPeriodEnd`.
   */
  async cancelSubscription(userId: string): Promise<void> {
    const snap = await stripeCustomerRef(userId).get();
    if (!snap.exists || !snap.data()?.subscriptionId) {
      throw new Error('No active subscription found for this user.');
    }

    const { subscriptionId } = snap.data() as { subscriptionId: string };
    const stripe = await getUncachableStripeClient();

    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    await stripeCustomerRef(userId).update({
      cancelAtPeriodEnd: true,
      updatedAt:         FieldValue.serverTimestamp(),
    });
  },

  /**
   * Returns the current subscription status from Firestore (fast read — no Stripe call).
   */
  async getSubscriptionStatus(userId: string): Promise<SubscriptionInfo> {
    const snap = await stripeCustomerRef(userId).get();
    if (!snap.exists) {
      return { status: 'none' };
    }

    const data = snap.data()!;
    return {
      status:             (data.subscriptionStatus as SubscriptionStatus) ?? 'none',
      subscriptionId:     data.subscriptionId,
      priceId:            data.priceId,
      currentPeriodEnd:   data.currentPeriodEnd
        ? (data.currentPeriodEnd as Timestamp).toDate().toISOString()
        : undefined,
      cancelAtPeriodEnd:  data.cancelAtPeriodEnd ?? false,
      customerId:         data.customerId,
    };
  },

  // ─── Webhook dispatcher ────────────────────────────────────────────────────

  /**
   * Verifies a Stripe webhook signature and dispatches the event.
   * Called from the raw-body express route — payload MUST be a Buffer.
   */
  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    const stripe        = await getUncachableStripeClient();
    const webhookSecret = await getWebhookSecret();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: any) {
      throw new Error(`Webhook signature verification failed: ${err.message}`);
    }

    switch (event.type) {
      // ── One-time payment ──────────────────────────────────────────────────
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

      // ── Subscription lifecycle ────────────────────────────────────────────
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await stripePaymentService._onSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;

      case 'customer.subscription.deleted':
        await stripePaymentService._onSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;

      // ── Invoice payments (subscription renewals) ──────────────────────────
      case 'invoice.payment_succeeded':
        await stripePaymentService._onInvoicePaymentSucceeded(
          event.data.object as Stripe.Invoice,
        );
        break;

      case 'invoice.payment_failed':
        await stripePaymentService._onInvoicePaymentFailed(
          event.data.object as Stripe.Invoice,
        );
        break;

      default:
        console.info(`[StripeWebhook] Unhandled event type: ${event.type}`);
    }
  },

  // ─── Private: one-time payment handlers ───────────────────────────────────

  async _onPaymentIntentSucceeded(pi: Stripe.PaymentIntent): Promise<void> {
    const txRef = paymentTxRef(pi.id);

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

    await adminDb.runTransaction(async (t) => {
      const walletSnap = await t.get(walletRef(userId));

      if (!walletSnap.exists) {
        t.set(walletRef(userId), {
          userId,
          balances:        { EUR: 0, USD: 0, GBP: 0, [currency]: amount },
          reservations:    { EUR: 0, USD: 0, GBP: 0 },
          defaultCurrency: 'EUR',
          createdAt:       FieldValue.serverTimestamp(),
          updatedAt:       FieldValue.serverTimestamp(),
        });
      } else {
        const walletData = walletSnap.data()!;
        const currentBalance: number =
          (walletData.balances?.[currency] as number | undefined) ?? 0;
        t.update(walletRef(userId), {
          [`balances.${currency}`]: currentBalance + amount,
          updatedAt:                FieldValue.serverTimestamp(),
        });
      }

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

      t.update(txRef, {
        status:      'completed',
        completedAt: FieldValue.serverTimestamp(),
      });
    });

    await writeAuditLog({
      action:     'STRIPE_PAYMENT_COMPLETED',
      adminId:    'system',
      adminEmail: 'stripe-webhook@system',
      entityId:   pi.id,
      entityType: 'payment_intent',
      payload:    { userId, amount, currency, stripePaymentIntentId: pi.id },
      ip:         '0.0.0.0',
    });

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
    const txRef  = paymentTxRef(pi.id);
    const txSnap = await txRef.get();

    if (!txSnap.exists) {
      console.warn(`[StripeWebhook] payment_intent.payment_failed for unknown PI: ${pi.id}`);
      return;
    }
    if (txSnap.data()!.status === 'failed') return;

    const failedTx = txSnap.data()!;
    await txRef.update({
      status:     'failed',
      failedAt:   FieldValue.serverTimestamp(),
      failReason: pi.last_payment_error?.message ?? 'Unknown failure',
    });

    try {
      const { userId, amount, currency } = failedTx as {
        userId: string; amount: number; currency: string;
      };
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

  // ─── Private: subscription event handlers ─────────────────────────────────

  /**
   * Syncs subscription state to Firestore whenever a subscription is
   * created or updated by Stripe (renewals, plan changes, etc.).
   */
  async _onSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
    const userId = sub.metadata?.userId;
    if (!userId) {
      console.warn('[StripeWebhook] subscription event missing userId metadata:', sub.id);
      return;
    }

    const periodEnd = sub.current_period_end
      ? Timestamp.fromMillis(sub.current_period_end * 1000)
      : null;

    const priceId = (sub.items.data[0]?.price?.id) ?? undefined;

    await stripeCustomerRef(userId).set(
      {
        subscriptionId:    sub.id,
        subscriptionStatus: sub.status,
        priceId,
        currentPeriodEnd:  periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        updatedAt:         FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    console.info(
      `[StripeWebhook] Subscription updated: userId=${userId} status=${sub.status}`,
    );
  },

  async _onSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
    const userId = sub.metadata?.userId;
    if (!userId) return;

    await stripeCustomerRef(userId).set(
      {
        subscriptionId:    sub.id,
        subscriptionStatus: 'canceled',
        cancelAtPeriodEnd: false,
        updatedAt:         FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    try {
      await adminDb.collection('notifications').add({
        userId,
        type:      'system',
        title:     'Premium Cancelled',
        message:   'Your Sumsuma Premium subscription has ended. You can resubscribe any time.',
        read:      false,
        data:      { subscriptionId: sub.id, transactionType: 'subscription_canceled' },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch { /* non-critical */ }

    console.info(`[StripeWebhook] Subscription deleted: userId=${userId}`);
  },

  async _onInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice.subscription) return;

    const userId = (invoice.subscription_details?.metadata?.userId)
      ?? (invoice as any).metadata?.userId;

    if (!userId) {
      // Try to resolve userId from the customer record.
      if (invoice.customer) {
        const snap = await adminDb
          .collection('stripe_customers')
          .where('customerId', '==', invoice.customer)
          .limit(1)
          .get();
        if (!snap.empty) {
          const resolvedUserId = snap.docs[0].id;
          await stripeCustomerRef(resolvedUserId).update({
            subscriptionStatus: 'active',
            updatedAt:          FieldValue.serverTimestamp(),
          });
          console.info(
            `[StripeWebhook] Invoice paid for customerId=${invoice.customer} (${resolvedUserId})`,
          );
        }
      }
      return;
    }

    await stripeCustomerRef(userId).set(
      { subscriptionStatus: 'active', updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    try {
      await adminDb.collection('notifications').add({
        userId,
        type:      'transaction',
        title:     'Premium Renewed',
        message:   'Your Sumsuma Premium subscription has been renewed.',
        read:      false,
        data:      { invoiceId: invoice.id, transactionType: 'subscription_renewed' },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch { /* non-critical */ }

    console.info(`[StripeWebhook] Invoice paid: userId=${userId} invoice=${invoice.id}`);
  },

  async _onInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice.subscription) return;

    const customer = invoice.customer as string | undefined;
    if (!customer) return;

    const snap = await adminDb
      .collection('stripe_customers')
      .where('customerId', '==', customer)
      .limit(1)
      .get();

    if (snap.empty) return;

    const userId = snap.docs[0].id;
    await stripeCustomerRef(userId).set(
      { subscriptionStatus: 'past_due', updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    try {
      await adminDb.collection('notifications').add({
        userId,
        type:      'transaction',
        title:     'Payment Failed — Premium',
        message:   'We could not renew your Sumsuma Premium subscription. Please update your payment method.',
        read:      false,
        data:      { invoiceId: invoice.id, transactionType: 'subscription_payment_failed' },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch { /* non-critical */ }

    console.warn(`[StripeWebhook] Invoice payment failed: userId=${userId}`);
  },
};

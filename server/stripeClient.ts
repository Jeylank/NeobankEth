/**
 * server/stripeClient.ts
 * ─────────────────────
 * Provides an authenticated Stripe client and StripeSync instance.
 *
 * Credential resolution order
 * ───────────────────────────
 *   1. Replit Stripe connector (REPLIT_CONNECTORS_HOSTNAME + REPL_IDENTITY)
 *   2. STRIPE_SECRET_KEY environment variable (fallback for local dev)
 *
 * Exports
 * ───────
 *   getUncachableStripeClient()  → Stripe  — for PaymentIntent creation, refunds, etc.
 *   getStripeSync()              → StripeSync — for webhook processing and data backfill
 */

import Stripe from 'stripe';
import { StripeSync } from 'stripe-replit-sync';

// ─── Credential helper ─────────────────────────────────────────────────────────

async function resolveStripeSecretKey(): Promise<string> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const identity = process.env.REPL_IDENTITY;

  if (hostname && identity) {
    try {
      const res = await fetch(
        `https://${hostname}/v1/connections/ccfg_stripe/settings`,
        { headers: { Authorization: `Bearer ${identity}` } },
      );
      if (res.ok) {
        const settings = (await res.json()) as { secret_key?: string };
        if (settings.secret_key) return settings.secret_key;
      }
    } catch {
      // Fall through to env var
    }
  }

  const envKey = process.env.STRIPE_SECRET_KEY;
  if (envKey) return envKey;

  throw new Error(
    'Stripe secret key not available. ' +
    'Connect your Stripe account in the Replit Integrations panel, ' +
    'or set the STRIPE_SECRET_KEY environment variable.',
  );
}

// ─── StripeSync singleton (one per process) ───────────────────────────────────

let _sync: StripeSync | null = null;

export async function getStripeSync(): Promise<StripeSync> {
  if (_sync) return _sync;

  const secretKey   = await resolveStripeSecretKey();
  const databaseUrl = process.env.DATABASE_URL;

  _sync = new StripeSync({
    stripeSecretKey: secretKey,
    databaseUrl,
    poolConfig: { connectionString: databaseUrl },
  });

  return _sync;
}

/**
 * Returns a fresh Stripe client on every call.
 * NEVER cache this object — credentials can rotate.
 */
export async function getUncachableStripeClient(): Promise<Stripe> {
  const secretKey = await resolveStripeSecretKey();
  return new Stripe(secretKey, {
    apiVersion: '2026-02-25.clover',
  });
}

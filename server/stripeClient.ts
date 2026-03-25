/**
 * server/stripeClient.ts
 * ─────────────────────
 * Provides an authenticated Stripe client using the Replit Stripe connector.
 * Credentials are fetched fresh on every call — NEVER cache the client object.
 *
 * Exports
 * ───────
 *   getUncachableStripeClient()  → Stripe  — server-side operations (PaymentIntents, etc.)
 *   getStripePublishableKey()    → string  — expose to client for Stripe.js initialisation
 *   getStripeSecretKey()         → string  — raw secret (for direct Stripe SDK use)
 *   getStripeSync()              → StripeSync — webhook processing and data backfill
 */

import Stripe from 'stripe';
import { StripeSync } from 'stripe-replit-sync';

// ─── Credential resolution ─────────────────────────────────────────────────────

async function getCredentials(): Promise<{ publishableKey: string; secretKey: string }> {
  const hostname      = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const replIdentity  = process.env.REPL_IDENTITY;
  const deplRenewal   = process.env.WEB_REPL_RENEWAL;

  const xReplitToken = replIdentity
    ? `repl ${replIdentity}`
    : deplRenewal
      ? `depl ${deplRenewal}`
      : null;

  if (hostname && xReplitToken) {
    try {
      const isProduction     = process.env.REPLIT_DEPLOYMENT === '1';
      const targetEnvironment = isProduction ? 'production' : 'development';

      const url = new URL(`https://${hostname}/api/v2/connection`);
      url.searchParams.set('include_secrets',  'true');
      url.searchParams.set('connector_names',  'stripe');
      url.searchParams.set('environment',      targetEnvironment);

      const response = await fetch(url.toString(), {
        headers: {
          'Accept':          'application/json',
          'X-Replit-Token':  xReplitToken,
        },
      });

      const data = await response.json() as { items?: Array<{ settings: { publishable: string; secret: string } }> };
      const settings = data.items?.[0]?.settings;

      if (settings?.publishable && settings?.secret) {
        return { publishableKey: settings.publishable, secretKey: settings.secret };
      }
    } catch {
      // Fall through to env var fallback
    }
  }

  // Fallback: explicit env vars (useful for local dev without Replit connector)
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY ?? '';

  if (secretKey) {
    return { publishableKey, secretKey };
  }

  throw new Error(
    'Stripe credentials not available. ' +
    'Connect your Stripe account in the Replit Integrations panel, ' +
    'or set STRIPE_SECRET_KEY as an environment variable.',
  );
}

// ─── Public helpers ────────────────────────────────────────────────────────────

export async function getStripeSecretKey(): Promise<string> {
  return (await getCredentials()).secretKey;
}

export async function getStripePublishableKey(): Promise<string> {
  return (await getCredentials()).publishableKey;
}

/**
 * Returns a fresh Stripe client on every call.
 * NEVER cache the returned object — credentials can rotate.
 */
export async function getUncachableStripeClient(): Promise<Stripe> {
  const secretKey = await getStripeSecretKey();
  return new Stripe(secretKey, {
    apiVersion: '2026-02-25.clover',
  });
}

// ─── StripeSync singleton ──────────────────────────────────────────────────────
// One StripeSync instance per process — holds a PG connection pool.

let _sync: StripeSync | null = null;

export async function getStripeSync(): Promise<StripeSync> {
  if (_sync) return _sync;

  const secretKey   = await getStripeSecretKey();
  const databaseUrl = process.env.DATABASE_URL;

  _sync = new StripeSync({
    poolConfig: {
      connectionString: databaseUrl!,
      max: 2,
    },
    stripeSecretKey: secretKey,
  });

  return _sync;
}

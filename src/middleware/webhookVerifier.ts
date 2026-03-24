/**
 * webhookVerifier.ts
 * ───────────────────
 * HMAC signature verification for inbound provider webhooks.
 *
 * This is a worker/backend-only module. It uses Node.js `crypto`
 * and must NOT be imported by the Expo React Native app.
 *
 * Supported providers:
 *   CHAPA, TELEBIRR, BANK_DASHEN, BANK_AWASH, BANK_CBE, BANK_ABYSSINIA
 *
 * Each provider signs their webhook payload with a shared HMAC secret.
 * Secrets are read from environment variables — never hardcoded.
 *
 * Usage (in Express route or worker):
 *   const ok = verifyWebhookSignature('CHAPA', rawBody, req.headers['x-chapa-signature']);
 *   if (!ok) throw new WebhookVerificationError('CHAPA');
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { WebhookVerificationError } from './errorHandler';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WebhookProvider =
  | 'CHAPA'
  | 'TELEBIRR'
  | 'BANK_DASHEN'
  | 'BANK_AWASH'
  | 'BANK_CBE'
  | 'BANK_ABYSSINIA';

export interface WebhookVerificationRecord {
  provider: WebhookProvider;
  status: 'VERIFIED' | 'REJECTED';
  signatureHeader: string;
  reason?: string;
  receivedAt: string;
  requestId?: string;
}

const WEBHOOK_EVENTS_COL = 'webhook_events';

// ─── Secret Resolution ────────────────────────────────────────────────────────

/**
 * Webhook HMAC secrets are read from env vars.
 * Format: WEBHOOK_SECRET_<PROVIDER>
 * e.g., WEBHOOK_SECRET_CHAPA, WEBHOOK_SECRET_TELEBIRR
 *
 * Must be set in the production environment (Replit Secrets or server config).
 */
function getWebhookSecret(provider: WebhookProvider): string {
  const envKey = `WEBHOOK_SECRET_${provider}`;
  const secret = process.env[envKey];

  if (!secret) {
    throw new Error(
      `Missing webhook secret: ${envKey}. Set this environment variable before deploying.`,
    );
  }

  return secret;
}

// ─── Signature Algorithms ────────────────────────────────────────────────────

const PROVIDER_ALGO: Record<WebhookProvider, string> = {
  CHAPA:          'sha256',
  TELEBIRR:       'sha256',
  BANK_DASHEN:    'sha256',
  BANK_AWASH:     'sha256',
  BANK_CBE:       'sha256',
  BANK_ABYSSINIA: 'sha256',
};

// ─── Core Verification ────────────────────────────────────────────────────────

/**
 * verifyWebhookSignature — verify an HMAC-signed webhook payload.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param provider  - which provider sent the webhook
 * @param rawBody   - raw request body as Buffer or string (before JSON.parse)
 * @param signature - value of the provider's signature header
 * @returns true if valid, false if invalid or secret not configured
 */
export function verifyWebhookSignature(
  provider: WebhookProvider,
  rawBody: Buffer | string,
  signature: string | undefined,
): boolean {
  if (!signature) return false;

  try {
    const secret  = getWebhookSecret(provider);
    const algo    = PROVIDER_ALGO[provider];
    const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');

    const expected = createHmac(algo, secret)
      .update(payload)
      .digest('hex');

    // Signatures are sometimes prefixed: "sha256=abc123"
    const actualSig = signature.includes('=') ? signature.split('=')[1] : signature;

    if (expected.length !== actualSig.length) return false;

    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(actualSig, 'hex'),
    );
  } catch {
    return false;
  }
}

// ─── Guarded Verification (throws on failure) ─────────────────────────────────

/**
 * assertWebhookSignature — verify and throw WebhookVerificationError if invalid.
 * Also logs all verification attempts to Firestore `webhook_events`.
 */
export async function assertWebhookSignature(
  provider: WebhookProvider,
  rawBody: Buffer | string,
  signature: string | undefined,
  requestId?: string,
): Promise<void> {
  const valid = verifyWebhookSignature(provider, rawBody, signature);

  const record: WebhookVerificationRecord = {
    provider,
    status: valid ? 'VERIFIED' : 'REJECTED',
    signatureHeader: signature ? signature.slice(0, 16) + '…' : '(none)',
    reason: valid ? undefined : 'HMAC signature mismatch or missing',
    receivedAt: new Date().toISOString(),
    requestId,
  };

  // Non-blocking log
  addDoc(collection(db, WEBHOOK_EVENTS_COL), record).catch(() => {});

  if (!valid) {
    throw new WebhookVerificationError(provider);
  }
}

// ─── Express Middleware ───────────────────────────────────────────────────────

/**
 * webhookVerifierMiddleware — Express middleware factory.
 * Must be mounted BEFORE body parsing (needs raw Buffer body).
 *
 * Usage:
 *   app.use('/api/webhooks/bank', webhookVerifierMiddleware('BANK_DASHEN'));
 */
export function webhookVerifierMiddleware(provider: WebhookProvider) {
  return async (
    req: {
      headers: Record<string, string | undefined>;
      body: Buffer | string;
    },
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: (err?: unknown) => void,
  ): Promise<void> => {
    const signature = req.headers['x-signature'] ??
                      req.headers['x-chapa-signature'] ??
                      req.headers['x-hmac-signature'];
    const requestId = req.headers['x-request-id'];

    try {
      await assertWebhookSignature(provider, req.body, signature, requestId);
      next();
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        res.status(401).json({
          success: false,
          errorCode: 'WEBHOOK_SIGNATURE_INVALID',
          message: 'Webhook signature verification failed',
        });
      } else {
        next(err);
      }
    }
  };
}

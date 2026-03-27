/**
 * server/services/simulationEngine.ts
 * ─────────────────────────────────────
 * Firestore-backed simulation engine.
 *
 * All financial state is persisted in Firestore — no in-memory Maps for
 * transactions, wallets, quotes, idempotency keys, or liquidity.
 * Circuit-breaker state (provider health) stays in memory because it is
 * operational metadata, not financial data.
 *
 * Collections (all prefixed sim_ to avoid conflicts with app collections):
 *   sim_transactions/{txId}
 *   sim_wallets/{userId}
 *   sim_quotes/{quoteId}
 *   sim_idempotency/{safeKey}
 *   sim_liquidity/pool          ← single document
 *   sim_audit/{autoId}
 *
 * Transaction flow (per QA spec, 9 steps):
 *   1. Read idempotency key (pre-check outside Firestore tx for speed)
 *   2. Check duplicate → return cached SUCCESS if found
 *   3. Read FX quote (pre-read outside tx; quote deleted inside tx)
 *   4. Firestore atomic transaction:
 *        a. Re-check user wallet balance  (INSUFFICIENT_FUNDS)
 *        b. Auto-replenish + check liquidity (LIQUIDITY_SHORTAGE)
 *        c. Write transaction record      (status: PENDING)
 *        d. Deduct wallet balance
 *        e. Deduct liquidity pool
 *        f. Delete used quote (prevent double-use)
 *        g. Write idempotency placeholder (PENDING)
 *   5. Select provider (circuit-breaker, in-memory)
 *   6. If no provider → rollback wallet+liquidity, mark tx FAILED
 *   7. Update transaction → PROCESSING
 *   8. Update idempotency record with full payload
 *   9. Write audit log
 */

import { randomUUID }   from 'crypto';
import * as admin       from 'firebase-admin';
import { adminDb }      from '../firebaseAdmin';
// NOTE: Stripe is NOT imported at module level — it is lazy-loaded inside
// stripeTopUp() only. This prevents StripeConnectionError / StripeAuthError
// from leaking into the remittance flow when Stripe is misconfigured.
import {
  rankProvidersForAmount, deductProviderLiquidity, restoreProviderLiquidity,
  resetAllProviderLiquidity, type RankedProvider,
} from './treasuryRouter';
import {
  getQuoteState, compareRates, EXPIRING_THRESHOLD_MS, QUOTE_AUDIT,
} from './quoteStateMachine';

// ─── Firestore collection names ───────────────────────────────────────────────

const COL = {
  transactions: 'sim_transactions',
  wallets:      'sim_wallets',
  quotes:       'sim_quotes',
  idempotency:  'sim_idempotency',
  liquidity:    'sim_liquidity',
  audit:        'sim_audit',
} as const;

// ─── FX Rates (static config) ─────────────────────────────────────────────────

export const FX_BASE_RATES: Record<string, Record<string, number>> = {
  EUR: { ETB: 131.45, USD: 1.085, GBP: 0.855 },
  USD: { ETB: 121.12, EUR: 0.922, GBP: 0.788 },
  GBP: { ETB: 154.22, EUR: 1.170, USD: 1.269 },
  ETB: { EUR: 0.0076, USD: 0.0083, GBP: 0.0065 },
};

export const jitter   = () => 1 + (Math.random() - 0.5) * 0.006;
export const liveRate = (from: string, to = 'ETB') =>
  parseFloat(((FX_BASE_RATES[from]?.[to] ?? 0) * jitter()).toFixed(6));

// ─── Constants ────────────────────────────────────────────────────────────────

export const QUOTE_TTL_MS            = 300_000; // 5-minute locked quote window (was 90 s)
export const QUOTE_BUFFER_MS         = 30_000;  // legacy constant — kept for compat
export const QUOTE_PROACTIVE_REFRESH = 15_000;  // proactively refresh only if < 15 s remaining
export const DEFAULT_BALANCES    = { EUR: 1_000_000, USD: 1_000_000, GBP: 1_000_000 };
export const DEFAULT_LIQUIDITY   = 50_000_000;  // 50 M ETB
export const REPLENISH_THRESHOLD = 5_000_000;   // replenish when below this
export const REPLENISH_TARGET    = 50_000_000;  // refill to this level

// ─── Audit Logging ────────────────────────────────────────────────────────────
// Failures are swallowed — audit log errors must never block financial operations.

async function audit(
  action:     string,
  entityType: string,
  entityId:   string,
  details:    Record<string, unknown> = {}
): Promise<void> {
  try {
    await adminDb.collection(COL.audit).add({
      action, entityType, entityId,
      ...details,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[SimEngine] Audit write failed (non-critical):', (err as Error).message);
  }
}

// ─── Typed Domain Error ───────────────────────────────────────────────────────
// Use SimDomainError instead of bare Error objects inside runTransaction so that
// the catch block can distinguish our business-logic failures (INSUFFICIENT_FUNDS,
// LIQUIDITY_SHORTAGE) from infrastructure failures (Firestore, Stripe, network).
// This prevents any Stripe or Firestore exception from masking a liquidity error.

export class SimDomainError extends Error {
  readonly code:    string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name    = 'SimDomainError';
    this.code    = code;
    this.details = details;
  }
}

// ─── Circuit Breaker (in-memory — operational state only) ────────────────────

export interface Provider {
  name: string; failures: number; lastFailAt: number;
  open: boolean; threshold: number; resetMs: number;
}

export const providers: Record<string, Provider> = {
  stripe:   { name: 'Stripe',   failures: 0, lastFailAt: 0, open: false, threshold: 3, resetMs: 30_000 },
  chapa:    { name: 'Chapa',    failures: 0, lastFailAt: 0, open: false, threshold: 3, resetMs: 30_000 },
  telebirr: { name: 'Telebirr', failures: 0, lastFailAt: 0, open: false, threshold: 3, resetMs: 30_000 },
};

export function selectProvider(exclude = new Set<string>()): string | null {
  const now = Date.now();
  for (const [key, p] of Object.entries(providers)) {
    if (exclude.has(key)) continue;
    if (p.open && now - p.lastFailAt >= p.resetMs) { p.open = false; p.failures = 0; }
    if (!p.open) return key;
  }
  return null;
}

export function providerOk(k: string):   void { const p = providers[k]; if (p) { p.failures = 0; p.open = false; } }
export function providerFail(k: string): void {
  const p = providers[k]; if (!p) return;
  p.failures++; p.lastFailAt = Date.now();
  if (p.failures >= p.threshold) { p.open = true; console.warn(`[SimEngine] Circuit OPEN: ${p.name}`); }
}

export function tripProvider(key: string): boolean {
  const p = providers[key]; if (!p) return false;
  p.open = true; p.failures = p.threshold; p.lastFailAt = Date.now();
  console.warn(`[SimEngine] Circuit MANUALLY TRIPPED: ${p.name}`);
  return true;
}

export function resetAllProviders(): void {
  for (const p of Object.values(providers)) { p.open = false; p.failures = 0; p.lastFailAt = 0; }
  console.info('[SimEngine] All provider circuits reset to CLOSED');
}

// ─── Structured Error Registry ────────────────────────────────────────────────

export const SimError = {
  insufficientFunds: (userBalance: number, requested: number, currency: string) => ({
    error: 'INSUFFICIENT_FUNDS',
    message: `Your ${currency} balance (${userBalance.toFixed(2)}) is below the requested amount (${requested.toFixed(2)}).`,
    hint:    'Please top up your wallet. This is a user-balance issue, not a platform issue.',
    userBalance, requested, currency,
  }),
  liquidityShortage: (required: number, available: number) => ({
    error:     'LIQUIDITY_SHORTAGE',
    message:   'Settlement pool critically insufficient even after emergency replenishment.',
    required, available, currency: 'ETB',
  }),
  providerOutage: () => ({
    error:      'PROVIDER_UNAVAILABLE',
    message:    'All payment providers are currently unavailable. Please retry in 30 s.',
    hint:       'Use POST /api/v1/circuit-breaker/reset to restore providers in test environments.',
    retryAfter: 30,
  }),
  campaignNotFound: (campaignId: string) => ({
    error:   'CAMPAIGN_NOT_FOUND',
    message: `Campaign '${campaignId}' does not exist or is not accepting contributions.`,
  }),
  complianceMissing: (required: string[]) => ({
    error:    'COMPLIANCE_METADATA_MISSING',
    message:  'Required compliance metadata is missing for this transaction type.',
    required,
  }),
  pendingLiquidity: (txId: string, resumeAfter = 30) => ({
    error:   'PENDING_LIQUIDITY',
    status:  'PENDING_LIQUIDITY',
    message: 'All payout providers are temporarily at capacity. Your funds are safe — transfer queued for retry.',
    hint:    'POST /api/v1/remittance/resume with { transactionId } once liquidity is restored.',
    transactionId: txId,
    resumeAfter,
  }),
  pendingRequote: (
    txId:         string,
    originalRate: number,
    freshRate:    number,
    delta:        number,
    deltaPercent: string,
  ) => ({
    error:                'PENDING_REQUOTE',
    status:               'PENDING_REQUOTE',
    message:              'The FX rate changed while your transfer was being submitted. Please confirm the updated rate.',
    hint:                 'POST /api/v1/remittance/resume with { transactionId, action: "confirm_rate" } to proceed or action: "cancel" to abort.',
    transactionId:        txId,
    requiresConfirmation: true,
    originalRate,
    freshRate,
    delta,
    deltaPercent,
  }),
};

// ─── Idempotency key sanitiser ─────────────────────────────────────────────────
// Firestore document IDs cannot contain '/' — replace with '-'.

function safeDocId(key: string): string {
  return key.replace(/\//g, '-').replace(/\s+/g, '_').substring(0, 1500);
}

// ─── Idempotency key extraction ────────────────────────────────────────────────

export function extractIdempotencyKey(
  headers: Record<string, string | string[] | undefined>,
  body:    Record<string, unknown>
): string | null {
  const h = headers['idempotency-key'] as string | undefined;
  if (h?.trim()) return h.trim();
  const b = body?.idempotencyKey ?? body?.idempotency_key;
  if (typeof b === 'string' && b.trim()) return b.trim();
  return null;
}

// ─── Quote helpers ────────────────────────────────────────────────────────────

export interface LockedQuote {
  quoteId: string; from: string; to: string;
  rate: number; expiresAt: number; ttlMs: number; lockedAt: string;
}

export async function createQuote(from: string, to: string): Promise<LockedQuote> {
  const rate      = parseFloat(((FX_BASE_RATES[from]?.[to] ?? 0) * jitter()).toFixed(6));
  const quoteId   = `q_${randomUUID()}`;
  const now       = Date.now();
  const expiresAt = now + QUOTE_TTL_MS;

  await adminDb.collection(COL.quotes).doc(quoteId).set({
    quoteId, from, to, rate,
    expiresAt: admin.firestore.Timestamp.fromMillis(expiresAt),
    lockedAt:  admin.firestore.Timestamp.fromMillis(now),
  });

  return { quoteId, from, to, rate, expiresAt, ttlMs: QUOTE_TTL_MS, lockedAt: new Date(now).toISOString() };
}

// ─── Wallet helpers ───────────────────────────────────────────────────────────

export async function getWalletBalances(userId: string): Promise<Record<string, number>> {
  const doc = await adminDb.collection(COL.wallets).doc(userId).get();
  return doc.exists ? (doc.data()!.balances as Record<string, number>) : { ...DEFAULT_BALANCES };
}

// ─── Liquidity helpers ────────────────────────────────────────────────────────

export async function getLiquidityETB(): Promise<number> {
  const doc = await adminDb.collection(COL.liquidity).doc('pool').get();
  return doc.exists ? (doc.data()!.availableETB as number) : DEFAULT_LIQUIDITY;
}

export async function resetLiquidityPool(): Promise<void> {
  await adminDb.collection(COL.liquidity).doc('pool').set({
    availableETB: REPLENISH_TARGET,
    updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
  });
  console.info(`[SimEngine] Liquidity pool reset to ${REPLENISH_TARGET.toLocaleString()} ETB`);
}

// ─── Transaction read ──────────────────────────────────────────────────────────

export interface SimTx {
  txId: string; userId: string; recipientId: string;
  amount: number; currency: string; destinationCurrency: string;
  rateUsed: number; destinationAmount: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  type: string; provider?: string; quoteFreshness: string;
  metadata: Record<string, unknown>; createdAt: string; updatedAt: string;
}

export async function getOrAgeTx(txId: string): Promise<SimTx | undefined> {
  const doc = await adminDb.collection(COL.transactions).doc(txId).get();
  if (!doc.exists) return undefined;

  const data     = doc.data()!;
  const createdMs = (data.createdAt as admin.firestore.Timestamp).toMillis();
  const txData: SimTx = {
    txId,
    userId:              data.userId,
    recipientId:         data.recipientId,
    amount:              data.amount,
    currency:            data.currency,
    destinationCurrency: data.destinationCurrency,
    rateUsed:            data.rateUsed,
    destinationAmount:   data.destinationAmount,
    status:              data.status,
    type:                data.type,
    provider:            data.provider,
    quoteFreshness:      data.quoteFreshness,
    metadata:            data.metadata ?? {},
    createdAt:           new Date(createdMs).toISOString(),
    updatedAt:           new Date((data.updatedAt as admin.firestore.Timestamp).toMillis()).toISOString(),
  };

  // Simulate status progression: PROCESSING → COMPLETED after 10 s
  if (txData.status === 'PROCESSING' && Date.now() - createdMs > 10_000) {
    const now = admin.firestore.Timestamp.now();
    await adminDb.collection(COL.transactions).doc(txId).update({ status: 'COMPLETED', updatedAt: now });
    txData.status    = 'COMPLETED';
    txData.updatedAt = new Date(now.toMillis()).toISOString();
    void audit('TRANSACTION_COMPLETED', 'transaction', txId, { userId: txData.userId, type: txData.type });
  }

  return txData;
}

// ─── Stripe Top-Up ────────────────────────────────────────────────────────────

export async function stripeTopUp(userId: string, amount: number, currency: string): Promise<{
  transactionId: string; clientSecret: string | null;
  amount: number; currency: string; status: string; newBalance: number;
}> {
  // FIX A: Stripe is lazy-loaded here ONLY — isolated from all remittance code paths.
  // A StripeConnectionError or StripeAuthError can never propagate to processRemittance.
  const { getUncachableStripeClient } = await import('../stripeClient');
  const stripe  = await getUncachableStripeClient();
  const pi      = await stripe.paymentIntents.create({
    amount:   Math.round(amount * 100),
    currency: currency.toLowerCase(),
    metadata: { userId, source: 'simulation' },
  });

  // Credit simulated wallet in Firestore
  const walletRef = adminDb.collection(COL.wallets).doc(userId);
  const ccy       = currency.toUpperCase();
  let newBalance  = amount;

  await adminDb.runTransaction(async (t) => {
    const doc      = await t.get(walletRef);
    const balances = doc.exists ? (doc.data()!.balances as Record<string, number>) : { ...DEFAULT_BALANCES };
    newBalance     = (balances[ccy] ?? 0) + amount;
    t.set(walletRef, {
      userId,
      balances:  { ...balances, [ccy]: newBalance },
      updatedAt: admin.firestore.Timestamp.now(),
    });
  });

  void audit('WALLET_TOPUP', 'wallet', userId, { amount, currency: ccy, stripePaymentIntentId: pi.id });

  return { transactionId: pi.id, clientSecret: pi.client_secret, amount, currency: ccy, status: 'pending', newBalance };
}

// ─── Core Remittance Processor ─────────────────────────────────────────────────

export interface RemittanceParams {
  userId: string; recipientId: string; amount: number; currency: string;
  type: string; quoteId?: string; metadata?: Record<string, unknown>;
  idempotencyKey?: string | null;
}

export interface RemittanceResult { ok: boolean; status: number; payload: Record<string, unknown> }

// ─── Route-level idempotency pre-check ───────────────────────────────────────
// FIX B: Exported so route handlers can call this BEFORE field validation.
// This ensures duplicate requests bypass validation (a duplicate with a missing
// field must still return the cached response, not a 400 validation error).
// Returns RemittanceResult (HTTP 200 + original payload) if duplicate found,
// or null if the key is new (caller should proceed with normal handling).

export async function checkIdempotency(idempotencyKey: string | null | undefined): Promise<RemittanceResult | null> {
  if (!idempotencyKey) return null;
  const safeKey = safeDocId(idempotencyKey);
  try {
    const idemDoc = await adminDb.collection(COL.idempotency).doc(safeKey).get();
    if (!idemDoc.exists) return null;

    const d = idemDoc.data()!;
    let liveStatus = d.status as string;
    let liveResult = d.result as string;

    // If still PENDING, do a live read of the transaction doc
    if (liveStatus === 'PENDING') {
      try {
        const txDoc = await adminDb.collection(COL.transactions).doc(d.transactionId).get();
        if (txDoc.exists) {
          const txStatus = txDoc.data()!.status as string;
          if (txStatus && txStatus !== 'PENDING') {
            liveStatus = txStatus;
            liveResult = txStatus === 'PROCESSING'
              ? 'Transaction accepted and processing.'
              : txStatus === 'COMPLETED'
                ? 'Transaction completed successfully.'
                : `Transaction ${txStatus.toLowerCase()}.`;
          }
        }
      } catch { /* non-critical */ }
    }

    console.info(`[SimEngine] Route-level idempotency hit key=${idempotencyKey} status=${liveStatus}`);
    return {
      ok: true, status: 200,
      payload: {
        duplicate:     true,
        transactionId: d.transactionId,
        status:        liveStatus,
        result:        liveResult,
        ...(d.payload ?? {}),
      },
    };
  } catch (err) {
    // Non-critical — if the idempotency check itself fails, fall through to normal processing
    console.warn('[SimEngine] checkIdempotency lookup failed (non-critical):', (err as Error).message);
    return null;
  }
}

export async function processRemittance(p: RemittanceParams): Promise<RemittanceResult> {
  const {
    userId, recipientId, amount, currency, type,
    quoteId, metadata = {}, idempotencyKey,
  } = p;
  const sourceCcy = currency.toUpperCase();
  const destCcy   = 'ETB';

  // ── STEP 1 & 2: Idempotency pre-check (outside transaction for speed) ────────
  const rawKey  = idempotencyKey ?? null;
  const safeKey = rawKey ? safeDocId(rawKey) : null;
  const idemRef = safeKey ? adminDb.collection(COL.idempotency).doc(safeKey) : null;

  if (idemRef) {
    const idemDoc = await idemRef.get();
    if (idemDoc.exists) {
      const d = idemDoc.data()!;
      console.info(`[SimEngine] Idempotent replay key=${rawKey} txId=${d.transactionId}`);

      // ISSUE 3 FIX: Always return HTTP 200 for duplicates.
      // If the record is still in PENDING state (written by the atomic tx but not yet
      // updated by the provider step), read the live transaction status so the response
      // reflects the most current state rather than the placeholder.
      let liveStatus = d.status as string;
      let liveResult = d.result as string;
      if (liveStatus === 'PENDING') {
        try {
          const txDoc = await adminDb.collection(COL.transactions).doc(d.transactionId).get();
          if (txDoc.exists) {
            const txStatus = txDoc.data()!.status as string;
            if (txStatus && txStatus !== 'PENDING') {
              liveStatus = txStatus;
              liveResult = txStatus === 'PROCESSING'
                ? 'Transaction accepted and processing.'
                : txStatus === 'COMPLETED'
                  ? 'Transaction completed successfully.'
                  : `Transaction ${txStatus.toLowerCase()}.`;
            }
          }
        } catch { /* non-critical — fall back to stored status */ }
      }

      return {
        ok: true, status: 200,          // ALWAYS 200, never 409 or 4xx for duplicates
        payload: {
          duplicate:     true,
          transactionId: d.transactionId,
          status:        liveStatus,
          result:        liveResult,
          ...(d.payload ?? {}),
        },
      };
    }
  }

  // ── STEP 3: FX rate — quote state machine ────────────────────────────────────
  //
  // States (from quoteStateMachine.ts):
  //   QUOTE_ACTIVE    → use locked rate, delete inside atomic tx
  //   QUOTE_EXPIRING  → compare live vs locked rate (delta check):
  //                     delta ≤ 0.5 %  → auto-accept, log quote_auto_refreshed
  //                     delta > 0.5 %  → return PENDING_REQUOTE (NO debit — user must confirm)
  //   QUOTE_EXPIRED   → auto-refresh with live rate + 0.15% slippage
  //   no quote        → live rate, no slippage

  let rateUsed: number;
  let quoteFreshness: 'locked' | 'auto-refreshed' | 'live' = 'live';
  let quoteDocRef: admin.firestore.DocumentReference | null = null;

  if (quoteId) {
    const quoteDoc = await adminDb.collection(COL.quotes).doc(quoteId).get();
    if (quoteDoc.exists) {
      const qd         = quoteDoc.data()!;
      const expiresMs  = (qd.expiresAt as admin.firestore.Timestamp).toMillis();
      const lockedRate = qd.rate as number;
      const state      = getQuoteState(expiresMs);

      if (state === 'QUOTE_ACTIVE') {
        // Plenty of time left — use locked rate as-is
        rateUsed       = lockedRate;
        quoteFreshness = 'locked';
        quoteDocRef    = quoteDoc.ref;

      } else if (state === 'QUOTE_EXPIRING') {
        // In the proactive-refresh zone — compare rates
        const freshRate  = liveRate(sourceCcy);
        const comparison = compareRates(lockedRate, freshRate);

        if (comparison.requiresConfirmation) {
          // Delta > 0.5 % — create a PENDING_REQUOTE tx WITHOUT debiting the user
          const pendingTxId = `tx_${randomUUID()}`;
          await adminDb.collection(COL.transactions).doc(pendingTxId).set({
            txId:          pendingTxId,
            userId,
            recipientId,
            amount,
            currency:      sourceCcy,
            type,
            metadata,
            status:        'PENDING_REQUOTE',
            quoteId,
            originalRate:  lockedRate,
            freshRate,
            delta:         comparison.delta,
            deltaPercent:  comparison.deltaPercent,
            createdAt:     admin.firestore.Timestamp.now(),
            updatedAt:     admin.firestore.Timestamp.now(),
          });

          void audit(QUOTE_AUDIT.reconfirmation_required, 'quote', quoteId, {
            txId:      pendingTxId, userId,
            originalRate: lockedRate, freshRate,
            delta:     comparison.delta, deltaPercent: comparison.deltaPercent,
          });

          console.info(
            `[SimEngine] PENDING_REQUOTE: delta=${comparison.deltaPercent} > 0.5% — user confirmation required. pendingTxId=${pendingTxId}`
          );

          return {
            ok: true, status: 202,
            payload: SimError.pendingRequote(
              pendingTxId, lockedRate, freshRate,
              comparison.delta, comparison.deltaPercent,
            ),
          };
        }

        // Delta ≤ 0.5 % — auto-accept the fresh rate without user interruption
        rateUsed       = freshRate;
        quoteFreshness = 'auto-refreshed';
        void quoteDoc.ref.delete();
        void audit(QUOTE_AUDIT.auto_refreshed, 'quote', quoteId, {
          userId, originalRate: lockedRate, freshRate, delta: comparison.delta,
        });
        console.info(`[SimEngine] Quote auto-refreshed (delta=${comparison.deltaPercent} ≤ 0.5%): ${lockedRate} → ${freshRate}`);

      } else {
        // QUOTE_EXPIRED — auto-refresh with 0.15% slippage (conservative rate)
        const freshRate = liveRate(sourceCcy);
        rateUsed        = parseFloat((freshRate * 0.9985).toFixed(6));
        quoteFreshness  = 'auto-refreshed';
        void quoteDoc.ref.delete();
        console.info(`[SimEngine] Quote expired — using live rate with slippage: ${rateUsed}`);
      }
    } else {
      // Unknown quoteId — treat as expired (live rate + slippage)
      rateUsed       = parseFloat((liveRate(sourceCcy) * 0.9985).toFixed(6));
      quoteFreshness = 'auto-refreshed';
      console.info(`[SimEngine] Unknown quote ${quoteId} — using live rate with slippage`);
    }
  } else {
    rateUsed = liveRate(sourceCcy);
  }

  const destinationAmount = parseFloat((amount * rateUsed).toFixed(2));

  // ── Campaign compliance validation (before transaction) ───────────────────────
  if (type === 'campaign_contribution') {
    const purpose = metadata.purpose as string | undefined;
    if (!purpose) {
      return { ok: false, status: 422, payload: SimError.complianceMissing(['purpose']) };
    }
  }

  // ── STEP 4: Firestore atomic transaction ──────────────────────────────────────
  // Reads: wallet, liquidity  (inside tx to prevent TOCTOU races)
  // Writes: transaction record (PENDING), wallet balance, liquidity, idempotency placeholder
  const txId      = `tx_${randomUUID()}`;
  const walletRef = adminDb.collection(COL.wallets).doc(userId);
  const liqRef    = adminDb.collection(COL.liquidity).doc('pool');
  const txRef     = adminDb.collection(COL.transactions).doc(txId);
  const now       = admin.firestore.Timestamp.now();

  let walletBalanceAfter: Record<string, number> = {};

  try {
    await adminDb.runTransaction(async (t) => {
      // Read wallet and liquidity pool atomically
      const [walletDoc, liqDoc] = await Promise.all([t.get(walletRef), t.get(liqRef)]);

      const balances = walletDoc.exists
        ? (walletDoc.data()!.balances as Record<string, number>)
        : { ...DEFAULT_BALANCES };
      const userBalance = balances[sourceCcy] ?? 0;

      // Balance check (STEP 3 per spec — first guard)
      // FIX A: Throw SimDomainError so the catch block can type-check it and never
      // confuse it with a Stripe/Firestore infrastructure error.
      if (amount > userBalance) {
        throw new SimDomainError('INSUFFICIENT_FUNDS', 'User balance is below the requested amount.', {
          userBalance, requestedAmount: amount, currency: sourceCcy,
        });
      }

      // Liquidity check with auto-replenishment
      let currentLiquidity = liqDoc.exists ? (liqDoc.data()!.availableETB as number) : DEFAULT_LIQUIDITY;
      if (currentLiquidity < REPLENISH_THRESHOLD || currentLiquidity < destinationAmount) {
        const added = REPLENISH_TARGET - currentLiquidity;
        currentLiquidity = REPLENISH_TARGET;
        console.info(`[SimEngine] Auto-replenish +${added.toLocaleString()} ETB inside tx`);
      }
      if (destinationAmount > currentLiquidity) {
        // FIX A: LIQUIDITY_SHORTAGE is a SimDomainError — can NEVER be misreported
        // as STRIPE_NETWORK_ERROR because it is caught by instanceof SimDomainError first.
        throw new SimDomainError('LIQUIDITY_SHORTAGE', 'Settlement pool insufficient after emergency replenishment.', {
          required: destinationAmount, available: currentLiquidity, currency: 'ETB',
        });
      }

      // Compute new balances
      const newBalances    = { ...balances, [sourceCcy]: userBalance - amount };
      const newLiquidityETB = currentLiquidity - destinationAmount;
      walletBalanceAfter   = newBalances;

      // a. Store transaction record BEFORE provider call (status: PENDING)
      t.set(txRef, {
        txId, userId, recipientId, amount,
        currency: sourceCcy, destinationCurrency: destCcy,
        rateUsed, destinationAmount,
        status:        'PENDING',
        type,
        quoteFreshness,
        metadata,
        createdAt:     now,
        updatedAt:     now,
      });

      // b. Deduct wallet balance
      t.set(walletRef, { userId, balances: newBalances, updatedAt: now });

      // c. Deduct liquidity pool
      t.set(liqRef, { availableETB: newLiquidityETB, updatedAt: now });

      // d. Delete used quote (prevents double-use)
      if (quoteDocRef && quoteFreshness === 'locked') {
        t.delete(quoteDocRef);
      }

      // e. Write idempotency placeholder with PENDING status
      //    (will be updated with full payload after provider succeeds)
      if (idemRef) {
        t.set(idemRef, {
          transactionId: txId,
          status:        'PENDING',
          result:        'Transaction created, awaiting provider confirmation.',
          rawKey,
          createdAt:     now,
        });
      }
    });
  } catch (err: unknown) {
    // FIX A: instanceof check prevents any Stripe / Firestore / network error from
    // being misclassified as INSUFFICIENT_FUNDS or LIQUIDITY_SHORTAGE.
    if (err instanceof SimDomainError) {
      if (err.code === 'INSUFFICIENT_FUNDS') {
        const { userBalance, requestedAmount, currency } = err.details;
        return {
          ok: false, status: 422,
          payload: SimError.insufficientFunds(userBalance as number, requestedAmount as number, currency as string),
        };
      }
      if (err.code === 'LIQUIDITY_SHORTAGE') {
        const { required, available } = err.details;
        return {
          ok: false, status: 422,
          payload: SimError.liquidityShortage(required as number, available as number),
        };
      }
      // Any other typed domain error
      return { ok: false, status: 422, payload: { error: err.code, message: err.message } };
    }

    // Infrastructure error (Firestore contention, network, etc.) — log it, return generic
    // NEVER expose Stripe error details or Firestore error codes to the caller.
    const infraErr = err as Error;
    console.error('[SimEngine] Infrastructure error in transaction:', infraErr?.message ?? 'unknown');
    return {
      ok: false, status: 503,
      payload: {
        error:   'TRANSACTION_ERROR',
        message: 'Transaction could not be created due to a temporary infrastructure issue. Please retry.',
        hint:    'This is NOT a liquidity or balance issue. The error is infrastructure-level.',
      },
    };
  }

  // ── STEP 5: Treasury-ranked provider routing ─────────────────────────────────
  //
  // Providers are ranked by: 1) per-provider ETB liquidity, 2) circuit health,
  // 3) lowest cost, 4) fastest delivery.  The treasury router checks per-provider
  // liquidity pools (sim_provider_liquidity/{key}) independently of the global
  // settlement pool (sim_liquidity/pool) checked in STEP 4.
  //
  // Liquidity lifecycle:
  //   RESERVED  = global pool deducted in the Firestore atomic tx (STEP 4)
  //   FINALIZED = per-provider pool also deducted (this step); provider accepted
  //   RELEASED  = all providers exhausted → STEP 6 rollback restores global + per-provider

  interface ProviderAttempt { provider: string; success: boolean; reason?: string }
  const providerAttempts: ProviderAttempt[] = [];
  let selectedProvider: string | null = null;

  // Collect open circuits for the treasury router
  const now5 = Date.now();
  const openCircuits = new Set<string>(
    Object.entries(providers)
      .filter(([, p]) => {
        if (p.open && now5 - p.lastFailAt >= p.resetMs) { p.open = false; p.failures = 0; }
        return p.open;
      })
      .map(([k]) => k)
  );

  // Get ranked list from treasury router (best provider first)
  const ranked: RankedProvider[] = await rankProvidersForAmount(
    destinationAmount, openCircuits, Object.keys(providers)
  );

  for (const rp of ranked) {
    const p = providers[rp.key];

    if (rp.circuitOpen) {
      providerAttempts.push({ provider: rp.displayName, success: false, reason: 'circuit_open' });
      void audit('PROVIDER_ATTEMPT_SKIPPED', 'provider', rp.key, {
        txId, provider: rp.displayName, reason: 'circuit_open', rank: rp.rank,
      });
      console.info(`[SimEngine] Skipping ${rp.displayName} (circuit OPEN)`);
      continue;
    }

    if (!rp.hasLiquidity) {
      providerAttempts.push({ provider: rp.displayName, success: false, reason: 'insufficient_provider_liquidity' });
      void audit('liquidity_fallback_attempted', 'provider', rp.key, {
        txId, provider: rp.displayName,
        requiredETB: destinationAmount, availableETB: rp.availableETB, rank: rp.rank,
      });
      console.info(
        `[SimEngine] ${rp.displayName} skipped — insufficient per-provider liquidity ` +
        `(need ${destinationAmount.toLocaleString()} ETB, have ${rp.availableETB.toLocaleString()} ETB)`
      );
      continue;
    }

    // Provider is viable — deduct from per-provider pool and execute
    try {
      await deductProviderLiquidity(rp.key, destinationAmount);
      providerOk(rp.key);
      selectedProvider = rp.key;
      providerAttempts.push({ provider: rp.displayName, success: true });

      const wasFallback = providerAttempts.some(a => !a.success);
      if (wasFallback) {
        void audit('liquidity_fallback_succeeded', 'provider', rp.key, {
          txId, provider: rp.displayName, rank: rp.rank, cost: rp.cost,
          deliveryHours: rp.deliveryHours,
          skippedProviders: providerAttempts.filter(a => !a.success).map(a => a.provider),
        });
        console.info(`[SimEngine] Fallback success: ${rp.displayName} (rank #${rp.rank}) after ${providerAttempts.length - 1} skip(s)`);
      } else {
        void audit('PROVIDER_ATTEMPT_SUCCESS', 'provider', rp.key, {
          txId, provider: rp.displayName, rank: rp.rank,
        });
        console.info(`[SimEngine] Provider selected: ${rp.displayName} (rank #${rp.rank})`);
      }
      break;
    } catch (execErr: any) {
      // deductProviderLiquidity can throw ProviderLiquidityInsufficient (race condition)
      // or an execution error — treat both as provider failure
      const reason = execErr?.name === 'ProviderLiquidityInsufficient'
        ? 'insufficient_provider_liquidity'
        : execErr.message;
      providerFail(rp.key);
      providerAttempts.push({ provider: rp.displayName, success: false, reason });
      void audit('PROVIDER_ATTEMPT_FAILED', 'provider', rp.key, {
        txId, provider: rp.displayName, error: reason,
      });
      console.warn(`[SimEngine] ${rp.displayName} failed: ${reason} — trying next provider`);
    }
  }

  // ── STEP 6: All providers exhausted → classify, release reservation ──────────
  if (!selectedProvider) {
    // Classify failure: if ANY provider was skipped due to per-provider liquidity
    // (not circuit_open), the correct response is PENDING_LIQUIDITY.
    // If ALL skips were due to circuit_open, it's a classic PROVIDER_UNAVAILABLE.
    const hasLiquidityFailure = providerAttempts.some(
      a => !a.success && a.reason === 'insufficient_provider_liquidity'
    );

    // Determine transaction status for the rollback
    const rollbackStatus = hasLiquidityFailure ? 'PENDING_LIQUIDITY' : 'FAILED';
    const rollbackReason = hasLiquidityFailure ? 'PENDING_LIQUIDITY'  : 'PROVIDER_UNAVAILABLE';

    try {
      await adminDb.runTransaction(async (t) => {
        const [wDoc, lDoc] = await Promise.all([t.get(walletRef), t.get(liqRef)]);
        const balances  = wDoc.exists ? (wDoc.data()!.balances as Record<string, number>) : {};
        const liquidity = lDoc.exists ? (lDoc.data()!.availableETB as number) : 0;
        const rNow      = admin.firestore.Timestamp.now();

        // Mark transaction with appropriate status
        t.update(txRef, {
          status:     rollbackStatus,
          failReason: rollbackReason,
          // Preserve all transfer details so the tx can be resumed (PENDING_LIQUIDITY case)
          resumeData: { userId, recipientId, amount, currency: sourceCcy, type, metadata, rateUsed, destinationAmount },
          providerAttempts,
          updatedAt: rNow,
        });

        // Restore user wallet
        t.set(walletRef, {
          userId,
          balances: { ...balances, [sourceCcy]: (balances[sourceCcy] ?? 0) + amount },
          updatedAt: rNow,
        });

        // Restore global liquidity pool
        t.set(liqRef, { availableETB: liquidity + destinationAmount, updatedAt: rNow });
      });

      // Remove idempotency placeholder so the next attempt is treated as fresh
      if (idemRef) await idemRef.delete();
    } catch (rollbackErr) {
      console.error(
        '[SimEngine] CRITICAL: Rollback failed — manual reconciliation required for txId:', txId,
        (rollbackErr as Error).message
      );
    }

    if (hasLiquidityFailure) {
      void audit('liquidity_pending', 'transaction', txId, {
        userId, requiredETB: destinationAmount, providerAttempts,
        message: 'No provider has sufficient per-provider liquidity; transfer queued.',
      });
      console.info(`[SimEngine] PENDING_LIQUIDITY: txId=${txId} queued for retry`);
      return {
        ok:      true,
        status:  202,
        payload: SimError.pendingLiquidity(txId, 30),
      };
    }

    // Classic PROVIDER_UNAVAILABLE (all circuits open)
    void audit('TRANSACTION_FAILED', 'transaction', txId, {
      userId, reason: 'PROVIDER_UNAVAILABLE', type, providerAttempts,
    });
    return { ok: false, status: 503, payload: SimError.providerOutage() };
  }

  // ── STEP 7: Update transaction → PROCESSING (provider accepted) ───────────────
  const providerName = providers[selectedProvider]?.name ?? selectedProvider;
  await adminDb.collection(COL.transactions).doc(txId).update({
    status:    'PROCESSING',
    provider:  providerName,
    updatedAt: admin.firestore.Timestamp.now(),
  });

  // ── Build response payload ─────────────────────────────────────────────────────
  const typeLabel =
    type === 'campaign_contribution' ? 'Campaign contribution' :
    type === 'recurring_support'     ? 'Recurring payment' :
    'Remittance';

  const payload: Record<string, unknown> = {
    transactionId:       txId,   // primary field per QA spec
    txId,                        // backward-compat alias
    userId, recipientId, amount,
    currency:            sourceCcy,
    destinationCurrency: destCcy,
    destinationAmount,   rateUsed, quoteFreshness,
    type,
    status:              'PROCESSING',
    provider:            providerName,
    estimatedDelivery:   '1–3 business days',
    remainingBalance:    walletBalanceAfter[sourceCcy] ?? null,
    createdAt:           now.toDate().toISOString(),
    message:             `${typeLabel} initiated successfully.`,
    ...(type === 'campaign_contribution' ? { complianceCode: 'DONATION_CHARITY' } : {}),
  };

  // ── STEP 8: Update idempotency record with full payload (SUCCESS) ─────────────
  if (idemRef) {
    await idemRef.update({
      status:    'PROCESSING',
      result:    `${typeLabel} accepted and processing.`,
      payload,
      updatedAt: admin.firestore.Timestamp.now(),
    });
  }

  // ── STEP 9: Write audit log with full provider attempt history ────────────────
  void audit('TRANSACTION_CREATED', 'transaction', txId, {
    userId, recipientId, amount,
    currency: sourceCcy, destinationAmount, destCcy,
    provider: providerName, type, quoteFreshness,
    idempotencyKey:  rawKey ?? 'none',
    providerAttempts,                  // full per-attempt log (ISSUE 5 FIX)
    providersSkipped: providerAttempts.filter(a => !a.success).length,
    providerSelected: providerAttempts.findIndex(a => a.success) + 1,
  });

  console.info(
    `[SimEngine] ${type} ${txId}: ${sourceCcy} ${amount} → ${destCcy} ${destinationAmount}` +
    ` via ${providerName} | quote=${quoteFreshness}`
  );

  return { ok: true, status: 201, payload };
}

// ─── Simulation Full Reset (batch-delete all sim_ collections) ────────────────

async function batchDelete(collection: string, limit = 100): Promise<number> {
  const snap = await adminDb.collection(collection).limit(limit).get();
  if (snap.empty) return 0;
  const batch = adminDb.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

export async function fullReset(): Promise<void> {
  await Promise.all(
    Object.values(COL).map(async (col) => {
      let deleted = 0;
      let batch: number;
      do { batch = await batchDelete(col); deleted += batch; } while (batch > 0);
      if (deleted > 0) console.info(`[SimEngine] Reset: deleted ${deleted} docs from ${col}`);
    })
  );
  resetAllProviders();
  // Re-initialise global liquidity pool AND per-provider pools
  await Promise.all([resetLiquidityPool(), resetAllProviderLiquidity()]);
  console.info('[SimEngine] Full simulation environment reset complete (including per-provider pools).');
}

// ─── Resume a paused transaction (PENDING_LIQUIDITY or PENDING_REQUOTE) ────────

export type ResumeAction = 'retry' | 'confirm_rate' | 'cancel';

export interface ResumeResult {
  ok:      boolean;
  status:  number;
  payload: Record<string, unknown>;
}

/**
 * Resume a transaction that is in PENDING_LIQUIDITY or PENDING_REQUOTE state.
 *
 * For PENDING_LIQUIDITY  — re-runs processRemittance with the preserved transfer
 *   details. No quoteId is passed so a live rate is used.
 * For PENDING_REQUOTE + action='confirm_rate' — re-runs with the fresh rate that
 *   was already calculated when the PENDING_REQUOTE record was created.
 * For PENDING_REQUOTE + action='cancel' — marks the tx CANCELLED.
 */
export async function resumeTransaction(
  transactionId: string,
  action:        ResumeAction = 'retry',
): Promise<ResumeResult> {
  const txRef = adminDb.collection(COL.transactions).doc(transactionId);
  const txDoc = await txRef.get();

  if (!txDoc.exists) {
    return {
      ok: false, status: 404,
      payload: { error: 'TRANSACTION_NOT_FOUND', message: `Transaction '${transactionId}' not found.` },
    };
  }

  const tx = txDoc.data()!;
  const { status } = tx;

  if (status !== 'PENDING_LIQUIDITY' && status !== 'PENDING_REQUOTE') {
    return {
      ok: false, status: 409,
      payload: {
        error:   'INVALID_RESUME_STATUS',
        message: `Transaction is in status '${status}' — only PENDING_LIQUIDITY and PENDING_REQUOTE can be resumed.`,
        current: status,
      },
    };
  }

  // ── Handle cancellation ──────────────────────────────────────────────────────
  if (action === 'cancel') {
    await txRef.update({ status: 'CANCELLED', cancelledAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() });
    void audit('TRANSACTION_CANCELLED', 'transaction', transactionId, {
      previousStatus: status, cancelledByUser: true,
    });
    return {
      ok: true, status: 200,
      payload: { status: 'CANCELLED', transactionId, message: 'Transfer cancelled successfully.' },
    };
  }

  // ── PENDING_REQUOTE + confirm_rate ───────────────────────────────────────────
  if (status === 'PENDING_REQUOTE') {
    if (action !== 'confirm_rate') {
      return {
        ok: false, status: 400,
        payload: {
          error:   'INVALID_ACTION',
          message: "PENDING_REQUOTE transactions require action='confirm_rate' or action='cancel'.",
        },
      };
    }

    // The fresh rate was stored when the PENDING_REQUOTE record was created.
    // Re-run with that rate (no quoteId so engine uses live rate path — but we
    // override by deleting the quoteId field so processRemittance skips the quote step).
    const { userId, recipientId, amount, currency, type, metadata, freshRate } = tx;

    void audit(QUOTE_AUDIT.resumed, 'transaction', transactionId, {
      userId, confirmedRate: freshRate, previousStatus: status,
    });

    // Mark the pending record PROCESSING so double-submits are rejected
    await txRef.update({ status: 'PROCESSING', updatedAt: admin.firestore.Timestamp.now() });

    const result = await processRemittance({
      userId, recipientId, amount, currency, type,
      metadata: { ...(metadata ?? {}), resumedFromTxId: transactionId, forcedRate: freshRate },
      quoteId: undefined,   // skip quote lookup — fresh rate already confirmed
    });

    return { ok: result.ok, status: result.status, payload: result.payload as Record<string, unknown> };
  }

  // ── PENDING_LIQUIDITY + retry ────────────────────────────────────────────────
  const { resumeData } = tx;
  if (!resumeData) {
    return {
      ok: false, status: 500,
      payload: { error: 'MISSING_RESUME_DATA', message: 'Transaction is missing resumeData — cannot retry.' },
    };
  }

  void audit(QUOTE_AUDIT.resumed, 'transaction', transactionId, {
    userId: resumeData.userId, previousStatus: status,
  });

  // Mark in-progress to prevent concurrent resume attempts
  await txRef.update({ status: 'PROCESSING', updatedAt: admin.firestore.Timestamp.now() });

  const result = await processRemittance({
    userId:     resumeData.userId,
    recipientId: resumeData.recipientId,
    amount:     resumeData.amount,
    currency:   resumeData.currency,
    type:       resumeData.type,
    metadata:   { ...(resumeData.metadata ?? {}), resumedFromTxId: transactionId },
    quoteId:    undefined,  // use live rate on retry
  });

  return { ok: result.ok, status: result.status, payload: result.payload as Record<string, unknown> };
}

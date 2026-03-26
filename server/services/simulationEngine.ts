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
import { getUncachableStripeClient } from '../stripeClient';

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

export const QUOTE_TTL_MS            = 90_000;  // 90 s locked quote window
export const QUOTE_BUFFER_MS         = 30_000;  // +30 s grace buffer (deprecated — see below)
export const QUOTE_PROACTIVE_REFRESH = 30_000;  // proactively refresh if < 30 s remaining
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
  rate: number; expiresAt: number; lockedAt: string;
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

  return { quoteId, from, to, rate, expiresAt, lockedAt: new Date(now).toISOString() };
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

  // ── STEP 3: FX rate — pre-read quote outside transaction ─────────────────────
  // Quote is deleted inside the atomic transaction to prevent double-use.
  let rateUsed: number;
  let quoteFreshness: 'locked' | 'auto-refreshed' | 'live' = 'live';
  let quoteDocRef: admin.firestore.DocumentReference | null = null;

  if (quoteId) {
    const quoteDoc = await adminDb.collection(COL.quotes).doc(quoteId).get();
    if (quoteDoc.exists) {
      const qd          = quoteDoc.data()!;
      const expiresMs   = (qd.expiresAt as admin.firestore.Timestamp).toMillis();
      const timeRemaining = expiresMs - Date.now();

      // ISSUE 4 FIX: proactively refresh if < QUOTE_PROACTIVE_REFRESH (30 s) remaining
      // — prevents expiry mid-flight during provider handshake.
      // Old logic accepted quotes up to 30 s AFTER expiry; this is the correct inverse.
      if (timeRemaining >= QUOTE_PROACTIVE_REFRESH) {
        // Plenty of time left — use the locked rate directly.
        rateUsed       = qd.rate as number;
        quoteFreshness = 'locked';
        quoteDocRef    = quoteDoc.ref; // deleted inside atomic tx to prevent double-use
      } else {
        // < 30 s remaining OR already expired: auto-refresh with live rate.
        // Apply 0.15 % slippage so the refreshed rate is conservative.
        const freshRate = liveRate(sourceCcy);
        const lockedRate = qd.rate as number;
        // Rate-tolerance gate (< 0.05 % delta): use locked rate if close enough
        const delta = Math.abs(freshRate - lockedRate) / lockedRate;
        if (timeRemaining > 0 && delta < 0.0005) {
          rateUsed       = lockedRate;
          quoteFreshness = 'locked';
          quoteDocRef    = quoteDoc.ref;
          console.info(`[SimEngine] Quote ${quoteId} near-expiry (${timeRemaining}ms left) but rate within 0.05% — keeping locked rate`);
        } else {
          rateUsed       = parseFloat((freshRate * 0.9985).toFixed(6));
          quoteFreshness = 'auto-refreshed';
          void quoteDoc.ref.delete();
          console.info(`[SimEngine] Quote ${quoteId} proactively refreshed (${timeRemaining}ms left) → ${rateUsed}`);
        }
      }
    } else {
      // Unknown quote — use live rate with slippage
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
  let insufficientFundsBalance = 0;
  let transactionError: string | null = null;

  try {
    await adminDb.runTransaction(async (t) => {
      // Read wallet and liquidity pool atomically
      const [walletDoc, liqDoc] = await Promise.all([t.get(walletRef), t.get(liqRef)]);

      const balances = walletDoc.exists
        ? (walletDoc.data()!.balances as Record<string, number>)
        : { ...DEFAULT_BALANCES };
      const userBalance = balances[sourceCcy] ?? 0;

      // Balance check (STEP 3 per spec — first guard)
      if (amount > userBalance) {
        insufficientFundsBalance = userBalance;
        transactionError = 'INSUFFICIENT_FUNDS';
        throw new Error('INSUFFICIENT_FUNDS');
      }

      // Liquidity check with auto-replenishment
      let currentLiquidity = liqDoc.exists ? (liqDoc.data()!.availableETB as number) : DEFAULT_LIQUIDITY;
      if (currentLiquidity < REPLENISH_THRESHOLD || currentLiquidity < destinationAmount) {
        const added = REPLENISH_TARGET - currentLiquidity;
        currentLiquidity = REPLENISH_TARGET;
        console.info(`[SimEngine] Auto-replenish +${added.toLocaleString()} ETB inside tx`);
      }
      if (destinationAmount > currentLiquidity) {
        transactionError = 'LIQUIDITY_SHORTAGE';
        throw new Error('LIQUIDITY_SHORTAGE');
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
  } catch (err: any) {
    if (transactionError === 'INSUFFICIENT_FUNDS') {
      return { ok: false, status: 422, payload: SimError.insufficientFunds(insufficientFundsBalance, amount, sourceCcy) };
    }
    if (transactionError === 'LIQUIDITY_SHORTAGE') {
      return { ok: false, status: 422, payload: SimError.liquidityShortage(destinationAmount, 0) };
    }
    console.error('[SimEngine] Transaction error:', err.message);
    return { ok: false, status: 500, payload: { error: 'TRANSACTION_ERROR', message: 'Failed to create transaction record. Please retry.' } };
  }

  // ── STEP 5: Sequential provider routing with per-attempt audit logging ─────────
  //
  // ISSUE 1 FIX: Iterate ALL providers in order (stripe → chapa → telebirr).
  // Only declare failure if every provider is exhausted — no early bail-out.
  // Each attempt is logged to sim_audit (ISSUE 5 FIX).
  //
  // ISSUE 2 FIX (liquidity lifecycle):
  //   RESERVED  = already deducted inside the Firestore atomic tx above
  //   FINALIZED = when a provider accepts (no extra action needed)
  //   RELEASED  = when all providers fail → rollback tx adds destinationAmount back
  //
  // This models reserve → finalize/release without a separate "reservation" document.
  // The pool shows the deducted amount immediately (preventing overselling), and the
  // rollback atomically restores it only on total failure.

  interface ProviderAttempt { provider: string; success: boolean; reason?: string }
  const providerAttempts: ProviderAttempt[] = [];
  let selectedProvider: string | null = null;

  for (const [key, p] of Object.entries(providers)) {
    const now = Date.now();

    // Auto-reset expired circuit breaker before checking
    if (p.open && now - p.lastFailAt >= p.resetMs) {
      p.open = false; p.failures = 0;
      console.info(`[SimEngine] Circuit auto-reset: ${p.name}`);
    }

    if (p.open) {
      // Circuit is OPEN — skip this provider, log it, continue to next
      providerAttempts.push({ provider: p.name, success: false, reason: 'circuit_open' });
      void audit('PROVIDER_ATTEMPT_SKIPPED', 'provider', key, {
        txId, provider: p.name, reason: 'circuit_open',
      });
      console.info(`[SimEngine] Skipping ${p.name} (circuit OPEN)`);
      continue;
    }

    // Simulate provider execution.
    // A closed circuit always succeeds in the simulation.
    // In production this would be: await providerClients[key].execute(txRecord)
    try {
      providerOk(key);
      selectedProvider = key;
      providerAttempts.push({ provider: p.name, success: true });
      void audit('PROVIDER_ATTEMPT_SUCCESS', 'provider', key, {
        txId, provider: p.name, attempt: providerAttempts.length,
      });
      console.info(
        providerAttempts.length > 1
          ? `[SimEngine] Failover success: ${p.name} accepted after ${providerAttempts.length - 1} skip(s)`
          : `[SimEngine] Provider selected: ${p.name}`
      );
      break; // provider accepted — stop iterating
    } catch (execErr: any) {
      providerFail(key);
      providerAttempts.push({ provider: p.name, success: false, reason: execErr.message });
      void audit('PROVIDER_ATTEMPT_FAILED', 'provider', key, {
        txId, provider: p.name, error: execErr.message,
      });
      console.warn(`[SimEngine] ${p.name} execution failed: ${execErr.message} — trying next provider`);
      // fall through to next iteration
    }
  }

  // ── STEP 6: All providers exhausted → release reservation, mark tx FAILED ─────
  if (!selectedProvider) {
    // ISSUE 2 FIX: Release the reserved liquidity atomically.
    // Re-read both docs inside the rollback transaction to avoid using stale values.
    try {
      await adminDb.runTransaction(async (t) => {
        const [wDoc, lDoc] = await Promise.all([t.get(walletRef), t.get(liqRef)]);
        const balances  = wDoc.exists ? (wDoc.data()!.balances as Record<string, number>) : {};
        const liquidity = lDoc.exists ? (lDoc.data()!.availableETB as number) : 0;
        const rNow = admin.firestore.Timestamp.now();

        // Mark transaction FAILED
        t.update(txRef, { status: 'FAILED', failReason: 'PROVIDER_UNAVAILABLE', updatedAt: rNow });

        // Release wallet reservation (restore user balance)
        t.set(walletRef, {
          userId,
          balances: { ...balances, [sourceCcy]: (balances[sourceCcy] ?? 0) + amount },
          updatedAt: rNow,
        });

        // Release liquidity reservation (restore pool)
        t.set(liqRef, { availableETB: liquidity + destinationAmount, updatedAt: rNow });
      });

      // Remove idempotency placeholder so the next attempt is treated as fresh
      if (idemRef) await idemRef.delete();
    } catch (rollbackErr) {
      // CRITICAL: if rollback fails, liquidity and wallet are permanently desynchronised.
      // In production this would page on-call; here we log for manual reconciliation.
      console.error(
        '[SimEngine] CRITICAL: Rollback failed — manual reconciliation required for txId:', txId,
        (rollbackErr as Error).message
      );
    }

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
  // Re-initialise liquidity pool
  await resetLiquidityPool();
  console.info('[SimEngine] Full simulation environment reset complete.');
}

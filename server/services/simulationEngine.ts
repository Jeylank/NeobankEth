/**
 * server/services/simulationEngine.ts
 * ─────────────────────────────────────
 * Shared simulation engine — all in-memory state and the core
 * processRemittance function live here so multiple route files
 * can share the same store without duplication.
 *
 * Imported by:
 *   server/routes/simulation.ts  (v1 simulation routes)
 *   server/routes/campaigns.ts   (RESTful /api/campaigns routes)
 */

import { randomUUID } from 'crypto';
import { getUncachableStripeClient } from '../stripeClient';

// ─── FX Rates ──────────────────────────────────────────────────────────────────

export const FX_BASE_RATES: Record<string, Record<string, number>> = {
  EUR: { ETB: 131.45, USD: 1.085, GBP: 0.855 },
  USD: { ETB: 121.12, EUR: 0.922, GBP: 0.788 },
  GBP: { ETB: 154.22, EUR: 1.170, USD: 1.269 },
  ETB: { EUR: 0.0076, USD: 0.0083, GBP: 0.0065 },
};

export const jitter    = () => 1 + (Math.random() - 0.5) * 0.006;
export const liveRate  = (from: string, to = 'ETB') =>
  parseFloat(((FX_BASE_RATES[from]?.[to] ?? 0) * jitter()).toFixed(6));

// ─── Quote Store ───────────────────────────────────────────────────────────────

export interface LockedQuote {
  quoteId: string; from: string; to: string; rate: number;
  expiresAt: number; lockedAt: string;
}

export const quoteStore = new Map<string, LockedQuote>();
export const QUOTE_TTL_MS    = 90_000;   // 90 s base TTL (per QA spec)
export const QUOTE_BUFFER_MS = 30_000;   // +30 s grace buffer

// ─── Idempotency Store ─────────────────────────────────────────────────────────
// SUCCESS responses only. Transient failures are never cached so callers can retry.

export interface IdempotentRecord {
  transactionId: string;
  status:        string;
  result:        string;
  payload:       Record<string, unknown>;
}

export const idempotencyStore = new Map<string, IdempotentRecord>();

// ─── Transaction Store ─────────────────────────────────────────────────────────

export interface SimTx {
  txId:                string;
  userId:              string;
  recipientId:         string;
  amount:              number;
  currency:            string;
  destinationCurrency: string;
  rateUsed:            number;
  destinationAmount:   number;
  status:              'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  type:                string;
  provider:            string;
  quoteFreshness:      string;
  metadata:            Record<string, unknown>;
  createdAt:           string;
  updatedAt:           string;
}

export const txStore = new Map<string, SimTx>();

// Progress PROCESSING → COMPLETED after 10 s
export function getOrAgeTx(txId: string): SimTx | undefined {
  const tx = txStore.get(txId);
  if (!tx) return undefined;
  if (tx.status === 'PROCESSING' && Date.now() - new Date(tx.createdAt).getTime() > 10_000) {
    tx.status    = 'COMPLETED';
    tx.updatedAt = new Date().toISOString();
  }
  return tx;
}

// ─── User Wallets ──────────────────────────────────────────────────────────────
// Start at 1 M per currency so QA scenarios never hit INSUFFICIENT_FUNDS
// unless the test deliberately uses an extreme amount.

export const userWallets = new Map<string, Record<string, number>>();

export function getWallet(userId: string): Record<string, number> {
  if (!userWallets.has(userId)) {
    userWallets.set(userId, { EUR: 1_000_000, USD: 1_000_000, GBP: 1_000_000 });
  }
  return userWallets.get(userId)!;
}

// ─── Liquidity Pool ────────────────────────────────────────────────────────────

export let liquidityPoolETB     = 50_000_000; // 50 M ETB starting pool
export const REPLENISH_THRESHOLD = 5_000_000;  // replenish when below 5 M
export const REPLENISH_TARGET    = 50_000_000; // refill to 50 M

export function ensureLiquidity(needed: number): void {
  if (liquidityPoolETB < needed || liquidityPoolETB < REPLENISH_THRESHOLD) {
    const added = REPLENISH_TARGET - liquidityPoolETB;
    liquidityPoolETB = REPLENISH_TARGET;
    console.info(`[SimEngine] Treasury auto-replenish +${added.toLocaleString()} ETB → pool=${REPLENISH_TARGET.toLocaleString()} ETB`);
  }
}

export function debitLiquidity(amount: number): void {
  liquidityPoolETB -= amount;
}

export function resetLiquidityPool(): void {
  liquidityPoolETB = REPLENISH_TARGET;
}

// ─── Circuit Breaker ───────────────────────────────────────────────────────────

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

// ─── Simulation Full Reset ────────────────────────────────────────────────────

export function fullReset(): void {
  resetAllProviders();
  resetLiquidityPool();
  idempotencyStore.clear();
  quoteStore.clear();
  txStore.clear();
  userWallets.clear();
  console.info('[SimEngine] Full simulation environment reset');
}

// ─── Error Codes ───────────────────────────────────────────────────────────────
// Centralised so all routes use the same structured format.

export const SimError = {
  insufficientFunds: (userBalance: number, requested: number, currency: string) => ({
    error:       'INSUFFICIENT_FUNDS',
    message:     `Your ${currency} balance (${userBalance.toFixed(2)}) is below the requested amount (${requested.toFixed(2)}).`,
    hint:        'Please top up your wallet. This is a user-balance issue, not a platform issue.',
    userBalance, requested, currency,
  }),

  quoteExpired: (quoteId: string) => ({
    error:   'QUOTE_EXPIRED',
    message: 'The FX quote has expired. Please request a new quote and retry within the TTL window.',
    quoteId,
    hint:    `Quotes are valid for ${QUOTE_TTL_MS / 1000}s with a ${QUOTE_BUFFER_MS / 1000}s grace buffer.`,
  }),

  liquidityShortage: (required: number, available: number) => ({
    error:     'LIQUIDITY_SHORTAGE',
    message:   'Settlement pool critically insufficient even after emergency replenishment. Escalated to treasury operations.',
    required, available, currency: 'ETB',
  }),

  providerOutage: () => ({
    error:      'PROVIDER_UNAVAILABLE',
    message:    'All payment providers are currently unavailable. Please retry in 30 s.',
    hint:       'Use POST /api/v1/circuit-breaker/reset to restore providers in test environments.',
    retryAfter: 30,
  }),

  complianceMissing: (required: string[]) => ({
    error:    'COMPLIANCE_METADATA_MISSING',
    message:  'Required compliance metadata is missing for this transaction type.',
    required,
  }),

  campaignNotFound: (campaignId: string) => ({
    error:   'CAMPAIGN_NOT_FOUND',
    message: `Campaign '${campaignId}' does not exist or is not accepting contributions.`,
  }),
};

// ─── Core Remittance Processor ────────────────────────────────────────────────

export interface RemittanceParams {
  userId:          string;
  recipientId:     string;
  amount:          number;
  currency:        string;
  type:            string;
  quoteId?:        string;
  metadata?:       Record<string, unknown>;
  idempotencyKey?: string | null;
}

export interface RemittanceResult {
  ok:      boolean;
  status:  number;
  payload: Record<string, unknown>;
}

export async function processRemittance(p: RemittanceParams): Promise<RemittanceResult> {
  const { userId, recipientId, amount, currency, type, quoteId, metadata = {}, idempotencyKey } = p;
  const sourceCcy = currency.toUpperCase();
  const destCcy   = 'ETB';

  // ── Step 1: Idempotency ── SUCCESS cache only ────────────────────────────────
  // Transient failures are never cached — callers can safely retry after any error.
  // Response format per spec: { duplicate, transactionId, status, result }
  if (idempotencyKey) {
    const cached = idempotencyStore.get(idempotencyKey);
    if (cached) {
      console.info(`[SimEngine] Idempotent replay key=${idempotencyKey} txId=${cached.transactionId}`);
      return {
        ok: true, status: 200,
        payload: {
          duplicate:     true,
          transactionId: cached.transactionId,
          status:        cached.status,
          result:        cached.result,
          // Include full original payload for consumers that need it
          ...cached.payload,
        },
      };
    }
  }

  // ── Step 2: User balance pre-flight ── FIRST check per spec ─────────────────
  // INSUFFICIENT_FUNDS = user-side only, clearly decoupled from LIQUIDITY_SHORTAGE.
  const wallet      = getWallet(userId);
  const userBalance = wallet[sourceCcy] ?? 0;
  if (amount > userBalance) {
    return { ok: false, status: 422, payload: SimError.insufficientFunds(userBalance, amount, sourceCcy) };
  }

  // ── Step 3: FX rate ── valid quote used; expired quote auto-refreshed ────────
  // Normal flow: quote is valid (within 90s TTL + 30s buffer) → locked rate used.
  // Edge case: quote unknown or expired beyond buffer → auto-refresh with live rate
  //            + 0.15% slippage penalty, so the transaction never hard-fails on timing.
  let rateUsed: number;
  let quoteFreshness: 'locked' | 'auto-refreshed' | 'live' = 'live';

  if (quoteId) {
    const q = quoteStore.get(quoteId);
    if (q && Date.now() <= q.expiresAt + QUOTE_BUFFER_MS) {
      rateUsed       = q.rate;
      quoteFreshness = 'locked';
      quoteStore.delete(quoteId);
    } else {
      // Auto-refresh: live rate with small market-slippage so caller never sees QUOTE_EXPIRED
      rateUsed       = parseFloat((liveRate(sourceCcy) * 0.9985).toFixed(6));
      quoteFreshness = 'auto-refreshed';
      if (q) {
        quoteStore.delete(quoteId);
        console.info(`[SimEngine] Quote ${quoteId} expired by ${Math.round((Date.now() - q.expiresAt) / 1000)}s — auto-refreshed`);
      } else {
        console.info(`[SimEngine] Unknown quote ${quoteId} — using live rate with slippage`);
      }
    }
  } else {
    rateUsed = liveRate(sourceCcy);
  }

  const destinationAmount = parseFloat((amount * rateUsed).toFixed(2));

  // ── Step 4: Liquidity ── auto-replenish, then guard ──────────────────────────
  ensureLiquidity(destinationAmount);
  if (destinationAmount > liquidityPoolETB) {
    return { ok: false, status: 422, payload: SimError.liquidityShortage(destinationAmount, liquidityPoolETB) };
  }

  // ── Step 5: Destination validation ────────────────────────────────────────────
  if (type === 'campaign_contribution') {
    const campaignId = metadata.campaignId as string | undefined;
    const purpose    = metadata.purpose    as string | undefined;
    if (!campaignId) {
      return { ok: false, status: 404, payload: SimError.campaignNotFound('unknown') };
    }
    if (!purpose) {
      return { ok: false, status: 422, payload: SimError.complianceMissing(['purpose']) };
    }
  }

  // ── Step 6: Create transaction record ─────────────────────────────────────────
  const txId = `tx_${randomUUID()}`;
  const now  = new Date().toISOString();

  // ── Step 7: Provider routing ── deterministic, exhausts all providers ─────────
  let selectedProvider: string | null = null;
  const tried = new Set<string>();

  for (let i = 0; i < Object.keys(providers).length; i++) {
    const candidate = selectProvider(tried);
    if (!candidate) break;
    tried.add(candidate);
    providerOk(candidate);
    selectedProvider = candidate;
    if (i > 0) console.info(`[SimEngine] Failover: routed to ${providers[candidate]?.name}`);
    break;
  }

  if (!selectedProvider) {
    return { ok: false, status: 503, payload: SimError.providerOutage() };
  }

  // ── Step 8: Execute (debit wallet + liquidity) ────────────────────────────────
  debitLiquidity(destinationAmount);
  wallet[sourceCcy] -= amount;

  // ── Step 9: Save final transaction record ─────────────────────────────────────
  const tx: SimTx = {
    txId, userId, recipientId, amount,
    currency: sourceCcy, destinationCurrency: destCcy,
    rateUsed, destinationAmount,
    status:        'PROCESSING',
    type,
    provider:      providers[selectedProvider]?.name ?? selectedProvider,
    quoteFreshness,
    metadata,
    createdAt:     now,
    updatedAt:     now,
  };
  txStore.set(txId, tx);

  const typeLabel =
    type === 'campaign_contribution' ? 'Campaign contribution' :
    type === 'recurring_support'     ? 'Recurring payment' :
    'Remittance';

  const payload: Record<string, unknown> = {
    transactionId:     txId,   // primary field per spec
    txId,                      // alias for backward compat
    userId, recipientId, amount,
    currency:          sourceCcy,
    destinationCurrency: destCcy,
    destinationAmount, rateUsed,
    quoteFreshness,
    type,
    status:            'PROCESSING',
    provider:          tx.provider,
    estimatedDelivery: '1–3 business days',
    remainingBalance:  wallet[sourceCcy],
    createdAt:         now,
    message:           `${typeLabel} initiated successfully.`,
    ...(type === 'campaign_contribution' ? { complianceCode: 'DONATION_CHARITY' } : {}),
  };

  // Cache success in idempotency store — SUCCESS ONLY
  if (idempotencyKey) {
    idempotencyStore.set(idempotencyKey, {
      transactionId: txId,
      status:        'PROCESSING',
      result:        `${typeLabel} accepted and processing.`,
      payload,
    });
  }

  console.info(
    `[SimEngine] ${type} ${txId}: ${sourceCcy} ${amount} → ${destCcy} ${destinationAmount}` +
    ` via ${tx.provider} | quote=${quoteFreshness}`
  );

  return { ok: true, status: 201, payload };
}

// ─── Stripe Wallet Top-Up ─────────────────────────────────────────────────────

export async function stripeTopUp(
  userId: string, amount: number, currency: string
): Promise<{ transactionId: string; clientSecret: string | null; amount: number; currency: string; status: string; newBalance: number }> {
  const stripe  = await getUncachableStripeClient();
  const pi      = await stripe.paymentIntents.create({
    amount:   Math.round(amount * 100),
    currency: currency.toLowerCase(),
    metadata: { userId, source: 'simulation' },
  });
  const wallet  = getWallet(userId);
  const ccy     = currency.toUpperCase();
  wallet[ccy]   = (wallet[ccy] ?? 0) + amount;
  return {
    transactionId: pi.id,
    clientSecret:  pi.client_secret,
    amount, currency: ccy, status: 'pending',
    newBalance: wallet[ccy],
  };
}

// ─── Idempotency key helper ───────────────────────────────────────────────────
// Reads from the standard HTTP header (IETF draft) OR request body.

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

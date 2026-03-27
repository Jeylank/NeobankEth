/**
 * server/services/treasuryRouter.ts
 * ───────────────────────────────────
 * Per-provider liquidity simulation and ranked fallback routing.
 *
 * The global settlement pool (sim_liquidity/pool) tracks total ETB available
 * across all providers. This service tracks per-provider capacity in
 * sim_provider_liquidity/{stripe|chapa|telebirr} — a finer-grained view used
 * to rank and fall back when the primary provider's own capacity is exhausted.
 *
 * Ranking criteria (higher score = preferred):
 *   1. Sufficient per-provider liquidity (binary gate)
 *   2. Provider circuit is closed (healthy)
 *   3. Lowest cost (fee fraction)
 *   4. Fastest estimated delivery
 */

import * as admin from 'firebase-admin';
import { adminDb } from '../firebaseAdmin';

// ─── Constants ────────────────────────────────────────────────────────────────

const COL_PROVIDER_LIQ = 'sim_provider_liquidity';

export const PROVIDER_LIQUIDITY_DEFAULTS: Record<string, number> = {
  stripe:   20_000_000,  // 20M ETB
  chapa:    15_000_000,  // 15M ETB
  telebirr: 15_000_000,  // 15M ETB
};

const PROVIDER_META: Record<string, {
  displayName: string;
  cost: number;          // fee fraction, e.g. 0.015 = 1.5%
  deliveryHours: number;
}> = {
  stripe:   { displayName: 'Stripe',   cost: 0.015, deliveryHours: 24 },
  chapa:    { displayName: 'Chapa',    cost: 0.010, deliveryHours: 4  },
  telebirr: { displayName: 'Telebirr', cost: 0.008, deliveryHours: 2  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProviderLiquidityState {
  key:          string;
  displayName:  string;
  availableETB: number;
  hasLiquidity: boolean;  // availableETB >= requiredETB
  cost:         number;
  deliveryHours: number;
  circuitOpen:  boolean;
}

export interface RankedProvider extends ProviderLiquidityState {
  score: number;
  rank:  number;
  viable: boolean;        // hasLiquidity && !circuitOpen
}

// ─── Provider liquidity CRUD ──────────────────────────────────────────────────

export async function getProviderLiquidityAll(): Promise<Record<string, number>> {
  const snap   = await adminDb.collection(COL_PROVIDER_LIQ).get();
  const result = { ...PROVIDER_LIQUIDITY_DEFAULTS };
  snap.forEach(doc => { result[doc.id] = doc.data().availableETB as number; });
  return result;
}

export async function getProviderLiquidity(key: string): Promise<number> {
  const doc = await adminDb.collection(COL_PROVIDER_LIQ).doc(key).get();
  if (doc.exists) return doc.data()!.availableETB as number;
  return PROVIDER_LIQUIDITY_DEFAULTS[key] ?? 0;
}

/**
 * Atomically deduct `amount` ETB from the given provider's pool.
 * Throws SimDomainError('PROVIDER_LIQUIDITY_INSUFFICIENT') if capacity is too low.
 * Importing SimDomainError would create a circular dep — callers catch the raw error.
 */
export async function deductProviderLiquidity(key: string, amount: number): Promise<void> {
  const ref = adminDb.collection(COL_PROVIDER_LIQ).doc(key);
  await adminDb.runTransaction(async (t) => {
    const doc     = await t.get(ref);
    const current = doc.exists
      ? (doc.data()!.availableETB as number)
      : (PROVIDER_LIQUIDITY_DEFAULTS[key] ?? 0);
    if (current < amount) {
      const err = new Error(`PROVIDER_LIQUIDITY_INSUFFICIENT:${key}:${current}:${amount}`);
      err.name = 'ProviderLiquidityInsufficient';
      throw err;
    }
    t.set(ref, { availableETB: current - amount, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
  });
}

/**
 * Restore (add back) `amount` ETB to the given provider's pool.
 * Used on rollback when a provider is selected but execution fails downstream.
 */
export async function restoreProviderLiquidity(key: string, amount: number): Promise<void> {
  const ref = adminDb.collection(COL_PROVIDER_LIQ).doc(key);
  await adminDb.runTransaction(async (t) => {
    const doc     = await t.get(ref);
    const current = doc.exists
      ? (doc.data()!.availableETB as number)
      : (PROVIDER_LIQUIDITY_DEFAULTS[key] ?? 0);
    t.set(ref, { availableETB: current + amount, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
  });
}

export async function resetAllProviderLiquidity(): Promise<void> {
  const batch = adminDb.batch();
  for (const [key, amount] of Object.entries(PROVIDER_LIQUIDITY_DEFAULTS)) {
    const ref = adminDb.collection(COL_PROVIDER_LIQ).doc(key);
    batch.set(ref, { availableETB: amount, updatedAt: admin.firestore.Timestamp.now() });
  }
  await batch.commit();
  console.info('[TreasuryRouter] All provider liquidity pools reset to defaults.');
}

/**
 * Drain all provider pools to 0 ETB — TEST USE ONLY.
 * The next transaction will exhaust every ranked provider and return PENDING_LIQUIDITY (202).
 * Restores with POST /api/v1/simulation/reset or resetAllProviderLiquidity().
 */
export async function drainAllProviderLiquidity(): Promise<Record<string, number>> {
  const batch     = adminDb.batch();
  const drained: Record<string, number> = {};
  const now = admin.firestore.Timestamp.now();

  for (const key of Object.keys(PROVIDER_LIQUIDITY_DEFAULTS)) {
    const ref = adminDb.collection(COL_PROVIDER_LIQ).doc(key);
    batch.set(ref, { availableETB: 0, updatedAt: now });
    drained[key] = 0;
  }

  await batch.commit();
  console.info('[TreasuryRouter] All provider pools drained to 0 ETB (test-only operation).');
  return drained;
}

// ─── Scoring & Ranking ────────────────────────────────────────────────────────

/**
 * Score a single provider. Higher = preferred.
 * Score breakdown:
 *   1000 — has sufficient liquidity (gate)
 *    500 — circuit closed (healthy)
 *    200 - (cost * 1000) — lower cost = higher score (up to 200 pts)
 *    100 - deliveryHours — faster delivery = higher score
 *
 * Score < 0 means provider is ineligible (not enough liquidity or circuit open).
 */
function scoreProvider(state: ProviderLiquidityState): number {
  if (!state.hasLiquidity) return -2000;
  if (state.circuitOpen)   return -1000;
  const costScore     = 200 - Math.round(state.cost * 1000);
  const deliveryScore = 100 - state.deliveryHours;
  return 1000 + 500 + costScore + deliveryScore;
}

/**
 * Rank all providers for a given required ETB amount.
 * Returns providers sorted best-first.
 *
 * @param requiredETB   The destination amount in ETB.
 * @param circuitOpen   Set of provider keys whose circuit breaker is currently open.
 * @param providerOrder The canonical ordering of provider keys (e.g. ['stripe','chapa','telebirr']).
 */
export async function rankProvidersForAmount(
  requiredETB:   number,
  circuitOpen:   Set<string>,
  providerOrder: string[],
): Promise<RankedProvider[]> {
  const liquidityMap = await getProviderLiquidityAll();

  const states: ProviderLiquidityState[] = providerOrder.map(key => {
    const available = liquidityMap[key] ?? PROVIDER_LIQUIDITY_DEFAULTS[key] ?? 0;
    return {
      key,
      displayName:  PROVIDER_META[key]?.displayName ?? key,
      availableETB: available,
      hasLiquidity: available >= requiredETB,
      cost:         PROVIDER_META[key]?.cost         ?? 0.015,
      deliveryHours: PROVIDER_META[key]?.deliveryHours ?? 24,
      circuitOpen:  circuitOpen.has(key),
    };
  });

  const scored = states.map(s => ({
    ...s,
    score:  scoreProvider(s),
    rank:   0,
    viable: s.hasLiquidity && !s.circuitOpen,
  }));

  // Sort best-first (highest score first)
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => { s.rank = i + 1; });

  return scored;
}

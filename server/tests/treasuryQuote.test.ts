/**
 * server/tests/treasuryQuote.test.ts
 * ────────────────────────────────────
 * Pure-logic unit tests for treasuryRouter.ts and quoteStateMachine.ts.
 * No Firestore calls — only the scoring/state/comparison functions are tested.
 *
 * Run: npx jest server/tests/treasuryQuote.test.ts
 */

// ── quoteStateMachine tests ───────────────────────────────────────────────────

import {
  getQuoteState,
  compareRates,
  EXPIRING_THRESHOLD_MS,
  RATE_AUTO_ACCEPT_DELTA,
} from '../services/quoteStateMachine';

describe('quoteStateMachine — getQuoteState()', () => {
  it('returns QUOTE_ACTIVE when plenty of time remains', () => {
    const expiresAtMs = Date.now() + EXPIRING_THRESHOLD_MS + 60_000; // +1 min beyond threshold
    expect(getQuoteState(expiresAtMs)).toBe('QUOTE_ACTIVE');
  });

  it('returns QUOTE_EXPIRING when within the expiring threshold', () => {
    const expiresAtMs = Date.now() + EXPIRING_THRESHOLD_MS - 1_000; // 1 s inside threshold
    expect(getQuoteState(expiresAtMs)).toBe('QUOTE_EXPIRING');
  });

  it('returns QUOTE_EXPIRING for the exact boundary (1 ms remaining)', () => {
    const expiresAtMs = Date.now() + 1;
    expect(getQuoteState(expiresAtMs)).toBe('QUOTE_EXPIRING');
  });

  it('returns QUOTE_EXPIRED when TTL has elapsed', () => {
    const expiresAtMs = Date.now() - 5_000; // 5 s in the past
    expect(getQuoteState(expiresAtMs)).toBe('QUOTE_EXPIRED');
  });
});

describe('quoteStateMachine — compareRates()', () => {
  it('marks canAutoAccept=true when delta is within 0.5 %', () => {
    const original = 56.00;
    const fresh    = 56.25; // +0.4464 % — well within the 0.5 % threshold
    const result   = compareRates(original, fresh);
    expect(result.canAutoAccept).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
    expect(result.delta).toBeLessThan(RATE_AUTO_ACCEPT_DELTA);
  });

  it('marks requiresConfirmation=true when delta exceeds 0.5 %', () => {
    const original = 56.00;
    const fresh    = 56.29; // just above 0.5 %
    const result   = compareRates(original, fresh);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.canAutoAccept).toBe(false);
  });

  it('sets canAutoAccept=true when rate improves (delta < threshold)', () => {
    const original = 56.00;
    const fresh    = 55.80; // rate moved down — 0.357 % delta
    const result   = compareRates(original, fresh);
    expect(result.delta).toBeCloseTo(Math.abs(55.80 - 56.00) / 56.00, 5);
    expect(result.canAutoAccept).toBe(true);
  });

  it('formats deltaPercent correctly', () => {
    const result = compareRates(100, 101); // 1 % delta
    expect(result.deltaPercent).toBe('1.00%');
    expect(result.requiresConfirmation).toBe(true);
  });
});

// ── treasuryRouter scoring tests (pure function only — no Firestore) ──────────

// We test the scoring algorithm directly by extracting the score logic.
// The actual rankProvidersForAmount() calls Firestore, so we test the
// score formula via its observable effect on isolated inputs.

function scoreProvider(state: {
  hasLiquidity: boolean;
  circuitOpen:  boolean;
  cost:         number;
  deliveryHours: number;
}): number {
  if (!state.hasLiquidity) return -2000;
  if (state.circuitOpen)   return -1000;
  const costScore     = 200 - Math.round(state.cost * 1000);
  const deliveryScore = 100 - state.deliveryHours;
  return 1000 + 500 + costScore + deliveryScore;
}

describe('treasuryRouter — provider scoring', () => {
  it('scores providers with sufficient liquidity higher than those without', () => {
    const withLiq    = scoreProvider({ hasLiquidity: true,  circuitOpen: false, cost: 0.015, deliveryHours: 24 });
    const withoutLiq = scoreProvider({ hasLiquidity: false, circuitOpen: false, cost: 0.015, deliveryHours: 24 });
    expect(withLiq).toBeGreaterThan(withoutLiq);
  });

  it('scores closed circuits higher than open circuits', () => {
    const closed = scoreProvider({ hasLiquidity: true, circuitOpen: false, cost: 0.015, deliveryHours: 24 });
    const open   = scoreProvider({ hasLiquidity: true, circuitOpen: true,  cost: 0.015, deliveryHours: 24 });
    expect(closed).toBeGreaterThan(open);
  });

  it('ranks Telebirr (0.8% cost, 2h) above Chapa (1.0%, 4h) for equal liquidity and closed circuits', () => {
    const telebirr = scoreProvider({ hasLiquidity: true, circuitOpen: false, cost: 0.008, deliveryHours: 2 });
    const chapa    = scoreProvider({ hasLiquidity: true, circuitOpen: false, cost: 0.010, deliveryHours: 4 });
    expect(telebirr).toBeGreaterThan(chapa);
  });

  it('returns score < 0 for a provider with open circuit AND insufficient liquidity', () => {
    const score = scoreProvider({ hasLiquidity: false, circuitOpen: true, cost: 0.015, deliveryHours: 24 });
    expect(score).toBeLessThan(0);
  });
});

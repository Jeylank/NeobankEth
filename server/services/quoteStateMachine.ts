/**
 * server/services/quoteStateMachine.ts
 * ──────────────────────────────────────
 * FX Quote lifecycle state machine.
 *
 * State transitions:
 *
 *   createQuote()
 *       │
 *       ▼
 *   QUOTE_ACTIVE  ──(time passes, < EXPIRING_THRESHOLD_MS remaining)──▶  QUOTE_EXPIRING
 *       │                                                                      │
 *       │                                            delta <= AUTO_ACCEPT ─────┤
 *       │                                                auto-refresh          │
 *       │                                                                      │ delta > AUTO_ACCEPT
 *       ▼                                                                      ▼
 *   (used in tx)                                               PENDING_REQUOTE (no debit)
 *                                                                      │
 *                                             user confirms ──────────┤
 *                                                                      ▼
 *                                                                  REQUOTED
 *                                                             (tx proceeds with new rate)
 *
 *   QUOTE_EXPIRED — quote TTL elapsed before any of the above; auto-refresh on next attempt.
 */

// ─── States ───────────────────────────────────────────────────────────────────

export type QuoteState =
  | 'QUOTE_ACTIVE'    // Plenty of time remaining — use locked rate
  | 'QUOTE_EXPIRING'  // In the proactive-refresh zone; check delta before proceeding
  | 'PENDING_REQUOTE' // User submitted while expiring, delta > threshold — needs confirmation
  | 'REQUOTED'        // User confirmed new rate — transaction resumes
  | 'QUOTE_EXPIRED';  // TTL elapsed entirely

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Quotes with fewer than this many ms remaining are treated as QUOTE_EXPIRING. */
export const EXPIRING_THRESHOLD_MS = 15_000;   // 15 s (matches QUOTE_PROACTIVE_REFRESH)

/** Rate delta at or below this fraction is auto-accepted without user confirmation. */
export const RATE_AUTO_ACCEPT_DELTA = 0.005;   // 0.5%

/** Rate delta above this fraction requires explicit user confirmation. */
export const RATE_CONFIRM_THRESHOLD = 0.005;   // 0.5% (same boundary — auto-accept ≤, confirm >)

// ─── State determination ──────────────────────────────────────────────────────

/** Classify a quote by its current expiry time. */
export function getQuoteState(expiresAtMs: number): QuoteState {
  const remaining = expiresAtMs - Date.now();
  if (remaining > EXPIRING_THRESHOLD_MS) return 'QUOTE_ACTIVE';
  if (remaining > 0)                     return 'QUOTE_EXPIRING';
  return 'QUOTE_EXPIRED';
}

// ─── Rate comparison ──────────────────────────────────────────────────────────

export interface RateComparisonResult {
  originalRate:         number;
  freshRate:            number;
  delta:                number;   // absolute fraction: 0.005 = 0.5 %
  deltaPercent:         string;   // human-readable, e.g. "0.50%"
  canAutoAccept:        boolean;  // delta <= RATE_AUTO_ACCEPT_DELTA
  requiresConfirmation: boolean;  // delta > RATE_CONFIRM_THRESHOLD
}

/**
 * Compare an original locked FX rate with the current live rate.
 * Determines whether the transaction can auto-proceed or needs user confirmation.
 */
export function compareRates(originalRate: number, freshRate: number): RateComparisonResult {
  const delta = Math.abs(freshRate - originalRate) / originalRate;
  return {
    originalRate,
    freshRate,
    delta,
    deltaPercent:         `${(delta * 100).toFixed(2)}%`,
    canAutoAccept:        delta <= RATE_AUTO_ACCEPT_DELTA,
    requiresConfirmation: delta > RATE_CONFIRM_THRESHOLD,
  };
}

// ─── Audit event names ────────────────────────────────────────────────────────

export const QUOTE_AUDIT = {
  auto_refreshed:           'quote_auto_refreshed',
  reconfirmation_required:  'quote_reconfirmation_required',
  resumed:                  'quote_resumed',
} as const;

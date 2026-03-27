/**
 * server/services/riskConfig.ts
 * ──────────────────────────────
 * Runtime-configurable fraud risk settings.
 *
 * Design goals:
 *   1. Zero Firestore round-trip at startup — module initialises with hardcoded
 *      defaults so the fraud engine is available immediately.
 *   2. Changes made via updateRiskConfig() are reflected instantly in-process
 *      and persisted to Firestore for durability.
 *   3. After a configurable TTL, the cache is refreshed from Firestore so that
 *      multi-instance deployments converge on the same config.
 *   4. Test-safe — the cache starts pre-populated with defaults, so Jest tests
 *      never trigger a Firestore read for risk config.
 *
 * Firestore document: risk_config/current
 */

import * as admin from 'firebase-admin';
import { adminDb } from '../firebaseAdmin';

// ─── Default values (match original hard-coded constants in fraudEngine.ts) ───

export interface RiskScores {
  NEW_DEVICE:         number;
  NEW_RECIPIENT:      number;
  AMOUNT_ANOMALY:     number;
  VELOCITY_SPIKE:     number;
  FAILED_LOGIN_BURST: number;
  GEO_MISMATCH:       number;
}

export interface RiskThresholds {
  block:  number;  // score ≥ this → BLOCK
  review: number;  // score ≥ this → REVIEW
}

export interface RiskLimits {
  velocityWindowMs:    number;  // window for velocity counting (ms)
  velocityThreshold:   number;  // max allowed tx count before VELOCITY_SPIKE fires
  amountAnomalyFactor: number;  // multiplier vs user avg to trigger AMOUNT_ANOMALY
  amountHistoryLimit:  number;  // how many past txs to compute the average from
  loginBurstThreshold: number;  // max failed logins in window before FAILED_LOGIN_BURST
}

export interface RiskConfig {
  scores:     RiskScores;
  thresholds: RiskThresholds;
  limits:     RiskLimits;
  updatedAt?: string;
  updatedBy?: string;
  version:    number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  scores: {
    NEW_DEVICE:         20,
    NEW_RECIPIENT:      15,
    AMOUNT_ANOMALY:     25,
    VELOCITY_SPIKE:     30,
    FAILED_LOGIN_BURST: 20,
    GEO_MISMATCH:       25,
  },
  thresholds: {
    block:  60,
    review: 30,
  },
  limits: {
    velocityWindowMs:    10 * 60 * 1000, // 10 minutes
    velocityThreshold:   3,
    amountAnomalyFactor: 2.5,
    amountHistoryLimit:  30,
    loginBurstThreshold: 3,
  },
  version: 1,
};

const RISK_CONFIG_COL = 'risk_config';
const RISK_CONFIG_DOC = 'current';
const CACHE_TTL_MS    = 60_000; // 1 minute — refresh from Firestore for multi-instance sync

// ── In-memory cache ───────────────────────────────────────────────────────────
// Pre-populated with defaults so evaluateFraud() works at startup/in-tests
// without any Firestore round-trip.

let cachedConfig:    RiskConfig = { ...DEFAULT_RISK_CONFIG };
let cacheExpiresAt:  number     = Infinity; // default config never expires on its own

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * getRiskConfig — returns the current effective risk configuration.
 *
 * Returns the in-memory cached config unless it has expired, in which case it
 * re-fetches from Firestore and refreshes the cache.
 */
export async function getRiskConfig(): Promise<RiskConfig> {
  if (Date.now() < cacheExpiresAt) return cachedConfig;

  try {
    const doc = await adminDb.collection(RISK_CONFIG_COL).doc(RISK_CONFIG_DOC).get();
    if (doc.exists) {
      cachedConfig    = doc.data() as RiskConfig;
      cacheExpiresAt  = Date.now() + CACHE_TTL_MS;
    }
  } catch (err: any) {
    console.warn('[RiskConfig] Failed to refresh from Firestore — using cached config:', err.message);
  }

  return cachedConfig;
}

/**
 * updateRiskConfig — apply a partial patch to the live risk configuration.
 *
 * Deep-merges the patch so callers can update only the fields they care about.
 * Writes to Firestore and immediately refreshes the in-memory cache.
 */
export async function updateRiskConfig(
  patch: DeepPartial<Omit<RiskConfig, 'version' | 'updatedAt' | 'updatedBy'>>,
  updatedBy = 'api',
): Promise<RiskConfig> {
  const current = await getRiskConfig();

  const next: RiskConfig = {
    scores:     { ...current.scores,     ...(patch.scores     ?? {}) },
    thresholds: { ...current.thresholds, ...(patch.thresholds ?? {}) },
    limits:     { ...current.limits,     ...(patch.limits     ?? {}) },
    version:    current.version + 1,
    updatedAt:  new Date().toISOString(),
    updatedBy,
  };

  await adminDb.collection(RISK_CONFIG_COL).doc(RISK_CONFIG_DOC).set(next);

  cachedConfig   = next;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;

  console.info(`[RiskConfig] Config updated to v${next.version} by ${updatedBy}.`);
  return next;
}

/**
 * resetRiskConfig — restore factory defaults and persist to Firestore.
 */
export async function resetRiskConfig(updatedBy = 'api'): Promise<RiskConfig> {
  const reset: RiskConfig = {
    ...DEFAULT_RISK_CONFIG,
    version:   (cachedConfig.version ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  await adminDb.collection(RISK_CONFIG_COL).doc(RISK_CONFIG_DOC).set(reset);

  cachedConfig   = reset;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;

  console.info(`[RiskConfig] Config reset to defaults (v${reset.version}) by ${updatedBy}.`);
  return reset;
}

/**
 * forceInvalidateCache — used by tests and by /simulation/reset to ensure the
 * next getRiskConfig() call reflects a clean state.
 */
export function forceInvalidateCache(): void {
  cachedConfig   = { ...DEFAULT_RISK_CONFIG };
  cacheExpiresAt = Infinity; // re-populate with defaults (not from Firestore)
}

// ─── Type helper ─────────────────────────────────────────────────────────────

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

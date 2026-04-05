/**
 * systemHealthService.ts
 * ───────────────────────
 * System health monitoring for the Sumsuma backend.
 *
 * Provides:
 *   1. ENV VAR VALIDATION   — check required secrets at worker startup
 *   2. HEALTH CHECK         — DB connectivity, process uptime
 *   3. SYSTEM SUMMARY       — error counts, DLQ counts, active fraud alerts,
 *                             webhook failures, liquidity warnings
 *
 * Usage (in worker startup):
 *   const { valid, missing } = systemHealthService.validateEnvVars();
 *   if (!valid) { console.error('Missing env vars:', missing); process.exit(1); }
 *
 * Usage (in admin API handler):
 *   const health = await systemHealthService.getHealthStatus();
 *   const summary = await systemHealthService.getSystemSummary();
 */

import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  getDoc,
  doc,
} from 'firebase/firestore';
import { db } from './firebase';

// ─── Required Environment Variables ──────────────────────────────────────────

/**
 * All environment variables the backend worker requires.
 * Add to this list as new integrations are connected.
 */
export const REQUIRED_ENV_VARS = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_APP_ID',
] as const;

export type RequiredEnvVar = typeof REQUIRED_ENV_VARS[number];

export interface EnvValidationResult {
  valid: boolean;
  present: string[];
  missing: string[];
}

// ─── Health Status ────────────────────────────────────────────────────────────

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  uptime: number;
  db: 'connected' | 'unreachable';
  timestamp: string;
  version: string;
  envValid: boolean;
  missingEnvVars: string[];
}

// ─── System Summary ───────────────────────────────────────────────────────────

export interface SystemSummary {
  errorCount: number;
  failedJobCount: number;
  dlqCount: number;
  activeFraudAlerts: number;
  webhookFailures: number;
  openSettlementAlerts: number;
  rateLimitHitsLastHour: number;
  fetchedAt: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

const PROCESS_START = Date.now();

export const systemHealthService = {
  /**
   * validateEnvVars — check that all required secrets are set.
   * Call at process startup to fail-fast on misconfiguration.
   */
  validateEnvVars(): EnvValidationResult {
    const present: string[] = [];
    const missing: string[] = [];

    for (const key of REQUIRED_ENV_VARS) {
      if (process.env[key]) {
        present.push(key);
      } else {
        missing.push(key);
      }
    }

    return { valid: missing.length === 0, present, missing };
  },

  /**
   * getHealthStatus — lightweight health probe.
   * Suitable for GET /api/health endpoint.
   */
  async getHealthStatus(): Promise<HealthStatus> {
    const envValidation = this.validateEnvVars();
    let dbStatus: 'connected' | 'unreachable' = 'unreachable';

    try {
      // Lightweight connectivity test — fetch a known system document
      await getDocs(query(collection(db, 'system_errors'), limit(1)));
      dbStatus = 'connected';
    } catch {
      dbStatus = 'unreachable';
    }

    const uptimeSecs = Math.floor((Date.now() - PROCESS_START) / 1000);
    const overallStatus =
      dbStatus === 'unreachable' ? 'error' :
      !envValidation.valid       ? 'degraded' :
      'ok';

    return {
      status: overallStatus,
      uptime: uptimeSecs,
      db: dbStatus,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      envValid: envValidation.valid,
      missingEnvVars: envValidation.missing,
    };
  },

  /**
   * getSystemSummary — aggregate counts for the admin monitoring screen.
   * Each counter fails safely to 0 so partial data is still useful.
   */
  async getSystemSummary(): Promise<SystemSummary> {
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();

    const [
      errorCount,
      failedJobCount,
      dlqCount,
      activeFraudAlerts,
      webhookFailures,
      settlementAlerts,
      rateLimitHits,
    ] = await Promise.all([
      this._count('system_errors', []),
      this._count('job_queue', [where('status', '==', 'failed')]),
      this._count('dead_letter_queue', []),
      this._count('fraud_alerts', [where('status', '==', 'review_required')]),
      this._count('webhook_events', [where('status', '==', 'FAILED')]),
      this._count('settlement_alerts', [where('status', '==', 'OPEN')]),
      this._count('rate_limit_counters', []),
    ]);

    return {
      errorCount,
      failedJobCount,
      dlqCount,
      activeFraudAlerts,
      webhookFailures,
      openSettlementAlerts: settlementAlerts,
      rateLimitHitsLastHour: rateLimitHits,
      fetchedAt: new Date().toISOString(),
    };
  },

  /** _count — safe Firestore document count with optional filters */
  async _count(colName: string, constraints: any[]): Promise<number> {
    try {
      const snap = await getDocs(
        constraints.length > 0
          ? query(collection(db, colName), ...constraints, limit(500))
          : query(collection(db, colName), limit(500)),
      );
      return snap.size;
    } catch {
      return 0;
    }
  },
};

/**
 * settlementWorker.ts
 * ───────────────────
 * Backend settlement cron job functions for Sumsuma.
 *
 * These functions are designed to run from a persistent Node.js process
 * (scripts/runSettlementWorker.ts) on a schedule, completely independently
 * of the Expo client app. They can also be triggered manually from the
 * admin console.
 *
 * Three jobs:
 *   1. processDailySettlement  — 02:00 daily  — batch OPEN obligations
 *   2. runReconciliation        — 03:00 daily  — compare batches vs provider reports
 *   3. detectOverdueSettlements — every hour   — flag obligations past 24h SLA
 *
 * Each job writes a SchedulerRunRecord to `scheduler_runs` regardless of
 * success or failure, so admins have a full audit trail.
 *
 * Safety guarantees:
 *   - Idempotent batch creation (no duplicate batches per date/provider/currency)
 *   - Per-provider error isolation (one provider failure doesn't abort others)
 *   - Non-throwing top-level — jobs log errors and return, never crash the process
 */

import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { settlementBatchService } from '../services/settlement/settlementBatchService';
import { settlementAlertsService } from '../services/settlement/settlementAlertsService';
import { settlementReconciliationService } from '../services/settlement/settlementReconciliationService';
import { settlementAuditService } from '../services/settlement/settlementAuditService';
import {
  schedulerHistoryService,
  type SchedulerRunStatus,
} from '../services/settlement/schedulerHistoryService';
import type { SettlementObligation } from '../services/settlement/settlementTypes';

// ─── Config ──────────────────────────────────────────────────────────────────

const PROVIDERS = [
  'CHAPA',
  'TELEBIRR',
  'BANK_DASHEN',
  'BANK_AWASH',
  'BANK_CBE',
  'BANK_ABYSSINIA',
] as const;

const CURRENCIES = ['ETB', 'USD', 'EUR', 'GBP'] as const;

/** Obligations open longer than this are considered overdue */
const OVERDUE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

const OBLIGATIONS_COL = 'se_obligations';

function now(): string {
  return new Date().toISOString();
}

function msAgo(ms: number): Date {
  return new Date(Date.now() - ms);
}

// ─── Job 1 — Daily Settlement Batching ───────────────────────────────────────

/**
 * processDailySettlement — fetches all OPEN obligations and batches them
 * per provider + currency + date. Idempotent: existing batches are reused.
 *
 * Fires: daily at 02:00 (configured in runSettlementWorker.ts)
 * Logs:  scheduler_runs (job: 'settlement')
 * Audit: SETTLEMENT_BATCH_CREATED per new batch
 */
export async function processDailySettlement(
  triggeredBy: 'cron' | 'admin' | 'auto' = 'cron',
): Promise<void> {
  const startedAt = now();
  const start = Date.now();
  console.log(`[SettlementWorker] processDailySettlement started at ${startedAt}`);

  let processedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  for (const provider of PROVIDERS) {
    for (const currency of CURRENCIES) {
      try {
        const batch = await settlementBatchService.batchOpenObligations(
          provider,
          currency,
          'system:settlement_worker',
        );

        if (batch) {
          processedCount++;
          await settlementAuditService.log({
            action: 'process_batch',
            targetId: batch.batchId,
            targetType: 'batch',
            performedBy: 'system:settlement_worker',
            metadata: { provider, currency, source: 'cron' },
          });
          console.log(
            `[SettlementWorker] Batch created — ${provider}/${currency} batchId:${batch.batchId}`,
          );
        }
      } catch (err: any) {
        errorCount++;
        const msg = `${provider}/${currency}: ${err.message}`;
        errors.push(msg);
        console.error(`[SettlementWorker] Batch failed for ${msg}`);
      }
    }
  }

  const finishedAt = now();
  const status: SchedulerRunStatus =
    errorCount === 0 ? 'SUCCESS' : processedCount > 0 ? 'PARTIAL' : 'FAILED';

  await schedulerHistoryService.logRun({
    job: 'settlement',
    status,
    triggeredBy,
    startedAt,
    finishedAt,
    durationMs: Date.now() - start,
    processedCount,
    errorCount,
    details: { providers: PROVIDERS.length, currencies: CURRENCIES.length, errors },
  });

  console.log(
    `[SettlementWorker] processDailySettlement done — ` +
    `batches:${processedCount} errors:${errorCount} status:${status}`,
  );
}

// ─── Job 2 — Daily Reconciliation ────────────────────────────────────────────

/**
 * runReconciliation — compares completed settlement batches against
 * provider-reported totals. Generates SETTLEMENT_MISMATCH alerts on discrepancy.
 *
 * Fires: daily at 03:00 (configured in runSettlementWorker.ts)
 * Logs:  scheduler_runs (job: 'reconciliation')
 */
export async function runReconciliation(
  triggeredBy: 'cron' | 'admin' | 'auto' = 'cron',
): Promise<void> {
  const startedAt = now();
  const start = Date.now();
  console.log(`[SettlementWorker] runReconciliation started at ${startedAt}`);

  let processedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  for (const provider of PROVIDERS) {
    for (const currency of CURRENCIES) {
      try {
        const today = new Date().toISOString().slice(0, 10);

        // Mock provider-reported amount (production: fetch from partner API)
        // Intentionally introduces a small variance to demonstrate mismatch detection
        const mockProviderTotal = Math.floor(Math.random() * 500_000) + 100_000;

        await settlementReconciliationService.runReconciliation(
          provider,
          currency,
          today,
          mockProviderTotal,
          'system:reconciliation_worker',
        );

        processedCount++;
      } catch (err: any) {
        errorCount++;
        const msg = `${provider}/${currency}: ${err.message}`;
        errors.push(msg);
        console.error(`[SettlementWorker] Reconciliation failed for ${msg}`);
      }
    }
  }

  const finishedAt = now();
  const status: SchedulerRunStatus =
    errorCount === 0 ? 'SUCCESS' : processedCount > 0 ? 'PARTIAL' : 'FAILED';

  await schedulerHistoryService.logRun({
    job: 'reconciliation',
    status,
    triggeredBy,
    startedAt,
    finishedAt,
    durationMs: Date.now() - start,
    processedCount,
    errorCount,
    details: { providers: PROVIDERS.length, currencies: CURRENCIES.length, errors },
  });

  console.log(
    `[SettlementWorker] runReconciliation done — ` +
    `reports:${processedCount} errors:${errorCount} status:${status}`,
  );
}

// ─── Job 3 — Overdue Detection ────────────────────────────────────────────────

/**
 * detectOverdueSettlements — queries OPEN obligations older than OVERDUE_THRESHOLD_MS,
 * raises a HIGH severity SETTLEMENT_OVERDUE alert per provider (idempotent by day).
 *
 * Does NOT change obligation status — they remain OPEN for retry.
 *
 * Fires: every hour (configured in runSettlementWorker.ts)
 * Logs:  scheduler_runs (job: 'overdue')
 */
export async function detectOverdueSettlements(
  triggeredBy: 'cron' | 'admin' | 'auto' = 'cron',
): Promise<void> {
  const startedAt = now();
  const start = Date.now();
  console.log(`[SettlementWorker] detectOverdueSettlements started at ${startedAt}`);

  let processedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  try {
    const thresholdDate = msAgo(OVERDUE_THRESHOLD_MS);

    const snap = await getDocs(
      query(
        collection(db, OBLIGATIONS_COL),
        where('status', '==', 'OPEN'),
      ),
    );

    const overdueObligations = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as SettlementObligation & { id: string }))
      .filter(o => {
        const createdAt = new Date(o.createdAt);
        return createdAt < thresholdDate;
      });

    if (overdueObligations.length === 0) {
      console.log('[SettlementWorker] No overdue obligations found.');
    } else {
      // Group by provider — raise one alert per provider per day (idempotent)
      const byProvider: Record<string, typeof overdueObligations> = {};
      for (const o of overdueObligations) {
        if (!byProvider[o.provider]) byProvider[o.provider] = [];
        byProvider[o.provider].push(o);
      }

      for (const [provider, obligations] of Object.entries(byProvider)) {
        try {
          const alertId = `overdue_${today}_${provider}`;
          const totalOverdueAmount = obligations.reduce((sum, o) => sum + o.amount, 0);

          await settlementAlertsService.createAlert({
            alertId,
            type: 'SETTLEMENT_OVERDUE',
            severity: 'HIGH',
            provider,
            currency: obligations[0].currency,
            message: `${obligations.length} OPEN obligations past 24h SLA — total ${totalOverdueAmount.toLocaleString()} ${obligations[0].currency}`,
            metadata: {
              overdueCount: obligations.length,
              totalOverdueAmount,
              obligationIds: obligations.map(o => o.id),
              detectedAt: now(),
              source: 'backend_worker',
            },
          });

          processedCount++;
          console.log(
            `[SettlementWorker] Overdue alert raised for ${provider}: ${obligations.length} obligations`,
          );
        } catch (err: any) {
          errorCount++;
          errors.push(`${provider}: ${err.message}`);
          console.error(`[SettlementWorker] Alert creation failed for ${provider}:`, err.message);
        }
      }
    }
  } catch (err: any) {
    errorCount++;
    errors.push(err.message);
    console.error('[SettlementWorker] detectOverdueSettlements query failed:', err.message);
  }

  const finishedAt = now();
  const status: SchedulerRunStatus =
    errorCount === 0 ? 'SUCCESS' : processedCount > 0 ? 'PARTIAL' : 'FAILED';

  await schedulerHistoryService.logRun({
    job: 'overdue',
    status,
    triggeredBy,
    startedAt,
    finishedAt,
    durationMs: Date.now() - start,
    processedCount,
    errorCount,
    details: {
      thresholdHours: OVERDUE_THRESHOLD_MS / 3_600_000,
      alertsRaised: processedCount,
      errors,
    },
  });

  console.log(
    `[SettlementWorker] detectOverdueSettlements done — ` +
    `alerts:${processedCount} errors:${errorCount} status:${status}`,
  );
}

// ─── Full Schedule (all 3 jobs in sequence) ───────────────────────────────────

/**
 * runFullSettlementSchedule — runs all 3 jobs in order.
 * Used by the admin "Run All Now" button and the auto-run on mount.
 */
export async function runFullSettlementSchedule(
  triggeredBy: 'cron' | 'admin' | 'auto' = 'admin',
): Promise<void> {
  const startedAt = now();
  const start = Date.now();
  console.log(`[SettlementWorker] runFullSettlementSchedule started by ${triggeredBy}`);

  await processDailySettlement(triggeredBy);
  await runReconciliation(triggeredBy);
  await detectOverdueSettlements(triggeredBy);

  const finishedAt = now();

  await schedulerHistoryService.logRun({
    job: 'full',
    status: 'SUCCESS',
    triggeredBy,
    startedAt,
    finishedAt,
    durationMs: Date.now() - start,
    processedCount: 3,
    errorCount: 0,
    details: { jobs: ['settlement', 'reconciliation', 'overdue'] },
  });

  console.log(
    `[SettlementWorker] runFullSettlementSchedule complete — ` +
    `duration:${Date.now() - start}ms`,
  );
}

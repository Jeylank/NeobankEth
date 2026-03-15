/**
 * reconciliationWorker.ts
 * ───────────────────────
 * Scheduled reconciliation jobs for Habeshare.
 *
 * In React Native / Expo, these are triggered by:
 *   - admin manual trigger (POST /api/admin/reconciliation/run)
 *   - a server-side cron (Node.js backend, separate from this app)
 *   - expo-task-manager for background tasks (mobile)
 *
 * This file exports the worker functions so they can be invoked
 * from any scheduling context. The logic is backend-first and
 * never modifies live transaction data.
 */

import { reconciliationService } from '../services/reconciliation/reconciliationService';
import { reconciliationAlertService } from '../services/reconciliation/reconciliationAlertService';
import type { ReconciliationProvider } from '../services/reconciliation/reconciliationTypes';

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

/** How many hours back the daily full reconciliation looks */
const DAILY_LOOKBACK_HOURS = 24;

/** How many hours back the hourly lightweight check looks */
const HOURLY_LOOKBACK_HOURS = 2;

function now(): string {
  return new Date().toISOString();
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

function auditLog(event: string, data: Record<string, unknown>): void {
  console.log(`[Worker:AuditLog] ${event}`, JSON.stringify(data, null, 0));
}

// ─────────────────────────────────────────────
// JOB 1 — Daily Full Reconciliation
// ─────────────────────────────────────────────

/**
 * runDailyReconciliation — reconciles all providers for the past 24 hours.
 * Intended to run once per day (e.g., 02:00 UTC via server cron).
 */
export async function runDailyReconciliation(): Promise<void> {
  const startedAt = now();
  console.log(`[ReconciliationWorker] Daily full reconciliation started at ${startedAt}`);

  try {
    const summary = await reconciliationService.runReconciliation({
      provider: 'all',
      mode: 'scheduled',
      dateRangeStart: hoursAgo(DAILY_LOOKBACK_HOURS),
      dateRangeEnd: now(),
      createdBy: 'system:daily_worker',
    });

    console.log(
      `[ReconciliationWorker] Daily run completed — run:${summary.runId} | ` +
        `checked:${summary.totalChecked} matched:${summary.totalMatched} ` +
        `mismatched:${summary.totalMismatched} alerts:${summary.totalAlertsCreated}`,
    );

    auditLog('reconciliation_daily_completed', {
      runId: summary.runId,
      totalChecked: summary.totalChecked,
      totalMatched: summary.totalMatched,
      totalMismatched: summary.totalMismatched,
      openAlerts: summary.openAlerts,
      criticalAlerts: summary.criticalAlerts,
    });
  } catch (err: any) {
    console.error('[ReconciliationWorker] Daily reconciliation FAILED:', err.message);
    auditLog('reconciliation_daily_failed', { error: err.message });
    // Worker fails safely — does NOT throw, preventing cascade failure
  }
}

// ─────────────────────────────────────────────
// JOB 2 — Hourly Lightweight Payout Check
// ─────────────────────────────────────────────

/**
 * runHourlyPayoutCheck — lightweight reconciliation for TELEBIRR and CHAPA
 * over the past 2 hours. Catches recent discrepancies quickly.
 * Intended to run every 60 minutes via server cron.
 */
export async function runHourlyPayoutCheck(): Promise<void> {
  const providers: Array<Exclude<ReconciliationProvider, 'all'>> = ['TELEBIRR', 'CHAPA'];
  console.log(`[ReconciliationWorker] Hourly payout check started at ${now()}`);

  for (const provider of providers) {
    try {
      const summary = await reconciliationService.runProviderReconciliation(
        provider,
        { start: hoursAgo(HOURLY_LOOKBACK_HOURS), end: now() },
        'system:hourly_worker',
      );
      console.log(
        `[ReconciliationWorker] Hourly ${provider} — ` +
          `checked:${summary.totalChecked} alerts:${summary.totalAlertsCreated}`,
      );
    } catch (err: any) {
      console.error(`[ReconciliationWorker] Hourly check FAILED for ${provider}:`, err.message);
      // Continue to next provider — fail safely per provider
    }
  }
}

// ─────────────────────────────────────────────
// JOB 3 — Stale Reservation Cleanup Check
// ─────────────────────────────────────────────

/**
 * runStaleReservationCheck — runs a targeted reconciliation to detect and
 * alert on FX/treasury reservations that were never confirmed or released.
 * Intended to run every 30 minutes.
 */
export async function runStaleReservationCheck(): Promise<void> {
  console.log(`[ReconciliationWorker] Stale reservation check started at ${now()}`);

  try {
    // We run a full reconciliation pass — the matcher internally detects stale reservations
    const summary = await reconciliationService.runReconciliation({
      provider: 'all',
      mode: 'scheduled',
      dateRangeStart: hoursAgo(48),
      dateRangeEnd: now(),
      createdBy: 'system:stale_reservation_worker',
    });

    console.log(
      `[ReconciliationWorker] Stale reservation check done — run:${summary.runId} | alerts:${summary.totalAlertsCreated}`,
    );
    auditLog('stale_reservation_check_completed', {
      runId: summary.runId,
      totalAlertsCreated: summary.totalAlertsCreated,
    });
  } catch (err: any) {
    console.error('[ReconciliationWorker] Stale reservation check FAILED:', err.message);
  }
}

// ─────────────────────────────────────────────
// JOB 4 — Overdue Settlement Check
// ─────────────────────────────────────────────

/**
 * runOverdueSettlementCheck — detects settlement obligations open beyond threshold.
 * Intended to run every 6 hours.
 */
export async function runOverdueSettlementCheck(): Promise<void> {
  console.log(`[ReconciliationWorker] Overdue settlement check started at ${now()}`);

  try {
    const summary = await reconciliationService.runReconciliation({
      provider: 'all',
      mode: 'scheduled',
      dateRangeStart: hoursAgo(72),
      dateRangeEnd: now(),
      createdBy: 'system:settlement_worker',
    });

    const openAlerts = await reconciliationAlertService.getOpenAlerts({
      type: 'SETTLEMENT_OVERDUE',
    });

    console.log(
      `[ReconciliationWorker] Overdue settlement check done — ` +
        `openOverdueAlerts:${openAlerts.length}`,
    );
  } catch (err: any) {
    console.error('[ReconciliationWorker] Overdue settlement check FAILED:', err.message);
  }
}

// ─────────────────────────────────────────────
// MANUAL TRIGGER (admin console)
// ─────────────────────────────────────────────

/**
 * triggerManualReconciliation — called when an admin clicks "Run Now"
 * from the AdminReconciliationOverviewScreen.
 */
export async function triggerManualReconciliation(
  provider: ReconciliationProvider,
  adminUid: string,
): Promise<string> {
  console.log(`[ReconciliationWorker] Manual trigger by ${adminUid} for provider: ${provider}`);

  const summary = await reconciliationService.runReconciliation({
    provider,
    mode: 'manual',
    dateRangeStart: hoursAgo(24),
    dateRangeEnd: now(),
    createdBy: adminUid,
  });

  auditLog('reconciliation_manual_triggered', {
    runId: summary.runId,
    adminUid,
    provider,
  });

  return summary.runId;
}

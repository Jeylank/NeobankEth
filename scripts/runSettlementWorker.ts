/**
 * runSettlementWorker.ts
 * ───────────────────────
 * Standalone Node.js cron process for Sumsuma settlement automation.
 *
 * Run with:
 *   npm run worker:settlement
 *
 * Schedules:
 *   02:00 daily  — processDailySettlement  (batch OPEN obligations)
 *   03:00 daily  — runReconciliation        (compare batches vs provider reports)
 *   every hour   — detectOverdueSettlements (flag obligations past 24h SLA)
 *
 * Safety:
 *   - Each job runs in an isolated try/catch — one failure does not abort others
 *   - All runs logged to Firestore `scheduler_runs` regardless of outcome
 *   - Process never exits on job failure; cron continues indefinitely
 *
 * To stop: Ctrl+C (SIGINT)
 */

import * as cron from 'node-cron';
import {
  processDailySettlement,
  runReconciliation,
  detectOverdueSettlements,
} from '../src/workers/settlementWorker';

// ─── Boot ─────────────────────────────────────────────────────────────────────

const START_TIME = new Date().toISOString();
console.log('='.repeat(60));
console.log(`[SettlementWorker] Process started at ${START_TIME}`);
console.log('[SettlementWorker] Registered schedules:');
console.log('  02:00 daily  → processDailySettlement');
console.log('  03:00 daily  → runReconciliation');
console.log('  hourly       → detectOverdueSettlements');
console.log('='.repeat(60));

// ─── Job Wrapper ─────────────────────────────────────────────────────────────

async function runJob(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n[SettlementWorker] ▶ Starting job: ${name} at ${new Date().toISOString()}`);
  try {
    await fn();
    console.log(`[SettlementWorker] ✓ Job complete: ${name}`);
  } catch (err: any) {
    // Non-fatal — job is already logged internally by the worker function.
    // This outer catch is a final safety net to prevent process exit.
    console.error(`[SettlementWorker] ✗ Unhandled error in job ${name}:`, err.message);
  }
}

// ─── Schedules ───────────────────────────────────────────────────────────────

// Daily settlement batching — 02:00 UTC every day
cron.schedule('0 2 * * *', () => {
  runJob('processDailySettlement', () => processDailySettlement('cron'));
}, { timezone: 'UTC' });

// Daily reconciliation — 03:00 UTC every day (runs after batching completes)
cron.schedule('0 3 * * *', () => {
  runJob('runReconciliation', () => runReconciliation('cron'));
}, { timezone: 'UTC' });

// Overdue detection — every hour at :00
cron.schedule('0 * * * *', () => {
  runJob('detectOverdueSettlements', () => detectOverdueSettlements('cron'));
}, { timezone: 'UTC' });

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n[SettlementWorker] Received SIGINT — shutting down gracefully.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[SettlementWorker] Received SIGTERM — shutting down gracefully.');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[SettlementWorker] Uncaught exception (process will continue):', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[SettlementWorker] Unhandled rejection (process will continue):', reason);
});

console.log('[SettlementWorker] All cron jobs registered. Waiting for scheduled times…');

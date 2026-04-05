/**
 * runRecurringSupportWorker.ts
 * ─────────────────────────────
 * Standalone Node.js cron process for Sumsuma recurring support automation.
 *
 * Run with:
 *   npm run worker:recurring-support
 *
 * Schedule:
 *   Every hour — processRecurringSupport
 *     Queries all active recurring schedules due for execution across all users,
 *     validates each one, creates payout jobs, logs to scheduler_runs.
 *
 * Safety:
 *   - Per-schedule errors are isolated — one failure does not abort the batch
 *   - All runs logged to Firestore scheduler_runs regardless of outcome
 *   - nextPayoutDate is ONLY advanced on successful payout job creation
 *   - Process never exits on job failure; cron continues indefinitely
 *
 * To stop: Ctrl+C (SIGINT)
 */

import * as cron from 'node-cron';
import { processRecurringSupport } from '../src/workers/recurringSupportWorker';

// ─── Boot ─────────────────────────────────────────────────────────────────────

const START_TIME = new Date().toISOString();
console.log('='.repeat(60));
console.log(`[RecurringSupportWorker] Process started at ${START_TIME}`);
console.log('[RecurringSupportWorker] Registered schedules:');
console.log('  0 * * * *  → processRecurringSupport (every hour)');
console.log('='.repeat(60));

// ─── Job Wrapper ──────────────────────────────────────────────────────────────

async function runJob(name: string, fn: () => Promise<any>): Promise<void> {
  const start = Date.now();
  console.log(`\n[${new Date().toISOString()}] ▶ Starting job: ${name}`);
  try {
    const result = await fn();
    const duration = Date.now() - start;
    const status = result?.status ?? 'DONE';
    console.log(`[${new Date().toISOString()}] ✓ Completed ${name} — ${status} in ${duration}ms`);
    if (result?.processedCount !== undefined) {
      console.log(
        `    Processed: ${result.processedCount} | Success: ${result.successCount} | Failed: ${result.failedCount}`
      );
    }
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] ✗ Job ${name} threw unexpectedly:`, err.message);
  }
}

// ─── Cron Schedule ────────────────────────────────────────────────────────────

// Every hour at minute 0
cron.schedule('0 * * * *', () => {
  runJob('processRecurringSupport', () => processRecurringSupport('cron'));
});

// ─── Startup Run ──────────────────────────────────────────────────────────────
// Run once immediately on process start so any schedules due right now
// are processed without waiting for the first hourly tick.

setTimeout(() => {
  runJob('processRecurringSupport [startup]', () => processRecurringSupport('cron'));
}, 3_000);

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n[RecurringSupportWorker] SIGINT received — shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[RecurringSupportWorker] SIGTERM received — shutting down gracefully');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[RecurringSupportWorker] Uncaught exception (process continues):', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[RecurringSupportWorker] Unhandled rejection (process continues):', reason);
});

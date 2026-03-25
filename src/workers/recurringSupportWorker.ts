/**
 * recurringSupportWorker.ts
 * ──────────────────────────
 * Backend cron worker for automated recurring support execution.
 *
 * Runs hourly from scripts/runRecurringSupportWorker.ts.
 * Can also be triggered manually from the admin console.
 *
 * For each active recurring schedule whose nextPayoutDate is due:
 *   1. Validate user status
 *   2. Validate amount > 0 and currency is set
 *   3. Create payout job in job_queue
 *   4. Write execution record to scheduled_support_executions
 *   5. On SUCCESS: advance nextPayoutDate, update lastPayoutDate + totalSent
 *   6. On FAILURE: write failure reason, do NOT advance nextPayoutDate, queue DLQ
 *
 * Run isolation:
 *   - All runs logged to scheduler_runs regardless of outcome
 *   - Per-schedule errors are isolated — one failure does not abort the batch
 *   - Non-throwing top level — process never crashes
 *
 * NOTE: This is a Node.js worker. It does NOT use AsyncStorage, React Native,
 * or any client-only APIs. It communicates with Firestore directly via
 * the Firebase client SDK (same as settlementWorker.ts pattern).
 */

import {
  collection,
  collectionGroup,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  getDoc,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { scheduledSupportExecutionService } from '../services/recurringSupport/scheduledSupportExecutionService';
import type { RecurringSupportSchedulerRun } from '../services/recurringSupport/scheduledSupportExecutionService';
import {
  clientRiskService,
  FeatureDisabledError,
  UserFrozenError,
  ReviewRequiredError,
  LimitExceededError,
  VelocityLimitExceededError,
} from '../services/riskControls/clientRiskService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoNow(): string {
  return new Date().toISOString();
}

function calculateNextDate(frequency: string, fromDate: string): string {
  const d = new Date(fromDate);
  switch (frequency) {
    case 'weekly':     d.setDate(d.getDate() + 7);     break;
    case 'biweekly':   d.setDate(d.getDate() + 14);    break;
    case 'monthly':    d.setMonth(d.getMonth() + 1);   break;
    case 'quarterly':  d.setMonth(d.getMonth() + 3);   break;
    case 'semester':   d.setMonth(d.getMonth() + 6);   break;
    default:           d.setMonth(d.getMonth() + 1);   break;
  }
  return d.toISOString();
}

type PayoutMethod = 'telebirr' | 'direct_transfer' | 'cash_pickup';

const PAYOUT_METHOD_MAP: Record<PayoutMethod, string> = {
  telebirr: 'mobile_wallet',
  direct_transfer: 'bank_account',
  cash_pickup: 'cash_pickup',
};

// ─── Validation ───────────────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

async function validateUserStatus(userId: string): Promise<ValidationResult> {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (!userDoc.exists()) {
      return { valid: false, reason: `User ${userId} not found` };
    }
    const data = userDoc.data();
    if (data?.status === 'suspended' || data?.status === 'blocked') {
      return { valid: false, reason: `User ${userId} is ${data.status}` };
    }
    return { valid: true };
  } catch (err: any) {
    return { valid: false, reason: `User validation error: ${err.message}` };
  }
}

function validateScheduleData(schedule: any): ValidationResult {
  if (!schedule.amount || schedule.amount <= 0) {
    return { valid: false, reason: 'Invalid amount: must be > 0' };
  }
  if (!schedule.currency) {
    return { valid: false, reason: 'Missing currency' };
  }
  if (!schedule.memberId) {
    return { valid: false, reason: 'Missing memberId' };
  }
  return { valid: true };
}

// ─── Main Worker ──────────────────────────────────────────────────────────────

/**
 * processRecurringSupport
 * ──────────────────────────
 * Queries all active recurring schedules due for execution across all users,
 * validates each one, creates payout jobs, and logs the full run.
 *
 * @param triggeredBy  'cron' (from node-cron) | 'admin' (from admin console)
 */
export async function processRecurringSupport(
  triggeredBy: 'cron' | 'admin' = 'cron',
): Promise<RecurringSupportSchedulerRun> {
  const startedAt = isoNow();
  const startMs = Date.now();

  console.log(`[RecurringSupportWorker] Run starting at ${startedAt} (trigger: ${triggeredBy})`);

  const errors: Array<{ scheduleId: string; userId: string; reason: string }> = [];
  let processedCount = 0;
  let successCount = 0;
  let failedCount = 0;

  // Create a placeholder run ID so executions can reference it
  // We'll update it with the actual run details at the end
  const runIdPlaceholder = `rs_run_${Date.now()}`;

  try {
    // ── Global kill switch check ──────────────────────────────────────────
    try {
      await clientRiskService.checkKillSwitch('recurring_support_enabled');
    } catch (killSwitchErr) {
      const reason = killSwitchErr instanceof FeatureDisabledError
        ? 'Kill switch: recurring_support_enabled is OFF'
        : 'Risk controls unavailable';
      console.warn(`[RecurringSupportWorker] ${reason} — aborting run`);
      errors.push({ scheduleId: 'GLOBAL', userId: 'N/A', reason });
      const abortDuration = Date.now() - startMs;
      await scheduledSupportExecutionService.logRun({
        jobType: 'RECURRING_SUPPORT',
        triggeredBy,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: abortDuration,
        processedCount: 0,
        successCount: 0,
        failedCount: 0,
        errors,
        status: 'FAILED',
      });
      return {
        runId: runIdPlaceholder,
        jobType: 'RECURRING_SUPPORT',
        triggeredBy,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: abortDuration,
        processedCount: 0,
        successCount: 0,
        failedCount: 0,
        errors,
        status: 'FAILED',
      };
    }

    // ── Query all due recurring schedules via collectionGroup ──
    const now = isoNow();
    const schedulesQuery = query(
      collectionGroup(db, 'recurring_schedules'),
      where('status', '==', 'active'),
      where('nextPayoutDate', '<=', now),
    );

    const schedulesSnap = await getDocs(schedulesQuery);
    const schedules = schedulesSnap.docs.map(d => ({
      id: d.id,
      ref: d.ref,
      ...d.data(),
    }));

    console.log(`[RecurringSupportWorker] Found ${schedules.length} due schedule(s)`);

    // ── Process each schedule ──
    for (const schedule of schedules) {
      processedCount++;
      const scheduleId = schedule.id;
      // Extract userId from the Firestore path: users/{userId}/recurring_schedules/{scheduleId}
      const pathSegments = schedule.ref.path.split('/');
      const userId = pathSegments[1] ?? 'unknown';
      const executedAt = isoNow();

      try {
        // 0. Risk Controls — check user state and limits before anything
        try {
          await clientRiskService.runRecurringSupportChecks(userId, schedule.amount ?? 0, schedule.currency ?? 'USD');
        } catch (riskErr: any) {
          if (riskErr instanceof UserFrozenError || riskErr instanceof ReviewRequiredError) {
            // Soft skip: user frozen or in review — write an audit entry, do NOT DLQ
            console.warn(`[RecurringSupportWorker] Skipping schedule ${scheduleId} (user ${userId}): ${riskErr.message}`);
            try {
              await addDoc(collection(db, 'users', userId, 'recurring_audit_log'), {
                action: 'execution_skipped_risk',
                scheduleId,
                details: {
                  riskCode: riskErr.code,
                  reason: riskErr.message,
                  triggeredBy,
                },
                timestamp: executedAt,
                createdAt: executedAt,
              });
            } catch (_) {}
            failedCount++;
            errors.push({ scheduleId, userId, reason: `Risk skip: ${riskErr.code} — ${riskErr.message}` });
            continue;
          }
          // Hard block (kill switch, limit exceeded, velocity) — fall through to normal error path
          throw riskErr;
        }

        // 1. Validate user status
        const userValidation = await validateUserStatus(userId);
        if (!userValidation.valid) {
          throw new Error(userValidation.reason);
        }

        // 2. Validate schedule data
        const dataValidation = validateScheduleData(schedule);
        if (!dataValidation.valid) {
          throw new Error(dataValidation.reason);
        }

        // 3. Write execution record (initial state)
        const executionId = await scheduledSupportExecutionService.createExecution({
          schedulerRunId: runIdPlaceholder,
          scheduledSupportId: scheduleId,
          userId,
          familyMemberId: schedule.memberId ?? '',
          memberName: schedule.memberName ?? '',
          amount: schedule.amount,
          currency: schedule.currency,
          payoutMethod: schedule.payoutMethod ?? 'direct_transfer',
          frequency: schedule.frequency ?? 'monthly',
          status: 'RETRYING',
          failureReason: null,
          txId: null,
          executedAt,
        });

        // 4. Create payout job in job_queue
        const payoutJobRef = await addDoc(collection(db, 'job_queue'), {
          jobType: 'RECURRING_SUPPORT_PAYOUT',
          status: 'PENDING',
          createdAt: executedAt,
          scheduledSupportId: scheduleId,
          executionId,
          userId,
          payload: {
            amount: schedule.amount,
            fromCurrency: schedule.currency,
            toCurrency: 'ETB',
            familyMemberId: schedule.memberId ?? '',
            memberName: schedule.memberName ?? '',
            payoutMethod: PAYOUT_METHOD_MAP[schedule.payoutMethod as PayoutMethod] ?? 'bank_account',
            description: `Recurring Support: ${schedule.memberName ?? 'Family member'}${schedule.note ? ' – ' + schedule.note : ''}`,
          },
          retryCount: 0,
          maxRetries: 3,
        });

        const txId = payoutJobRef.id;

        // 5. Mark execution SUCCESS
        await scheduledSupportExecutionService.updateExecution(executionId, {
          status: 'SUCCESS',
          txId,
          failureReason: null,
        });

        // 6. Advance nextPayoutDate + update schedule metadata (only on success)
        const nextPayoutDate = calculateNextDate(schedule.frequency ?? 'monthly', schedule.nextPayoutDate);
        await updateDoc(schedule.ref, {
          nextPayoutDate,
          lastPayoutDate: executedAt,
          lastPayoutStatus: 'sent',
          totalSent: (schedule.totalSent ?? 0) + 1,
          totalPayouts: (schedule.totalPayouts ?? 0) + 1,
          updatedAt: executedAt,
        });

        // 7. Write per-user audit log
        const auditRef = collection(db, 'users', userId, 'recurring_audit_log');
        await addDoc(auditRef, {
          action: 'execution_sent',
          scheduleId,
          details: {
            executionId,
            txId,
            memberName: schedule.memberName,
            amount: schedule.amount,
            currency: schedule.currency,
            nextPayoutDate,
            triggeredBy,
          },
          timestamp: executedAt,
          createdAt: executedAt,
        });

        successCount++;
        console.log(`[RecurringSupportWorker] ✓ Schedule ${scheduleId} (user ${userId}) — txId: ${txId}`);

      } catch (scheduleError: any) {
        failedCount++;
        const reason = scheduleError.message ?? 'Unknown error';
        errors.push({ scheduleId, userId, reason });

        // ── Write FAILED execution record ──
        const executionId = await scheduledSupportExecutionService.createExecution({
          schedulerRunId: runIdPlaceholder,
          scheduledSupportId: scheduleId,
          userId,
          familyMemberId: schedule.memberId ?? '',
          memberName: schedule.memberName ?? '',
          amount: schedule.amount ?? 0,
          currency: schedule.currency ?? 'USD',
          payoutMethod: schedule.payoutMethod ?? 'direct_transfer',
          frequency: schedule.frequency ?? 'monthly',
          status: 'FAILED',
          failureReason: reason,
          txId: null,
          executedAt,
        });

        // ── Write to DLQ for retry ──
        try {
          await addDoc(collection(db, 'dead_letter_queue'), {
            jobType: 'RECURRING_SUPPORT_PAYOUT',
            status: 'DEAD',
            failedAt: executedAt,
            scheduledSupportId: scheduleId,
            executionId,
            userId,
            failureReason: reason,
            retryCount: 3,
            maxRetries: 3,
            payload: {
              amount: schedule.amount ?? 0,
              currency: schedule.currency ?? 'USD',
              memberId: schedule.memberId ?? '',
              memberName: schedule.memberName ?? '',
            },
          });
        } catch (dlqErr: any) {
          console.warn(`[RecurringSupportWorker] DLQ write failed for ${scheduleId}:`, dlqErr.message);
        }

        // ── Write per-user audit log for failure ──
        try {
          const auditRef = collection(db, 'users', userId, 'recurring_audit_log');
          await addDoc(auditRef, {
            action: 'execution_failed',
            scheduleId,
            details: { executionId, error: reason, triggeredBy },
            timestamp: executedAt,
            createdAt: executedAt,
          });
        } catch (_) {}

        console.error(`[RecurringSupportWorker] ✗ Schedule ${scheduleId} (user ${userId}) — ${reason}`);
      }
    }

  } catch (globalError: any) {
    const reason = `Global worker error: ${globalError.message}`;
    errors.push({ scheduleId: 'GLOBAL', userId: 'N/A', reason });
    console.error('[RecurringSupportWorker] Fatal error:', globalError.message);
  }

  // ── Determine run status ──
  const status =
    failedCount === 0 && processedCount > 0 ? 'SUCCESS' :
    failedCount === processedCount && processedCount > 0 ? 'FAILED' :
    processedCount === 0 ? 'SUCCESS' :
    'PARTIAL';

  const finishedAt = isoNow();
  const durationMs = Date.now() - startMs;

  // ── Log run to scheduler_runs ──
  const runPayload: Omit<RecurringSupportSchedulerRun, 'runId'> = {
    jobType: 'RECURRING_SUPPORT',
    startedAt,
    finishedAt,
    status,
    processedCount,
    successCount,
    failedCount,
    errors,
    triggeredBy,
    durationMs,
  };

  const runId = await scheduledSupportExecutionService.logRun(runPayload);

  console.log(`[RecurringSupportWorker] Run ${runId} complete — ${status} in ${durationMs}ms`);
  console.log(`[RecurringSupportWorker] Processed: ${processedCount} | Success: ${successCount} | Failed: ${failedCount}`);

  return { runId, ...runPayload };
}

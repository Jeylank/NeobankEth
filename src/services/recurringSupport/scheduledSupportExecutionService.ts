/**
 * scheduledSupportExecutionService.ts
 * ─────────────────────────────────────
 * Manages the top-level `scheduled_support_executions` Firestore collection.
 *
 * Every time the recurring support worker runs and processes a schedule item,
 * it writes an execution record here — SUCCESS or FAILED. This gives admins
 * a queryable, cross-user audit trail independent of the per-user subcollections.
 *
 * Also provides:
 *   - getSchedulerRuns()          — list recent scheduler_runs of type recurring_support
 *   - getSchedulerRunDetails()    — list executions for a specific runId
 *
 * Collections:
 *   scheduled_support_executions/{executionId}
 *   scheduler_runs/{runId}   (shared with settlement worker, filtered by jobType)
 */

import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  doc,
  updateDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExecutionStatus = 'SUCCESS' | 'FAILED' | 'RETRYING';

export interface ScheduledSupportExecution {
  executionId: string;
  schedulerRunId: string;
  scheduledSupportId: string;
  userId: string;
  familyMemberId: string;
  memberName: string;
  amount: number;
  currency: string;
  payoutMethod: string;
  frequency: string;
  status: ExecutionStatus;
  failureReason: string | null;
  txId: string | null;
  executedAt: string;
  createdAt: string;
}

export interface RecurringSupportSchedulerRun {
  runId: string;
  jobType: 'RECURRING_SUPPORT';
  startedAt: string;
  finishedAt: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  processedCount: number;
  successCount: number;
  failedCount: number;
  errors: Array<{ scheduleId: string; userId: string; reason: string }>;
  triggeredBy: 'cron' | 'admin';
  durationMs: number;
}

const EXECUTIONS_COL = 'scheduled_support_executions';
const RUNS_COL = 'scheduler_runs';

function isoNow(): string {
  return new Date().toISOString();
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const scheduledSupportExecutionService = {

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * createExecution — write a new execution record (queued/in-progress).
   * Returns the Firestore-assigned executionId.
   */
  async createExecution(
    data: Omit<ScheduledSupportExecution, 'executionId' | 'createdAt'>,
  ): Promise<string> {
    try {
      const now = isoNow();
      const docRef = await addDoc(collection(db, EXECUTIONS_COL), {
        ...data,
        createdAt: now,
      });
      return docRef.id;
    } catch (err: any) {
      console.error('[ScheduledSupportExecution] createExecution error:', err.message);
      return `local_${Date.now()}`;
    }
  },

  /**
   * updateExecution — update status, txId, failureReason after the payout attempt.
   */
  async updateExecution(
    executionId: string,
    updates: Partial<Pick<ScheduledSupportExecution, 'status' | 'txId' | 'failureReason'>>,
  ): Promise<void> {
    try {
      if (executionId.startsWith('local_')) return;
      await updateDoc(doc(db, EXECUTIONS_COL, executionId), updates);
    } catch (err: any) {
      console.warn('[ScheduledSupportExecution] updateExecution error:', err.message);
    }
  },

  /**
   * logRun — write a completed RECURRING_SUPPORT scheduler run to scheduler_runs.
   */
  async logRun(
    run: Omit<RecurringSupportSchedulerRun, 'runId'>,
  ): Promise<string> {
    try {
      const docRef = await addDoc(collection(db, RUNS_COL), {
        ...run,
        job: 'recurring_support',
        createdAt: isoNow(),
      });
      return docRef.id;
    } catch (err: any) {
      console.warn('[ScheduledSupportExecution] logRun error (non-fatal):', err.message);
      return 'local-only';
    }
  },

  // ── Admin Reads ────────────────────────────────────────────────────────────

  /**
   * getSchedulerRuns — paginated list of recent RECURRING_SUPPORT cron runs.
   */
  async getSchedulerRuns(
    maxRuns = 50,
  ): Promise<RecurringSupportSchedulerRun[]> {
    try {
      const q = query(
        collection(db, RUNS_COL),
        where('job', '==', 'recurring_support'),
        orderBy('startedAt', 'desc'),
        limit(maxRuns),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({
        runId: d.id,
        ...d.data(),
      } as RecurringSupportSchedulerRun));
    } catch (err: any) {
      console.error('[ScheduledSupportExecution] getSchedulerRuns error:', err.message);
      return [];
    }
  },

  /**
   * getSchedulerRunDetails — list all execution records for a specific run.
   */
  async getSchedulerRunDetails(runId: string): Promise<ScheduledSupportExecution[]> {
    try {
      const q = query(
        collection(db, EXECUTIONS_COL),
        where('schedulerRunId', '==', runId),
        orderBy('executedAt', 'desc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({
        executionId: d.id,
        ...d.data(),
      } as ScheduledSupportExecution));
    } catch (err: any) {
      console.error('[ScheduledSupportExecution] getSchedulerRunDetails error:', err.message);
      return [];
    }
  },

  /**
   * getRecentFailedExecutions — recent FAILED executions across all runs.
   */
  async getRecentFailedExecutions(maxItems = 20): Promise<ScheduledSupportExecution[]> {
    try {
      const q = query(
        collection(db, EXECUTIONS_COL),
        where('status', '==', 'FAILED'),
        orderBy('executedAt', 'desc'),
        limit(maxItems),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({
        executionId: d.id,
        ...d.data(),
      } as ScheduledSupportExecution));
    } catch (err: any) {
      console.error('[ScheduledSupportExecution] getRecentFailedExecutions error:', err.message);
      return [];
    }
  },
};

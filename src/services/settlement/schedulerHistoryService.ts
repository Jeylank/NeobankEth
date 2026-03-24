/**
 * schedulerHistoryService.ts
 * ──────────────────────────
 * Manages the `scheduler_runs` Firestore collection.
 *
 * Every cron execution — whether triggered by the backend worker,
 * the admin "Run Now" button, or the auto-run on mount — is logged
 * here so admins can review history, spot failures, and audit trends.
 *
 * Collection: scheduler_runs/{runId}
 */

import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  where,
  doc,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SchedulerJobName = 'settlement' | 'reconciliation' | 'overdue' | 'full';

export type SchedulerRunStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

export type SchedulerTrigger = 'cron' | 'admin' | 'auto';

export interface SchedulerRunRecord {
  runId: string;
  job: SchedulerJobName;
  status: SchedulerRunStatus;
  triggeredBy: SchedulerTrigger;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  processedCount: number;
  errorCount: number;
  details: Record<string, unknown>;
}

export interface SchedulerHistoryQuery {
  job?: SchedulerJobName;
  limit?: number;
}

const COL = 'scheduler_runs';
const LATEST_DOC = 'latest_summary';

function now(): string {
  return new Date().toISOString();
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const schedulerHistoryService = {
  /**
   * logRun — write a completed run record to Firestore.
   * Called by each worker job after finishing (success or failure).
   */
  async logRun(
    record: Omit<SchedulerRunRecord, 'runId'>,
  ): Promise<string> {
    try {
      const docRef = await addDoc(collection(db, COL), {
        ...record,
        createdAt: now(),
      });

      // Keep a lightweight summary document for quick last-run lookups
      await setDoc(doc(db, COL, LATEST_DOC), {
        lastUpdated: now(),
        [record.job]: {
          runId: docRef.id,
          status: record.status,
          finishedAt: record.finishedAt,
          processedCount: record.processedCount,
          errorCount: record.errorCount,
        },
      }, { merge: true });

      return docRef.id;
    } catch (err: any) {
      console.warn('[SchedulerHistory] Firestore write failed (non-fatal):', err.message);
      return 'local-only';
    }
  },

  /**
   * getHistory — paginated query of recent scheduler runs.
   * Optionally filter by job type.
   */
  async getHistory(options: SchedulerHistoryQuery = {}): Promise<SchedulerRunRecord[]> {
    try {
      const constraints: any[] = [orderBy('startedAt', 'desc'), limit(options.limit ?? 50)];
      if (options.job) {
        constraints.unshift(where('job', '==', options.job));
      }

      const snap = await getDocs(query(collection(db, COL), ...constraints));
      return snap.docs
        .filter(d => d.id !== LATEST_DOC)
        .map(d => ({ runId: d.id, ...d.data() } as SchedulerRunRecord));
    } catch (err: any) {
      console.error('[SchedulerHistory] getHistory error:', err.message);
      return [];
    }
  },

  /**
   * getStats — aggregate counts across recent runs for dashboard display.
   */
  async getStats(): Promise<{
    totalRuns: number;
    successCount: number;
    partialCount: number;
    failedCount: number;
    lastSettlementRun: string | null;
    lastReconciliationRun: string | null;
    lastOverdueRun: string | null;
  }> {
    try {
      const records = await this.getHistory({ limit: 100 });
      const successCount = records.filter(r => r.status === 'SUCCESS').length;
      const partialCount = records.filter(r => r.status === 'PARTIAL').length;
      const failedCount = records.filter(r => r.status === 'FAILED').length;

      const lastFor = (job: SchedulerJobName): string | null =>
        records.find(r => r.job === job || r.job === 'full')?.finishedAt ?? null;

      return {
        totalRuns: records.length,
        successCount,
        partialCount,
        failedCount,
        lastSettlementRun: lastFor('settlement'),
        lastReconciliationRun: lastFor('reconciliation'),
        lastOverdueRun: lastFor('overdue'),
      };
    } catch {
      return {
        totalRuns: 0, successCount: 0, partialCount: 0, failedCount: 0,
        lastSettlementRun: null, lastReconciliationRun: null, lastOverdueRun: null,
      };
    }
  },
};

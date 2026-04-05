/**
 * deadLetterQueueService.ts
 * ──────────────────────────
 * Retry + Dead Letter Queue (DLQ) for Sumsuma background jobs.
 *
 * Any job that fails after exhausting retries is moved to the `dead_letter_queue`
 * Firestore collection for manual investigation or replay.
 *
 * Retry schedule (exponential backoff):
 *   Attempt 1 → wait 2 seconds
 *   Attempt 2 → wait 5 seconds
 *   Attempt 3 → wait 15 seconds
 *   After 3 failures → move to dead_letter_queue
 *
 * Usage:
 *   const jobId = await deadLetterQueueService.enqueueJob('PAYOUT', payload);
 *   const result = await deadLetterQueueService.processWithRetry(jobId, async () => {
 *     return await payoutConnector.execute(payload);
 *   });
 *
 * Collections:
 *   job_queue         — active/pending/processing jobs
 *   dead_letter_queue — permanently failed jobs for investigation
 */

import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobType =
  | 'PAYOUT'
  | 'SETTLEMENT_BATCH'
  | 'RECONCILIATION'
  | 'OVERDUE_DETECTION'
  | 'WEBHOOK_PROCESS'
  | 'NOTIFICATION'
  | 'FX_RESERVATION_RELEASE';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead';

export interface JobRecord<T = unknown> {
  jobId: string;
  type: JobType;
  payload: T;
  status: JobStatus;
  attempts: number;
  maxRetries: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  deadAt?: string;
  metadata?: Record<string, unknown>;
}

export interface DLQRecord<T = unknown> extends JobRecord<T> {
  movedToDlqAt: string;
  allErrors: string[];
}

export interface ProcessResult<R = unknown> {
  success: boolean;
  result?: R;
  error?: string;
  attempts: number;
  movedToDlq: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const JOB_QUEUE_COL = 'job_queue';
const DLQ_COL       = 'dead_letter_queue';
const MAX_RETRIES   = 3;

/** Backoff delays in milliseconds for each attempt (0-indexed) */
const BACKOFF_MS = [2_000, 5_000, 15_000];

function now(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const deadLetterQueueService = {
  /**
   * enqueueJob — create a new job record in `job_queue`.
   * Returns the Firestore document ID to pass to processWithRetry.
   */
  async enqueueJob<T = unknown>(
    type: JobType,
    payload: T,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const docRef = await addDoc(collection(db, JOB_QUEUE_COL), {
      type,
      payload,
      status: 'pending' as JobStatus,
      attempts: 0,
      maxRetries: MAX_RETRIES,
      createdAt: now(),
      updatedAt: now(),
      metadata: metadata ?? null,
    } satisfies Omit<JobRecord<T>, 'jobId'>);

    return docRef.id;
  },

  /**
   * processWithRetry — execute fn with automatic retry and backoff.
   * On final failure, moves the job to `dead_letter_queue`.
   *
   * @param jobId   - document ID from enqueueJob
   * @param fn      - async function to execute
   * @param maxRetries - override retry count (default: 3)
   */
  async processWithRetry<R = unknown>(
    jobId: string,
    fn: () => Promise<R>,
    maxRetries: number = MAX_RETRIES,
  ): Promise<ProcessResult<R>> {
    const docRef = doc(db, JOB_QUEUE_COL, jobId);
    const allErrors: string[] = [];
    let attempts = 0;

    // Mark as processing
    await updateDoc(docRef, { status: 'processing', updatedAt: now() });

    while (attempts < maxRetries) {
      try {
        const result = await fn();

        // Success
        await updateDoc(docRef, {
          status: 'completed',
          attempts: attempts + 1,
          completedAt: now(),
          updatedAt: now(),
        });

        return { success: true, result, attempts: attempts + 1, movedToDlq: false };
      } catch (err: any) {
        attempts++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        allErrors.push(`Attempt ${attempts}: ${errorMsg}`);

        console.warn(
          `[DLQ] Job ${jobId} attempt ${attempts}/${maxRetries} failed: ${errorMsg}`,
        );

        await updateDoc(docRef, {
          attempts,
          lastError: errorMsg,
          status: attempts < maxRetries ? 'pending' : 'failed',
          updatedAt: now(),
        });

        if (attempts < maxRetries) {
          const backoffMs = BACKOFF_MS[attempts - 1] ?? 15_000;
          console.log(`[DLQ] Retrying job ${jobId} in ${backoffMs}ms…`);
          await sleep(backoffMs);
        }
      }
    }

    // All retries exhausted — move to DLQ
    await this._moveToDlq(jobId, allErrors);

    return {
      success: false,
      error: allErrors[allErrors.length - 1],
      attempts,
      movedToDlq: true,
    };
  },

  /**
   * _moveToDlq — internal: copy job to dead_letter_queue and mark as dead.
   */
  async _moveToDlq(jobId: string, allErrors: string[]): Promise<void> {
    try {
      const snap = await getDoc(doc(db, JOB_QUEUE_COL, jobId));
      const jobData = snap.exists() ? snap.data() : {};

      const dlqRecord: Omit<DLQRecord, 'jobId'> = {
        ...(jobData as Omit<JobRecord, 'jobId'>),
        status: 'dead',
        allErrors,
        movedToDlqAt: now(),
        updatedAt: now(),
        deadAt: now(),
      };

      await setDoc(doc(db, DLQ_COL, jobId), { jobId, ...dlqRecord });
      await updateDoc(doc(db, JOB_QUEUE_COL, jobId), { status: 'dead', updatedAt: now() });

      console.error(`[DLQ] Job ${jobId} permanently failed after ${allErrors.length} attempts. Moved to dead_letter_queue.`);
    } catch (err: any) {
      console.error(`[DLQ] Failed to write to dead_letter_queue for job ${jobId}:`, err.message);
    }
  },

  /**
   * replayJob — re-enqueue a DLQ job for another processing attempt.
   * Admins can call this from the admin console.
   */
  async replayJob<T = unknown>(
    dlqJobId: string,
    fn: () => Promise<T>,
  ): Promise<ProcessResult<T>> {
    // Get original job data
    const snap = await getDoc(doc(db, DLQ_COL, dlqJobId));
    if (!snap.exists()) throw new Error(`DLQ job ${dlqJobId} not found`);

    const original = snap.data() as DLQRecord<T>;

    // Create fresh job
    const newJobId = await this.enqueueJob(original.type, original.payload, {
      replayOf: dlqJobId,
      replayedAt: now(),
    });

    return this.processWithRetry<T>(newJobId, fn);
  },
};

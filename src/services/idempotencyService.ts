/**
 * idempotencyService.ts
 * ──────────────────────
 * Prevents duplicate transfers and payouts by tracking idempotency keys.
 *
 * Every payout/transfer request should include an `Idempotency-Key` header
 * (client-generated UUID). The service stores the key and its result in
 * Firestore `idempotency_keys`. If the same key is submitted again within
 * the TTL window, the original result is returned without re-processing.
 *
 * This guarantees exactly-once execution for financial operations.
 *
 * Collection: idempotency_keys/{key}
 * TTL: 24 hours (checked on read, not via automated purge)
 */

import {
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { IdempotencyError } from '../middleware/errorHandler';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IdempotencyRecord<T = unknown> {
  key: string;
  userId: string;
  endpoint: string;
  result: T;
  createdAt: string;
  expiresAt: string;
}

export interface IdempotencyCheckResult<T = unknown> {
  isDuplicate: boolean;
  existingResult?: T;
}

const COL = 'idempotency_keys';

/** Default TTL: 24 hours */
const DEFAULT_TTL_HOURS = 24;

function now(): string {
  return new Date().toISOString();
}

function expiresAt(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const idempotencyService = {
  /**
   * check — look up an existing idempotency key.
   * Returns { isDuplicate: false } if not found or expired.
   * Returns { isDuplicate: true, existingResult } if found and still valid.
   */
  async check<T = unknown>(
    key: string,
    userId: string,
  ): Promise<IdempotencyCheckResult<T>> {
    if (!key || !userId) {
      return { isDuplicate: false };
    }

    try {
      const snap = await getDoc(doc(db, COL, key));

      if (!snap.exists()) {
        return { isDuplicate: false };
      }

      const record = snap.data() as IdempotencyRecord<T>;

      // Verify this key belongs to the same user (prevent key hijacking)
      if (record.userId !== userId) {
        return { isDuplicate: false };
      }

      // Check TTL
      if (new Date(record.expiresAt) < new Date()) {
        return { isDuplicate: false };
      }

      return { isDuplicate: true, existingResult: record.result };
    } catch {
      // On error, allow the request through (fail-open for availability)
      return { isDuplicate: false };
    }
  },

  /**
   * store — save an idempotency key and its result after successful processing.
   * Must be called immediately after the operation completes.
   */
  async store<T = unknown>(
    key: string,
    userId: string,
    endpoint: string,
    result: T,
    ttlHours: number = DEFAULT_TTL_HOURS,
  ): Promise<void> {
    const record: IdempotencyRecord<T> = {
      key,
      userId,
      endpoint,
      result,
      createdAt: now(),
      expiresAt: expiresAt(ttlHours),
    };

    try {
      await setDoc(doc(db, COL, key), record);
    } catch (err: any) {
      // Non-fatal — log but don't fail the request
      console.warn('[IdempotencyService] Failed to store key (non-fatal):', err.message);
    }
  },

  /**
   * guardPayout — convenience wrapper for payout routes.
   * If key exists → throws IdempotencyError.
   * Otherwise → executes fn and stores the result.
   */
  async guardPayout<T>(
    key: string | null | undefined,
    userId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!key) {
      // No key provided — execute without idempotency protection
      return fn();
    }

    const { isDuplicate, existingResult } = await this.check<T>(key, userId);

    if (isDuplicate) {
      throw new IdempotencyError(key);
    }

    const result = await fn();
    await this.store(key, userId, 'payout', result);
    return result;
  },
};

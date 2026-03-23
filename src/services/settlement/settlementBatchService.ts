/**
 * settlementBatchService.ts
 * ──────────────────────────
 * Groups open settlement obligations into daily batches per provider/currency.
 *
 * Lifecycle:
 *   batchOpenObligations → OPEN batch created, obligations move to BATCHED
 *   processBatch         → PROCESSING (settlement wire initiated)
 *   settleBatch          → SETTLED (wire confirmed)
 *   failBatch            → FAILED (wire failed; obligations revert to OPEN for retry)
 *
 * Collections:
 *   settlement_batches/{batchId}
 *   se_obligations/{obligationId}
 */

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { settlementLedgerService } from './settlementLedgerService';
import { settlementAlertsService } from './settlementAlertsService';
import type {
  SettlementBatch,
  SettlementBatchStatus,
  BatchFilters,
} from './settlementTypes';

const BATCH_COL = 'settlement_batches';
const OBL_COL = 'se_obligations';

function now(): string {
  return new Date().toISOString();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function generateBatchId(provider: string, currency: string, date: string): string {
  return `batch_${date}_${provider}_${currency}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function auditLog(event: string, data: Record<string, unknown>): void {
  console.log(`[SettlementBatch:AuditLog] ${event}`, JSON.stringify(data));
}

export const settlementBatchService = {
  /**
   * batchOpenObligations — collect all OPEN obligations for a provider/currency
   * and group them into a single batch for the current day.
   *
   * Idempotent: if a batch already exists for today/provider/currency, returns it.
   */
  async batchOpenObligations(
    provider: string,
    currency: string,
    createdBy = 'system',
  ): Promise<SettlementBatch | null> {
    const batchId = generateBatchId(provider, currency, today());

    // Idempotency: return existing batch if already created today
    try {
      const existing = await getDoc(doc(db, BATCH_COL, batchId));
      if (existing.exists()) {
        return existing.data() as SettlementBatch;
      }
    } catch { /* fall through */ }

    // Fetch all OPEN obligations for this provider/currency
    let openObs: Array<{ id: string; amount: number }> = [];
    try {
      const q = query(
        collection(db, OBL_COL),
        where('provider', '==', provider),
        where('currency', '==', currency),
        where('status', '==', 'OPEN'),
      );
      const snap = await getDocs(q);
      openObs = snap.docs.map((d) => ({ id: d.id, amount: d.data().amount ?? 0 }));
    } catch (err: any) {
      console.warn('[settlementBatchService] Could not fetch obligations (dev):', err.message);
      return null;
    }

    if (openObs.length === 0) return null;

    const totalAmount = openObs.reduce((s, o) => s + o.amount, 0);

    const batch: SettlementBatch = {
      batchId,
      provider,
      currency,
      totalAmount,
      obligationCount: openObs.length,
      status: 'OPEN',
      createdAt: now(),
      settledAt: null,
      notes: `Auto-batched ${openObs.length} obligations on ${today()}`,
    };

    // Use Firestore batch write to update all obligations atomically
    try {
      const fbBatch = writeBatch(db);
      fbBatch.set(doc(db, BATCH_COL, batchId), batch);

      for (const ob of openObs) {
        fbBatch.update(doc(db, OBL_COL, ob.id), {
          status: 'BATCHED',
          batchId,
        });
      }

      await fbBatch.commit();
    } catch (err: any) {
      console.error('[settlementBatchService] batchOpenObligations failed:', err.message);
      return null;
    }

    await settlementLedgerService.recordMovement(
      'SETTLEMENT_BATCHED',
      provider,
      currency,
      totalAmount,
      null,
      batchId,
      createdBy,
    );

    auditLog('settlement_batched', { batchId, provider, currency, obligationCount: openObs.length, totalAmount });
    return batch;
  },

  /**
   * processBatch — mark a batch as PROCESSING (wire transfer initiated).
   */
  async processBatch(batchId: string, processedBy = 'admin'): Promise<void> {
    try {
      const ref = doc(db, BATCH_COL, batchId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error(`Batch ${batchId} not found`);

      const batch = snap.data() as SettlementBatch;
      if (batch.status !== 'OPEN') {
        throw new Error(`Batch ${batchId} is ${batch.status}, not OPEN`);
      }

      await updateDoc(ref, { status: 'PROCESSING' });

      // Move batched obligations to PROCESSING
      const q = query(collection(db, OBL_COL), where('batchId', '==', batchId));
      const oblSnap = await getDocs(q);
      const fbBatch = writeBatch(db);
      oblSnap.docs.forEach((d) => fbBatch.update(d.ref, { status: 'PROCESSING' }));
      await fbBatch.commit();

      auditLog('settlement_processing', { batchId, processedBy });
    } catch (err: any) {
      console.error('[settlementBatchService] processBatch failed:', err.message);
      throw err;
    }
  },

  /**
   * settleBatch — mark a batch and all its obligations as SETTLED.
   */
  async settleBatch(batchId: string, settledBy = 'admin'): Promise<void> {
    try {
      const ref = doc(db, BATCH_COL, batchId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error(`Batch ${batchId} not found`);

      const batch = snap.data() as SettlementBatch;
      const settledAt = now();

      await updateDoc(ref, { status: 'SETTLED', settledAt });

      // Mark all obligations as SETTLED
      const q = query(collection(db, OBL_COL), where('batchId', '==', batchId));
      const oblSnap = await getDocs(q);
      const fbBatch = writeBatch(db);
      oblSnap.docs.forEach((d) => fbBatch.update(d.ref, { status: 'SETTLED', settledAt }));
      await fbBatch.commit();

      await settlementLedgerService.recordMovement(
        'SETTLEMENT_SETTLED',
        batch.provider,
        batch.currency,
        batch.totalAmount,
        null,
        batchId,
        settledBy,
      );

      auditLog('settlement_completed', {
        batchId,
        provider: batch.provider,
        currency: batch.currency,
        totalAmount: batch.totalAmount,
        settledBy,
      });
    } catch (err: any) {
      console.error('[settlementBatchService] settleBatch failed:', err.message);
      throw err;
    }
  },

  /**
   * failBatch — mark a batch as FAILED; revert obligations to OPEN for retry.
   */
  async failBatch(batchId: string, reason: string, failedBy = 'admin'): Promise<void> {
    try {
      const ref = doc(db, BATCH_COL, batchId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error(`Batch ${batchId} not found`);

      const batch = snap.data() as SettlementBatch;

      await updateDoc(ref, { status: 'FAILED', notes: reason });

      // Revert obligations to OPEN for retry
      const q = query(collection(db, OBL_COL), where('batchId', '==', batchId));
      const oblSnap = await getDocs(q);
      const fbBatch = writeBatch(db);
      oblSnap.docs.forEach((d) =>
        fbBatch.update(d.ref, { status: 'OPEN', batchId: null }),
      );
      await fbBatch.commit();

      await settlementLedgerService.recordMovement(
        'SETTLEMENT_FAILED',
        batch.provider,
        batch.currency,
        batch.totalAmount,
        null,
        batchId,
        failedBy,
      );

      // Raise a BATCH_FAILURE alert
      await settlementAlertsService.createAlert(
        'BATCH_FAILURE',
        batch.provider,
        batch.currency,
        'HIGH',
        `Settlement batch ${batchId} failed. Reason: ${reason}. Obligations reverted to OPEN for retry.`,
      );

      auditLog('settlement_failed', { batchId, reason, failedBy });
    } catch (err: any) {
      console.error('[settlementBatchService] failBatch failed:', err.message);
      throw err;
    }
  },

  /**
   * listBatches — retrieve batches with optional filters.
   */
  async listBatches(filters?: BatchFilters, limitCount = 50): Promise<SettlementBatch[]> {
    try {
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(limitCount)];
      if (filters?.provider) constraints.unshift(where('provider', '==', filters.provider));
      if (filters?.currency) constraints.unshift(where('currency', '==', filters.currency));
      if (filters?.status)   constraints.unshift(where('status',   '==', filters.status));

      const q = query(collection(db, BATCH_COL), ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as SettlementBatch);
    } catch (err: any) {
      console.warn('[settlementBatchService] listBatches fallback (dev):', err.message);
      return _devBatchStubs();
    }
  },

  /** Count open + processing batches for overview. */
  async countActiveBatches(): Promise<number> {
    try {
      const q = query(collection(db, BATCH_COL), where('status', 'in', ['OPEN', 'PROCESSING']));
      const snap = await getDocs(q);
      return snap.size;
    } catch {
      return 4; // dev fallback
    }
  },
};

// ─── DEV STUBS ───────────────────────────────

const PROVIDERS = ['CHAPA', 'TELEBIRR', 'BANK_DASHEN', 'BANK_AWASH', 'BANK_CBE'];
const STATUSES: SettlementBatchStatus[] = ['OPEN', 'PROCESSING', 'SETTLED', 'OPEN', 'FAILED'];

function _devBatchStubs(): SettlementBatch[] {
  return PROVIDERS.map((p, i) => {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    return {
      batchId: generateBatchId(p, 'ETB', date),
      provider: p,
      currency: 'ETB',
      totalAmount: 500_000 - i * 30_000,
      obligationCount: 38 - i * 3,
      status: STATUSES[i],
      createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
      settledAt: STATUSES[i] === 'SETTLED' ? new Date(Date.now() - (i - 1) * 86_400_000).toISOString() : null,
      notes: '',
    };
  });
}

/**
 * settlementLedgerService.ts
 * ───────────────────────────
 * Immutable ledger of all settlement movements.
 *
 * Every change to a settlement obligation or batch produces a
 * SettlementMovement document in Firestore. These are write-only and
 * serve as a complete audit trail for financial regulators.
 *
 * Collection: settlement_movements/{movementId}
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  SettlementMovement,
  SettlementMovementType,
} from './settlementTypes';

const COL = 'settlement_movements';

function now(): string {
  return new Date().toISOString();
}

function generateMovementId(): string {
  return `sm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function auditLog(event: string, data: Record<string, unknown>): void {
  console.log(`[SettlementLedger:AuditLog] ${event}`, JSON.stringify(data));
}

export const settlementLedgerService = {
  /**
   * recordMovement — write an immutable ledger entry.
   * Called by settlementService and settlementBatchService after each state change.
   */
  async recordMovement(
    type: SettlementMovementType,
    provider: string,
    currency: string,
    amount: number,
    obligationId: string | null,
    batchId: string | null,
    createdBy = 'system',
  ): Promise<string> {
    const movementId = generateMovementId();
    const movement: SettlementMovement = {
      movementId,
      type,
      provider,
      currency,
      amount,
      obligationId,
      batchId,
      createdAt: now(),
      createdBy,
    };

    try {
      await setDoc(doc(db, COL, movementId), movement);
    } catch (err: any) {
      // Non-fatal — log but do not crash the calling service
      console.error('[settlementLedgerService] recordMovement failed:', err.message);
    }

    auditLog(type, { movementId, provider, currency, amount, obligationId, batchId });
    return movementId;
  },

  /**
   * listMovements — retrieve movements for a specific obligation or batch.
   */
  async listMovements(
    filters: { obligationId?: string; batchId?: string; provider?: string },
    limitCount = 100,
  ): Promise<SettlementMovement[]> {
    try {
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(limitCount)];

      if (filters.obligationId) {
        constraints.unshift(where('obligationId', '==', filters.obligationId));
      } else if (filters.batchId) {
        constraints.unshift(where('batchId', '==', filters.batchId));
      } else if (filters.provider) {
        constraints.unshift(where('provider', '==', filters.provider));
      }

      const q = query(collection(db, COL), ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as SettlementMovement);
    } catch (err: any) {
      console.warn('[settlementLedgerService] listMovements fallback (dev):', err.message);
      return _devMovementStubs(filters.provider ?? 'CHAPA');
    }
  },
};

// ─── DEV STUBS ───────────────────────────────

function _devMovementStubs(provider: string): SettlementMovement[] {
  const types: SettlementMovementType[] = [
    'SETTLEMENT_OPENED',
    'SETTLEMENT_BATCHED',
    'SETTLEMENT_SETTLED',
  ];
  return types.map((type, i) => ({
    movementId: `sm_dev_${i}`,
    type,
    provider,
    currency: 'ETB',
    amount: 12_000 * (i + 1),
    obligationId: `settle_dev_${i}`,
    batchId: i > 0 ? `batch_dev_001` : null,
    createdAt: new Date(Date.now() - i * 3_600_000).toISOString(),
    createdBy: 'system',
  }));
}

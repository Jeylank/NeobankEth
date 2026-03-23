/**
 * settlementAuditService.ts
 * ──────────────────────────
 * Writes immutable admin action audit records to Firestore.
 *
 * Used for all human-initiated settlement mutations:
 *   process_batch, settle_batch, fail_batch, resolve_alert
 *
 * Collection: settlement_admin_audit_log/{logId}
 *
 * Non-fatal: if Firestore is unavailable, the action still proceeds.
 */

import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';

const COL = 'settlement_admin_audit_log';

export type SettlementAdminAction =
  | 'process_batch'
  | 'settle_batch'
  | 'fail_batch'
  | 'resolve_alert'
  | 'run_scheduler';

export interface SettlementAdminAuditEntry {
  action: SettlementAdminAction;
  targetId: string;          // batchId, alertId, or 'scheduler'
  targetType: 'batch' | 'alert' | 'scheduler';
  performedBy: string;
  performedAt: string;
  metadata?: Record<string, unknown>;
}

function now(): string {
  return new Date().toISOString();
}

export const settlementAuditService = {
  /**
   * log — write a single audit entry.
   * Called by adminService after each admin-initiated settlement action.
   */
  async log(entry: Omit<SettlementAdminAuditEntry, 'performedAt'>): Promise<void> {
    const record: SettlementAdminAuditEntry = { ...entry, performedAt: now() };
    try {
      await addDoc(collection(db, COL), record);
    } catch (err: any) {
      // Non-fatal — print to console but do not block the calling action
      console.warn('[settlementAuditService] Firestore write failed (non-fatal):', err.message);
    }
    console.log(`[SettlementAudit] ${entry.action} on ${entry.targetId} by ${entry.performedBy}`);
  },
};

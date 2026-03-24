/**
 * middleware/auditLog.ts
 * ──────────────────────
 * Writes every admin action to the `admin_action_logs` Firestore collection.
 *
 * Schema:
 *   admin_action_logs/{logId}
 *   {
 *     adminId   : string      — UID of the admin who performed the action
 *     adminEmail: string
 *     action    : string      — e.g. "APPROVE_FRAUD", "RESOLVE_TICKET"
 *     entityId  : string      — txId / ticketId / disputeId etc.
 *     entityType: string      — "payout" | "fraud_alert" | "support_ticket" | "dispute"
 *     payload   : object      — request body (sanitized)
 *     ip        : string
 *     timestamp : string      — ISO 8601
 *   }
 */

import { adminDb } from '../firebaseAdmin';

const LOGS_COL = 'admin_action_logs';

export interface AuditPayload {
  adminId   : string;
  adminEmail: string;
  action    : string;
  entityId  : string;
  entityType: string;
  payload   : Record<string, unknown>;
  ip        : string;
}

export async function writeAuditLog(data: AuditPayload): Promise<void> {
  try {
    await adminDb.collection(LOGS_COL).add({
      ...data,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    // Audit logging must never crash the request
    console.error('[AuditLog] Failed to write audit log:', err.message);
  }
}

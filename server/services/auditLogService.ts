/**
 * server/services/auditLogService.ts
 * ───────────────────────────────────
 * Unified, searchable audit trail for the Admin Audit Logs screen.
 *
 * Aggregates normalized events from several existing Firestore collections
 * (no new source-of-truth data is invented — everything is read from where
 * it is already written):
 *
 *   LOGIN            ← login_events            (new — see logLoginEvent())
 *   SEND_MONEY       ← sim_transactions         (remittance initiation)
 *   AGENT_ASSIGNED   ← transfer_timeline        (status === 'AGENT_ASSIGNED')
 *   OTP_GENERATED    ← transfer_timeline        (status === 'OTP_SENT')
 *   PAYOUT_COMPLETED ← transfer_timeline        (status === 'PAID_OUT')
 *   KYC_CHANGE       ← kyc_documents            (per-user latest status)
 *   ADMIN_ACTION     ← admin_action_logs        (writeAuditLog())
 *
 * Each source is queried with a single-field `where` (or no filter) to avoid
 * requiring Firestore composite indexes, then normalized + merged + sorted
 * in memory. Date range, free-text search, and user filters are applied
 * in memory once everything is in a common shape.
 */

import { adminDb } from '../firebaseAdmin';

const LOGIN_COL     = 'login_events';
const TXN_COL       = 'sim_transactions';
const TIMELINE_COL  = 'transfer_timeline';
const KYC_COL       = 'kyc_documents';
const AUDIT_COL     = 'admin_action_logs';

export type AuditEventType =
  | 'LOGIN'
  | 'SEND_MONEY'
  | 'AGENT_ASSIGNED'
  | 'OTP_GENERATED'
  | 'PAYOUT_COMPLETED'
  | 'KYC_CHANGE'
  | 'ADMIN_ACTION';

export const AUDIT_EVENT_TYPES: AuditEventType[] = [
  'LOGIN',
  'SEND_MONEY',
  'AGENT_ASSIGNED',
  'OTP_GENERATED',
  'PAYOUT_COMPLETED',
  'KYC_CHANGE',
  'ADMIN_ACTION',
];

export interface AuditEvent {
  id:          string;
  type:        AuditEventType;
  timestamp:   string;          // ISO 8601
  userId:      string | null;   // affected end-user, if known
  actorId:     string | null;   // admin/agent who performed the action, if any
  description: string;
  metadata:    Record<string, unknown>;
}

function toIso(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val;
  const anyVal = val as { toDate?: () => Date };
  if (typeof anyVal.toDate === 'function') return anyVal.toDate().toISOString();
  return null;
}

/** logLoginEvent — call from POST /api/auth/log-login after client sign-in succeeds. */
export async function logLoginEvent(data: {
  uid: string;
  email: string | null;
  method: string;
  ip: string;
  userAgent: string | null;
}): Promise<void> {
  await adminDb.collection(LOGIN_COL).add({
    ...data,
    timestamp: new Date().toISOString(),
  });
}

async function fetchLoginEvents(userId?: string): Promise<AuditEvent[]> {
  let query: FirebaseFirestore.Query = adminDb.collection(LOGIN_COL);
  if (userId) query = query.where('uid', '==', userId);
  const snap = await query.limit(500).get().catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      type: 'LOGIN' as const,
      timestamp: toIso(data.timestamp) ?? new Date(0).toISOString(),
      userId: data.uid ?? null,
      actorId: null,
      description: `${data.email ?? data.uid ?? 'User'} signed in via ${data.method ?? 'unknown method'}`,
      metadata: { email: data.email, method: data.method, ip: data.ip, userAgent: data.userAgent },
    };
  });
}

async function fetchSendMoneyEvents(userId?: string): Promise<AuditEvent[]> {
  let query: FirebaseFirestore.Query = adminDb.collection(TXN_COL);
  if (userId) query = query.where('userId', '==', userId);
  const snap = await query.limit(500).get().catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      type: 'SEND_MONEY' as const,
      timestamp: toIso(data.createdAt) ?? new Date(0).toISOString(),
      userId: data.userId ?? null,
      actorId: null,
      description: `Sent ${data.amount ?? '?'} ${data.currency ?? ''} to recipient ${data.recipientId ?? 'unknown'} (status: ${data.status ?? 'unknown'})`,
      metadata: {
        txId: data.txId ?? d.id,
        recipientId: data.recipientId ?? null,
        amount: data.amount ?? null,
        currency: data.currency ?? null,
        status: data.status ?? null,
      },
    };
  });
}

async function fetchTimelineEvents(
  status: 'AGENT_ASSIGNED' | 'OTP_SENT' | 'PAID_OUT',
  type: 'AGENT_ASSIGNED' | 'OTP_GENERATED' | 'PAYOUT_COMPLETED',
  transferIds?: string[],
): Promise<AuditEvent[]> {
  let query: FirebaseFirestore.Query = adminDb.collection(TIMELINE_COL).where('status', '==', status);
  if (transferIds && transferIds.length > 0) {
    // Firestore 'in' supports at most 30 values.
    query = query.where('transfer_id', 'in', transferIds.slice(0, 30));
  }
  const snap = await query.limit(500).get().catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      type,
      timestamp: toIso(data.created_at) ?? (typeof data.created_at === 'string' ? data.created_at : new Date(0).toISOString()),
      userId: null, // resolved by caller via transfer_id → sim_transactions.userId map, if needed
      actorId: null,
      description: data.note ?? status,
      metadata: { transferId: data.transfer_id, status: data.status },
    };
  });
}

async function resolveTransferUserMap(transferIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(transferIds)).filter(Boolean);
  await Promise.all(
    unique.map(async (txId) => {
      const doc = await adminDb.collection(TXN_COL).doc(txId).get().catch(() => null);
      if (doc?.exists) {
        const uid = doc.data()?.userId;
        if (uid) map.set(txId, uid);
      }
    }),
  );
  return map;
}

async function fetchKycEvents(userId?: string): Promise<AuditEvent[]> {
  if (userId) {
    const doc = await adminDb.collection(KYC_COL).doc(userId).get().catch(() => null);
    if (!doc?.exists) return [];
    const data = doc.data()!;
    return [{
      id: doc.id,
      type: 'KYC_CHANGE' as const,
      timestamp: toIso(data.updatedAt) ?? toIso(data.submittedAt) ?? new Date(0).toISOString(),
      userId: doc.id,
      actorId: null,
      description: `KYC status changed to ${data.status ?? 'unknown'}`,
      metadata: { status: data.status, documentType: data.documentType ?? null },
    }];
  }
  const snap = await adminDb.collection(KYC_COL).limit(500).get().catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      type: 'KYC_CHANGE' as const,
      timestamp: toIso(data.updatedAt) ?? toIso(data.submittedAt) ?? new Date(0).toISOString(),
      userId: d.id,
      actorId: null,
      description: `KYC status changed to ${data.status ?? 'unknown'}`,
      metadata: { status: data.status, documentType: data.documentType ?? null },
    };
  });
}

async function fetchAdminActionEvents(userId?: string): Promise<AuditEvent[]> {
  let query: FirebaseFirestore.Query = adminDb.collection(AUDIT_COL);
  if (userId) query = query.where('entityId', '==', userId);
  const snap = await query.limit(500).get().catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      type: 'ADMIN_ACTION' as const,
      timestamp: toIso(data.timestamp) ?? (typeof data.timestamp === 'string' ? data.timestamp : new Date(0).toISOString()),
      userId: data.entityType === 'user' ? data.entityId ?? null : null,
      actorId: data.adminId ?? null,
      description: `${data.adminEmail ?? data.adminId ?? 'Admin'} performed ${data.action ?? 'an action'} on ${data.entityType ?? 'entity'} ${data.entityId ?? ''}`.trim(),
      metadata: { action: data.action, entityType: data.entityType, entityId: data.entityId, payload: data.payload },
    };
  });
}

export interface AuditLogQuery {
  types?:     AuditEventType[];
  userId?:    string;
  q?:         string;
  startDate?: string; // ISO date
  endDate?:   string; // ISO date
  limit?:     number;
}

export async function queryAuditLogs(params: AuditLogQuery): Promise<{ events: AuditEvent[]; total: number }> {
  const types = params.types && params.types.length > 0 ? params.types : AUDIT_EVENT_TYPES;
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const userId = params.userId?.trim() || undefined;

  const wantsTimeline = types.some((t) => t === 'AGENT_ASSIGNED' || t === 'OTP_GENERATED' || t === 'PAYOUT_COMPLETED');

  // When filtering by userId and timeline events are requested, we first need
  // the set of that user's transfer ids (sim_transactions.userId → txId),
  // since transfer_timeline has no direct userId field.
  let userTransferIds: string[] | undefined;
  if (userId && wantsTimeline) {
    const txSnap = await adminDb.collection(TXN_COL).where('userId', '==', userId).get().catch(() => null);
    userTransferIds = txSnap ? txSnap.docs.map((d) => d.data().txId ?? d.id) : [];
  }

  const tasks: Promise<AuditEvent[]>[] = [];

  if (types.includes('LOGIN'))             tasks.push(fetchLoginEvents(userId));
  if (types.includes('SEND_MONEY'))        tasks.push(fetchSendMoneyEvents(userId));
  if (types.includes('AGENT_ASSIGNED'))    tasks.push(fetchTimelineEvents('AGENT_ASSIGNED', 'AGENT_ASSIGNED', userId ? userTransferIds : undefined));
  if (types.includes('OTP_GENERATED'))     tasks.push(fetchTimelineEvents('OTP_SENT', 'OTP_GENERATED', userId ? userTransferIds : undefined));
  if (types.includes('PAYOUT_COMPLETED'))  tasks.push(fetchTimelineEvents('PAID_OUT', 'PAYOUT_COMPLETED', userId ? userTransferIds : undefined));
  if (types.includes('KYC_CHANGE'))        tasks.push(fetchKycEvents(userId));
  if (types.includes('ADMIN_ACTION'))      tasks.push(fetchAdminActionEvents(userId));

  const results = await Promise.all(tasks);
  let events = results.flat();

  // Resolve userId for timeline-sourced events (agent assignment / OTP / payout)
  // when we didn't already filter by a specific user.
  const needsResolution = events.filter((e) => (e.type === 'AGENT_ASSIGNED' || e.type === 'OTP_GENERATED' || e.type === 'PAYOUT_COMPLETED') && !e.userId);
  if (needsResolution.length > 0 && !userId) {
    const transferIds = needsResolution.map((e) => e.metadata.transferId as string).filter(Boolean);
    const userMap = await resolveTransferUserMap(transferIds);
    for (const e of needsResolution) {
      const tId = e.metadata.transferId as string;
      if (tId && userMap.has(tId)) e.userId = userMap.get(tId)!;
    }
  } else if (userId) {
    for (const e of needsResolution) e.userId = userId;
  }

  if (params.startDate) {
    events = events.filter((e) => e.timestamp >= params.startDate!);
  }
  if (params.endDate) {
    events = events.filter((e) => e.timestamp <= params.endDate!);
  }

  if (params.q?.trim()) {
    const needle = params.q.trim().toLowerCase();
    events = events.filter((e) => {
      const haystack = [e.description, e.userId, e.actorId, JSON.stringify(e.metadata)]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());
      return haystack.some((v) => v.includes(needle));
    });
  }

  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const total = events.length;
  return { events: events.slice(0, limit), total };
}

/**
 * server/services/adminTransfersService.ts
 * ──────────────────────────────────────────
 * Backs the Admin Transfers screen: search/filter transfers, view full
 * detail (timeline + fraud + KYC), and trigger reconciliation retries.
 * All data is read live from Firestore — nothing hardcoded.
 */

import { adminDb } from '../firebaseAdmin';
import { AGENT_COL, checkAndReassignStaleAssignment, getTimeline } from './agentPayoutService';
import { FRAUD_COL } from './fraudEngine';
import { safetyGuardsService } from './riskControls/safetyGuardsService';
import { resumeTransaction } from './simulationEngine';
import { refundSimulationPayment } from './paymentConfirmationService';
import * as admin from 'firebase-admin';

const TXN_COL = AGENT_COL.txns; // 'sim_transactions'

export interface TransferSummary {
  txId:         string;
  status:       string;
  amount:       number | null;
  currency:     string | null;
  destinationAmount: number | null;
  destinationCurrency: string | null;
  senderId:     string | null;
  recipientId:  string | null;
  recipientName: string | null;
  recipientCity: string | null;
  createdAt:    string | null;
  updatedAt:    string | null;
  fraudScore:   number | null;
  fraudDecision: string | null;
  kycStatus:    string;
}

function toIso(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val;
  const anyVal = val as { toDate?: () => Date };
  if (typeof anyVal.toDate === 'function') return anyVal.toDate().toISOString();
  return null;
}

async function attachRiskContext(txId: string, userId: string | null): Promise<{
  fraudScore: number | null;
  fraudDecision: string | null;
  kycStatus: string;
}> {
  // Avoid a composite index (transactionId + createdAt): filter by
  // transactionId only, then pick the most recent entry in memory.
  const [fraudSnap, kycStatus] = await Promise.all([
    adminDb.collection(FRAUD_COL.decisions)
      .where('transactionId', '==', txId)
      .get()
      .catch(() => null),
    userId ? safetyGuardsService.getKycStatus(userId) : Promise.resolve('NOT_STARTED'),
  ]);

  let fraudScore: number | null = null;
  let fraudDecision: string | null = null;
  if (fraudSnap && !fraudSnap.empty) {
    const sorted = [...fraudSnap.docs].sort((a, b) => {
      const aTime = toIso(a.data().createdAt) ?? '';
      const bTime = toIso(b.data().createdAt) ?? '';
      return bTime.localeCompare(aTime);
    });
    const d = sorted[0].data();
    fraudScore = typeof d.score === 'number' ? d.score : null;
    fraudDecision = typeof d.decision === 'string' ? d.decision : null;
  }

  return { fraudScore, fraudDecision, kycStatus };
}

function toSummary(id: string, data: FirebaseFirestore.DocumentData): Omit<TransferSummary, 'fraudScore' | 'fraudDecision' | 'kycStatus'> {
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  return {
    txId:                id,
    status:              data.status ?? 'UNKNOWN',
    amount:              typeof data.amount === 'number' ? data.amount : null,
    currency:            data.currency ?? null,
    destinationAmount:   typeof data.destinationAmount === 'number' ? data.destinationAmount : null,
    destinationCurrency: data.destinationCurrency ?? null,
    senderId:            data.userId ?? null,
    recipientId:         data.recipientId ?? null,
    recipientName:       (metadata.recipientName as string) ?? data.recipientName ?? null,
    recipientCity:       data.recipient_city ?? data.recipientCity ?? null,
    createdAt:           toIso(data.createdAt),
    updatedAt:           toIso(data.updatedAt),
  };
}

/**
 * searchTransfers — filters/searches sim_transactions.
 * Firestore has no full-text search, so for free-text queries (txId prefix,
 * sender/recipient id, recipient name) we scan a bounded recent window and
 * filter in memory — acceptable at closed-beta transaction volumes.
 */
export async function searchTransfers(params: {
  txId?:    string;
  query?:   string;
  status?:  string;
  limit?:   number;
}): Promise<{ results: TransferSummary[]; totalScanned: number }> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

  // Direct lookup by exact transaction id
  if (params.txId) {
    const doc = await adminDb.collection(TXN_COL).doc(params.txId).get();
    if (!doc.exists) return { results: [], totalScanned: 0 };
    const summary = toSummary(doc.id, doc.data()!);
    const risk = await attachRiskContext(doc.id, summary.senderId);
    return { results: [{ ...summary, ...risk }], totalScanned: 1 };
  }

  // Avoid requiring a composite Firestore index: when filtering by status we
  // skip the orderBy on the query itself and sort the (smaller) result set
  // in memory instead.
  let queryRef: FirebaseFirestore.Query = adminDb.collection(TXN_COL);
  if (params.status) {
    queryRef = queryRef.where('status', '==', params.status).limit(500);
  } else {
    queryRef = queryRef.orderBy('createdAt', 'desc').limit(500);
  }

  const snap = await queryRef.get();
  let docs = snap.docs;

  if (params.status) {
    docs = [...docs].sort((a, b) => {
      const aTime = toIso(a.data().createdAt) ?? '';
      const bTime = toIso(b.data().createdAt) ?? '';
      return bTime.localeCompare(aTime);
    });
  }

  if (params.query) {
    const needle = params.query.trim().toLowerCase();
    docs = docs.filter((d) => {
      const data = d.data();
      const metadata = (data.metadata ?? {}) as Record<string, unknown>;
      const haystack = [
        d.id,
        data.userId,
        data.recipientId,
        metadata.recipientName,
        data.recipientName,
      ]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());
      return haystack.some((v) => v.includes(needle));
    });
  }

  const page = docs.slice(0, limit);
  const results = await Promise.all(
    page.map(async (d) => {
      const summary = toSummary(d.id, d.data());
      const risk = await attachRiskContext(d.id, summary.senderId);
      return { ...summary, ...risk };
    }),
  );

  return { results, totalScanned: docs.length };
}

export interface TransferDetail extends TransferSummary {
  timeline: Array<{ status: string; note: string; created_at: string }>;
  fraudHistory: Array<{ score: number; decision: string; rulesTriggered: string[]; createdAt: string | null }>;
  ledgerEntries: Array<Record<string, unknown>>;
  paymentConfirmation: { status: string | null; confirmedAt: string | null; refundEligible: boolean };
  agentAssignment: Record<string, unknown> | null;
  otpState: { status: 'NOT_SENT' | 'SENT' | 'VERIFIED' | 'CONSUMED'; expiresAt: string | null; verifiedAt: string | null };
  reconciliation: { status: string | null; reports: Array<Record<string, unknown>> };
  alerts: Array<Record<string, unknown>>;
}

export async function getTransferDetail(txId: string): Promise<TransferDetail | null> {
  const doc = await adminDb.collection(TXN_COL).doc(txId).get();
  if (!doc.exists) return null;

  const data    = doc.data()!;
  const summary = toSummary(doc.id, data);

  const [timelineRaw, fraudSnap, kycStatus, ledgerSnap, assignmentSnap, otpDoc, reconciliationSnap, alertsSnap] = await Promise.all([
    getTimeline(txId).catch(() => []),
    // Avoid a composite index (transactionId + createdAt): filter only, sort in memory.
    adminDb.collection(FRAUD_COL.decisions)
      .where('transactionId', '==', txId)
      .get()
      .catch(() => null),
    summary.senderId ? safetyGuardsService.getKycStatus(summary.senderId) : Promise.resolve('NOT_STARTED'),
    adminDb.collection('sim_ledger').where('transactionId', '==', txId).get().catch(() => null),
    adminDb.collection(AGENT_COL.assigns).where('transfer_id', '==', txId).get().catch(() => null),
    adminDb.collection(AGENT_COL.otps).doc(txId).get().catch(() => null),
    adminDb.collection('reconciliation_reports').where('transactionId', '==', txId).get().catch(() => null),
    adminDb.collection('reconciliation_alerts').where('transactionId', '==', txId).get().catch(() => null),
  ]);

  const fraudHistory = (fraudSnap?.docs ?? [])
    .map((d) => {
      const fd = d.data();
      return {
        score:          typeof fd.score === 'number' ? fd.score : 0,
        decision:       fd.decision ?? 'UNKNOWN',
        rulesTriggered: Array.isArray(fd.rulesTriggered) ? fd.rulesTriggered : [],
        createdAt:      toIso(fd.createdAt),
      };
    })
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  const latest = fraudHistory[0];

  return {
    ...summary,
    fraudScore:    latest?.score ?? null,
    fraudDecision: latest?.decision ?? null,
    kycStatus,
    timeline: (timelineRaw as Array<{ status: string; note: string; created_at: string }>).map((t) => ({
      status:     t.status,
      note:       t.note,
      created_at: t.created_at,
    })),
    fraudHistory,
    ledgerEntries: (ledgerSnap?.docs ?? []).map((d) => {
      const row = d.data();
      return { id: d.id, type: row.type ?? null, currency: row.currency ?? null, amount: row.amount ?? null, entries: row.entries ?? [], createdAt: toIso(row.createdAt) };
    }),
    paymentConfirmation: {
      status: data.paymentStatus ?? null,
      confirmedAt: toIso(data.paymentConfirmedAt),
      refundEligible: data.status !== 'REFUNDED' && (data.reservationStatus === 'RESERVED' || data.paymentStatus === 'CONFIRMED'),
    },
    agentAssignment: (() => {
      const rows = assignmentSnap?.docs ?? [];
      if (!rows.length) return null;
      const row = rows[rows.length - 1].data();
      return { id: rows[rows.length - 1].id, agentId: row.agent_id ?? data.assigned_agent_id ?? null, status: row.status ?? null, assignedAt: row.assigned_at ?? null, responseDeadline: row.response_deadline ?? null, updatedAt: row.updated_at ?? null };
    })(),
    otpState: (() => {
      if (!otpDoc?.exists) return { status: 'NOT_SENT' as const, expiresAt: null, verifiedAt: null };
      const otp = otpDoc.data()!;
      const status = otp.paid_at ? 'CONSUMED' : otp.verified_at || otp.payout_token ? 'VERIFIED' : 'SENT';
      return { status, expiresAt: toIso(otp.expires_at ?? otp.expiresAt), verifiedAt: toIso(otp.verified_at) };
    })(),
    reconciliation: {
      status: data.reconciliationStatus ?? data.recoveryAction ?? null,
      reports: (reconciliationSnap?.docs ?? []).map((d) => ({ id: d.id, status: d.data().status ?? null, type: d.data().type ?? null, createdAt: toIso(d.data().createdAt) })),
    },
    alerts: (alertsSnap?.docs ?? []).map((d) => ({ id: d.id, type: d.data().type ?? null, severity: d.data().severity ?? null, status: d.data().status ?? null, message: d.data().message ?? null, createdAt: toIso(d.data().createdAt) })),
  };
}

const RETRYABLE_STATUSES = new Set([
  'AGENT_ASSIGNED',
  'PENDING_LIQUIDITY',
  'PENDING_REQUOTE',
  'FUNDS_RECEIVED',
]);

export class TransferRetryError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * retryTransferReconciliation — picks the correct retry action based on the
 * transfer's current state:
 *   - AGENT_ASSIGNED / FUNDS_RECEIVED → reassignment check (stale agent handling)
 *   - PENDING_LIQUIDITY / PENDING_REQUOTE → resume transaction (retry provider/quote)
 */
export async function retryTransferReconciliation(txId: string): Promise<Record<string, unknown>> {
  const doc = await adminDb.collection(TXN_COL).doc(txId).get();
  if (!doc.exists) {
    throw new TransferRetryError(`Transfer ${txId} not found.`, 404);
  }
  const status = doc.data()!.status as string;

  if (!RETRYABLE_STATUSES.has(status)) {
    throw new TransferRetryError(
      `Transfer is in status '${status}', which is not eligible for retry.`,
      409,
    );
  }

  if (status === 'PENDING_LIQUIDITY' || status === 'PENDING_REQUOTE') {
    const result = await resumeTransaction(txId, 'retry');
    return { action: 'resume', ...result };
  }

  const result = await checkAndReassignStaleAssignment(txId);
  return { action: 'reassign', ...result };
}

const RECOVERY_ELIGIBLE = new Set(['FUNDS_RECEIVED', 'OTP_SENT']);

export async function moveTransferToRecovery(txId: string): Promise<Record<string, unknown>> {
  const ref = adminDb.collection(TXN_COL).doc(txId);
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new TransferRetryError('Transfer not found.', 404);
    const status = snapshot.data()!.status as string;
    if (status === 'RECOVERY_PENDING') return { action: 'recovery', status, duplicate: true };
    if (!RECOVERY_ELIGIBLE.has(status)) throw new TransferRetryError('Transfer is not eligible for recovery.', 409);
    transaction.update(ref, {
      status: 'RECOVERY_PENDING', recoveryPreviousStatus: status,
      recoveryReason: 'ADMIN_REQUESTED', recoveryFlaggedAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });
    return { action: 'recovery', status: 'RECOVERY_PENDING', duplicate: false };
  });
}

export async function initiatePermittedRefund(txId: string): Promise<Record<string, unknown>> {
  const result = await refundSimulationPayment(txId);
  if (!result.ok) throw new TransferRetryError('Transfer is not eligible for refund.', result.status);
  return { action: 'refund', ...result.payload };
}

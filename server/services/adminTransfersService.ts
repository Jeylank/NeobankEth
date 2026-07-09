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
  raw:      Record<string, unknown>;
  timeline: Array<{ status: string; note: string; created_at: string }>;
  fraudHistory: Array<{ score: number; decision: string; rulesTriggered: string[]; createdAt: string | null }>;
}

export async function getTransferDetail(txId: string): Promise<TransferDetail | null> {
  const doc = await adminDb.collection(TXN_COL).doc(txId).get();
  if (!doc.exists) return null;

  const data    = doc.data()!;
  const summary = toSummary(doc.id, data);

  const [timelineRaw, fraudSnap, kycStatus] = await Promise.all([
    getTimeline(txId).catch(() => []),
    // Avoid a composite index (transactionId + createdAt): filter only, sort in memory.
    adminDb.collection(FRAUD_COL.decisions)
      .where('transactionId', '==', txId)
      .get()
      .catch(() => null),
    summary.senderId ? safetyGuardsService.getKycStatus(summary.senderId) : Promise.resolve('NOT_STARTED'),
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
    raw:      data,
    timeline: (timelineRaw as Array<{ status: string; note: string; created_at: string }>).map((t) => ({
      status:     t.status,
      note:       t.note,
      created_at: t.created_at,
    })),
    fraudHistory,
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

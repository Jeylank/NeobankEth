/**
 * server/services/dashboardService.ts
 * ─────────────────────────────────────
 * Data-gathering logic for the Admin Dashboard API.
 *
 * Aggregates across:
 *   sim_transactions  — transfers and their states
 *   agents            — payout agent registry
 *   assignments       — agent↔transfer linkage
 *   fraud_decisions   — fraud engine decisions
 *
 * No writes are performed here — all functions are read-only.
 */

import { adminDb } from '../firebaseAdmin';
import { AGENT_COL, AGENT_RESPONSE_TIMEOUT_MS, OTP_FLOW_TIMEOUT_MS } from './agentPayoutService';

// ─── Thresholds ───────────────────────────────────────────────────────────────

export const LOW_FLOAT_THRESHOLD_ETB       = 5_000;    // agent float warning level (ETB)
export const STUCK_UNASSIGNED_THRESHOLD_MS = 10 * 60 * 1000;  // 10 min in FUNDS_RECEIVED
export const ALERT_LOOKBACK_MS             = 24 * 60 * 60 * 1000; // 24-hour window for failures

// ─── Types ───────────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AlertType =
  | 'STUCK_AGENT_UNRESPONSIVE'
  | 'STUCK_OTP_TIMEOUT'
  | 'STUCK_UNASSIGNED'
  | 'LOW_AGENT_FLOAT'
  | 'AGENT_OFFLINE'
  | 'FAILED_TRANSFER'
  | 'TIMED_OUT_TRANSFER'
  | 'PENDING_FRAUD_REVIEW';

export interface DashboardAlert {
  type:        AlertType;
  severity:    AlertSeverity;
  message:     string;
  data:        Record<string, unknown>;
  detectedAt:  string;
}

export interface StuckTransfer {
  transferId:   string;
  status:       string;
  stuckSinceMs: number;
  stuckMinutes: number;
  amount:       number | null;
  currency:     string | null;
  agentId:      string | null;
  userId:       string | null;
  city:         string | null;
}

export interface CityStats {
  total:      number;
  online:     number;
  offline:    number;
  totalFloat: number;
  lowFloat:   number;
}

type DashboardDocument = { id: string } & Record<string, unknown>;

// ─── Transfers dashboard ──────────────────────────────────────────────────────

export interface TransfersDashboard {
  summary:    Record<string, number>;
  totalCount: number;
  stuck:      StuckTransfer[];
  recentFailed: Array<Record<string, unknown>>;
  recent:     Array<Record<string, unknown>>;
  fetchedAt:  string;
}

export async function getTransfersDashboard(): Promise<TransfersDashboard> {
  const now      = Date.now();
  const snap     = await adminDb.collection(AGENT_COL.txns).orderBy('updatedAt', 'desc').limit(200).get();
  const allDocs = snap.docs.map<DashboardDocument>(
    d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }),
  );

  // ── State summary ─────────────────────────────────────────────────────────
  const summary: Record<string, number> = {};
  for (const tx of allDocs) {
    const s = (tx.status as string) ?? 'UNKNOWN';
    summary[s] = (summary[s] ?? 0) + 1;
  }

  // ── Stuck: AGENT_ASSIGNED with a stale assignment ─────────────────────────
  const assignedTxns = allDocs.filter(tx => tx.status === 'AGENT_ASSIGNED');
  const staleAssignSnap = await adminDb
    .collection(AGENT_COL.assigns)
    .where('status', '==', 'assigned')
    .get();

  const staleByTransferId = new Map<string, number>(); // transferId → staleMs
  for (const doc of staleAssignSnap.docs) {
    const data     = doc.data();
    const deadline = new Date(data.response_deadline as string).getTime();
    if (now > deadline) {
      staleByTransferId.set(data.transfer_id as string, now - deadline);
    }
  }

  const stuck: StuckTransfer[] = [];

  for (const tx of assignedTxns) {
    const staleMs = staleByTransferId.get(tx.id) ?? null;
    if (staleMs !== null) {
      stuck.push(buildStuck(tx, staleMs));
    }
  }

  // ── Stuck: OTP_SENT beyond flow timeout ───────────────────────────────────
  for (const tx of allDocs) {
    if (tx.status !== 'OTP_SENT') continue;
    const sentAt  = tsToMs(tx.otpSentAt);
    if (!sentAt) continue;
    const elapsedMs = now - sentAt;
    if (elapsedMs > OTP_FLOW_TIMEOUT_MS) {
      stuck.push(buildStuck(tx, elapsedMs, 'OTP_TIMEOUT'));
    }
  }

  // ── Stuck: FUNDS_RECEIVED and not yet assigned after threshold ────────────
  for (const tx of allDocs) {
    if (tx.status !== 'FUNDS_RECEIVED') continue;
    const updatedMs = tsToMs(tx.updatedAt);
    if (!updatedMs) continue;
    const elapsedMs = now - updatedMs;
    if (elapsedMs > STUCK_UNASSIGNED_THRESHOLD_MS) {
      stuck.push(buildStuck(tx, elapsedMs, 'UNASSIGNED'));
    }
  }

  // ── Sort stuck: longest first ─────────────────────────────────────────────
  stuck.sort((a, b) => b.stuckSinceMs - a.stuckSinceMs);

  // ── Recent failures (last 24 h) ───────────────────────────────────────────
  const cutoff      = now - ALERT_LOOKBACK_MS;
  const recentFailed = allDocs
    .filter(tx => ['FAILED', 'TIMED_OUT', 'BLOCKED_FRAUD'].includes(tx.status as string))
    .filter(tx => {
      const ms = tsToMs(tx.updatedAt);
      return ms ? ms >= cutoff : false;
    })
    .slice(0, 20)
    .map(tx => sanitizeTx(tx));

  // ── Recent 20 transfers ───────────────────────────────────────────────────
  const recent = allDocs.slice(0, 20).map(tx => sanitizeTx(tx));

  return {
    summary,
    totalCount: allDocs.length,
    stuck,
    recentFailed,
    recent,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Agents dashboard ─────────────────────────────────────────────────────────

export interface AgentsDashboard {
  summary: {
    total:       number;
    online:      number;
    offline:     number;
    lowFloat:    number;
    totalFloat:  number;
  };
  byCity:    Record<string, CityStats>;
  lowFloat:  Array<Record<string, unknown>>;
  agents:    Array<Record<string, unknown>>;
  thresholds: {
    lowFloatETB: number;
  };
  fetchedAt: string;
}

export async function getAgentsDashboard(): Promise<AgentsDashboard> {
  const snap   = await adminDb.collection(AGENT_COL.agents).get();
  const agents = snap.docs.map<DashboardDocument>(
    d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }),
  );

  const byCity: Record<string, CityStats> = {};
  let totalFloat = 0;
  let lowFloatCount = 0;

  for (const a of agents) {
    const city   = (a.city  as string)  ?? 'Unknown';
    const status = (a.status as string) ?? 'offline';
    const float  = (a.available_float as number) ?? 0;

    if (!byCity[city]) byCity[city] = { total: 0, online: 0, offline: 0, totalFloat: 0, lowFloat: 0 };
    byCity[city].total++;
    byCity[city].totalFloat += float;
    totalFloat += float;

    if (status === 'online') byCity[city].online++;
    else byCity[city].offline++;

    if (float < LOW_FLOAT_THRESHOLD_ETB) {
      byCity[city].lowFloat++;
      lowFloatCount++;
    }
  }

  const online  = agents.filter(a => a.status === 'online').length;
  const offline = agents.length - online;

  const lowFloat = agents
    .filter(a => (a.available_float as number) < LOW_FLOAT_THRESHOLD_ETB)
    .sort((a, b) => (a.available_float as number) - (b.available_float as number));

  return {
    summary:    { total: agents.length, online, offline, lowFloat: lowFloatCount, totalFloat },
    byCity,
    lowFloat,
    agents,
    thresholds: { lowFloatETB: LOW_FLOAT_THRESHOLD_ETB },
    fetchedAt:  new Date().toISOString(),
  };
}

// ─── Alerts dashboard ─────────────────────────────────────────────────────────

export interface AlertsDashboard {
  alerts:    DashboardAlert[];
  count:     number;
  bySeverity: Record<AlertSeverity, number>;
  fetchedAt: string;
}

export async function getAlertsDashboard(): Promise<AlertsDashboard> {
  const now    = Date.now();
  const cutoff = now - ALERT_LOOKBACK_MS;
  const alerts: DashboardAlert[] = [];

  // ── Gather transfer + agent data in parallel ──────────────────────────────
  const [txSnap, agentSnap, assignSnap, fraudSnap] = await Promise.all([
    adminDb.collection(AGENT_COL.txns).orderBy('updatedAt', 'desc').limit(200).get(),
    adminDb.collection(AGENT_COL.agents).get(),
    adminDb.collection(AGENT_COL.assigns).where('status', '==', 'assigned').get(),
    adminDb.collection('fraud_decisions').where('decision', '==', 'PENDING_REVIEW').limit(50).get(),
  ]);

  const txDocs = txSnap.docs.map<DashboardDocument>(
    d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }),
  );
  const agentDocs = agentSnap.docs.map<DashboardDocument>(
    d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }),
  );

  // ── Stale agent assignment alerts ─────────────────────────────────────────
  const staleByTransfer = new Map<string, number>();
  for (const doc of assignSnap.docs) {
    const data     = doc.data();
    const deadline = new Date(data.response_deadline as string).getTime();
    if (now > deadline) {
      staleByTransfer.set(data.transfer_id as string, now - deadline);
    }
  }

  for (const tx of txDocs) {
    if (tx.status !== 'AGENT_ASSIGNED') continue;
    const staleMs = staleByTransfer.get(tx.id);
    if (!staleMs) continue;
    const staleMin  = Math.round(staleMs / 60_000);
    const severity: AlertSeverity = staleMin >= 30 ? 'critical' : 'high';
    alerts.push({
      type:       'STUCK_AGENT_UNRESPONSIVE',
      severity,
      message:    `Transfer ${tx.id} has been waiting for agent response for ${staleMin} minutes.`,
      data:       { transferId: tx.id, agentId: tx.assigned_agent_id ?? null, staleMinutes: staleMin, amount: tx.amount, currency: tx.currency },
      detectedAt: new Date().toISOString(),
    });
  }

  // ── OTP timeout alerts ────────────────────────────────────────────────────
  for (const tx of txDocs) {
    if (tx.status !== 'OTP_SENT') continue;
    const sentAt    = tsToMs(tx.otpSentAt);
    if (!sentAt) continue;
    const elapsedMs = now - sentAt;
    if (elapsedMs > OTP_FLOW_TIMEOUT_MS) {
      const elapsedMin = Math.round(elapsedMs / 60_000);
      alerts.push({
        type:       'STUCK_OTP_TIMEOUT',
        severity:   elapsedMin >= 30 ? 'critical' : 'high',
        message:    `Transfer ${tx.id} has been in OTP_SENT state for ${elapsedMin} minutes — recipient has not verified.`,
        data:       { transferId: tx.id, elapsedMinutes: elapsedMin, amount: tx.amount, currency: tx.currency },
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // ── Stuck unassigned alerts ───────────────────────────────────────────────
  for (const tx of txDocs) {
    if (tx.status !== 'FUNDS_RECEIVED') continue;
    const updatedMs = tsToMs(tx.updatedAt);
    if (!updatedMs) continue;
    const elapsedMs = now - updatedMs;
    if (elapsedMs > STUCK_UNASSIGNED_THRESHOLD_MS) {
      const elapsedMin = Math.round(elapsedMs / 60_000);
      alerts.push({
        type:       'STUCK_UNASSIGNED',
        severity:   'medium',
        message:    `Transfer ${tx.id} has had funds received but no agent assigned for ${elapsedMin} minutes.`,
        data:       { transferId: tx.id, elapsedMinutes: elapsedMin, amount: tx.amount, currency: tx.currency, city: tx.recipient_city ?? null },
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // ── Low agent float alerts ────────────────────────────────────────────────
  for (const agent of agentDocs) {
    const float = (agent.available_float as number) ?? 0;
    if (float < LOW_FLOAT_THRESHOLD_ETB) {
      const severity: AlertSeverity = float === 0 ? 'critical' : float < LOW_FLOAT_THRESHOLD_ETB / 2 ? 'high' : 'medium';
      alerts.push({
        type:       'LOW_AGENT_FLOAT',
        severity,
        message:    `Agent ${agent.full_name} (${agent.city}) has low float: ${float.toLocaleString()} ETB (threshold: ${LOW_FLOAT_THRESHOLD_ETB.toLocaleString()} ETB).`,
        data:       { agentId: agent.id, fullName: agent.full_name, city: agent.city, availableFloat: float, threshold: LOW_FLOAT_THRESHOLD_ETB },
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // ── Offline agent alerts (informational) ─────────────────────────────────
  const offlineAgents = agentDocs.filter(a => a.status === 'offline');
  if (offlineAgents.length > 0) {
    alerts.push({
      type:       'AGENT_OFFLINE',
      severity:   'low',
      message:    `${offlineAgents.length} agent${offlineAgents.length > 1 ? 's are' : ' is'} currently offline.`,
      data:       { count: offlineAgents.length, agents: offlineAgents.map(a => ({ id: a.id, fullName: a.full_name, city: a.city })) },
      detectedAt: new Date().toISOString(),
    });
  }

  // ── Recent failed transfer alerts (last 24 h) ─────────────────────────────
  const recentFailed = txDocs.filter(tx => {
    if (!['FAILED', 'TIMED_OUT'].includes(tx.status as string)) return false;
    const ms = tsToMs(tx.updatedAt);
    return ms ? ms >= cutoff : false;
  });

  for (const tx of recentFailed.slice(0, 10)) {
    const type: AlertType = tx.status === 'TIMED_OUT' ? 'TIMED_OUT_TRANSFER' : 'FAILED_TRANSFER';
    alerts.push({
      type,
      severity:   'low',
      message:    `Transfer ${tx.id} ${tx.status === 'TIMED_OUT' ? 'timed out' : 'failed'} in the last 24 hours. Reason: ${(tx.failReason as string) ?? 'unspecified'}.`,
      data:       { transferId: tx.id, amount: tx.amount, currency: tx.currency, failReason: tx.failReason ?? null },
      detectedAt: new Date().toISOString(),
    });
  }

  // ── Pending fraud review alerts ───────────────────────────────────────────
  if (!fraudSnap.empty) {
    alerts.push({
      type:       'PENDING_FRAUD_REVIEW',
      severity:   'high',
      message:    `${fraudSnap.size} transaction${fraudSnap.size > 1 ? 's' : ''} pending fraud review.`,
      data:       {
        count:   fraudSnap.size,
        records: fraudSnap.docs.slice(0, 5).map(d => ({ id: d.id, userId: d.data().userId, score: d.data().score })),
      },
      detectedAt: new Date().toISOString(),
    });
  }

  // ── Sort: critical → high → medium → low ─────────────────────────────────
  const ORDER: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  alerts.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  const bySeverity: Record<AlertSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const a of alerts) bySeverity[a.severity]++;

  return { alerts, count: alerts.length, bySeverity, fetchedAt: new Date().toISOString() };
}

// ─── Unified summary (closed-beta admin dashboard cards) ──────────────────────

export interface DashboardSummary {
  transfers: {
    total:            number;
    pending:          number;
    paymentPending:   number;
    fundsReceived:    number;
    otpSent:          number;
    recoveryPending:  number;
    paidOut:          number;
    failed:           number;
    refunds:          number;
  };
  agents: {
    active:    number;
    suspended: number;
  };
  kycPending:  number;
  riskAlerts:  number;
  dailyVolume: {
    amount: number;
    count:  number;
    date:   string;
  };
  fetchedAt: string;
}

const RECOVERY_STATUSES = new Set(['PENDING_LIQUIDITY', 'PENDING_REQUOTE']);
const FAILED_STATUSES   = new Set(['FAILED', 'TIMED_OUT', 'BLOCKED_FRAUD', 'CANCELLED', 'PAYMENT_FAILED', 'PAYMENT_EXPIRED']);
const PAID_OUT_STATUSES = new Set(['PAID_OUT', 'COMPLETED']);
const TERMINAL_STATUSES = new Set([
  'COMPLETED', 'PAID_OUT', 'FAILED', 'TIMED_OUT', 'BLOCKED_FRAUD',
  'CANCELLED', 'PAYMENT_FAILED', 'PAYMENT_EXPIRED', 'REFUNDED',
]);

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const now      = Date.now();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);

  const [txSnap, agentSnap, kycSnap, alertsData] = await Promise.all([
    adminDb.collection(AGENT_COL.txns).get(),
    adminDb.collection(AGENT_COL.agents).get(),
    adminDb.collection('kyc_documents').where('status', '==', 'pending').get(),
    getAlertsDashboard(),
  ]);

  const txDocs = txSnap.docs.map<DashboardDocument>(
    d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }),
  );

  let pending = 0, paymentPending = 0, fundsReceived = 0, otpSent = 0;
  let recoveryPending = 0, paidOut = 0, failed = 0, refunds = 0;
  let dailyAmount = 0, dailyCount = 0;

  for (const tx of txDocs) {
    const status = (tx.status as string) ?? 'UNKNOWN';
    const amount = Number(tx.amount ?? 0);

    if (status === 'PAYMENT_PENDING') paymentPending++;
    if (status === 'FUNDS_RECEIVED')  fundsReceived++;
    if (status === 'OTP_SENT')        otpSent++;
    if (RECOVERY_STATUSES.has(status)) recoveryPending++;
    if (PAID_OUT_STATUSES.has(status)) paidOut++;
    if (FAILED_STATUSES.has(status))   failed++;
    if (status === 'REFUNDED')         refunds++;
    if (!TERMINAL_STATUSES.has(status)) pending++;

    const createdMs = tsToMs(tx.createdAt) ?? tsToMs(tx.updatedAt);
    if (createdMs !== null && createdMs >= dayStart.getTime()) {
      dailyAmount += amount;
      dailyCount++;
    }
  }

  const agentDocs = agentSnap.docs.map(d => d.data() as Record<string, unknown>);
  const active    = agentDocs.filter(a => a.status === 'online').length;
  const suspended = agentDocs.length - active;

  return {
    transfers: {
      total: txDocs.length,
      pending,
      paymentPending,
      fundsReceived,
      otpSent,
      recoveryPending,
      paidOut,
      failed,
      refunds,
    },
    agents: { active, suspended },
    kycPending: kycSnap.size,
    riskAlerts: alertsData.count,
    dailyVolume: {
      amount: dailyAmount,
      count:  dailyCount,
      date:   dayStart.toISOString().slice(0, 10),
    },
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tsToMs(val: unknown): number | null {
  if (!val) return null;
  if (typeof val === 'object' && val !== null && 'toMillis' in val) {
    return (val as { toMillis(): number }).toMillis();
  }
  if (typeof val === 'string') return new Date(val).getTime();
  if (typeof val === 'number') return val;
  return null;
}

function buildStuck(
  tx:       Record<string, unknown>,
  stuckMs:  number,
  reason?:  string,
): StuckTransfer {
  const minutes = Math.round(stuckMs / 60_000);
  return {
    transferId:   tx.id  as string,
    status:       (reason === 'OTP_TIMEOUT' ? 'OTP_SENT_TIMEOUT' : reason === 'UNASSIGNED' ? 'FUNDS_RECEIVED_UNASSIGNED' : 'AGENT_ASSIGNED_STALE') as string,
    stuckSinceMs: stuckMs,
    stuckMinutes: minutes,
    amount:       (tx.amount   as number | null) ?? null,
    currency:     (tx.currency as string | null) ?? null,
    agentId:      (tx.assigned_agent_id as string | null) ?? null,
    userId:       (tx.userId   as string | null) ?? null,
    city:         (tx.recipient_city as string | null) ?? (tx.recipientCity as string | null) ?? null,
  };
}

function sanitizeTx(tx: Record<string, unknown>): Record<string, unknown> {
  return {
    id:         tx.id,
    status:     tx.status,
    amount:     tx.amount,
    currency:   tx.currency,
    userId:     tx.userId,
    agentId:    tx.assigned_agent_id ?? null,
    city:       tx.recipient_city ?? tx.recipientCity ?? null,
    updatedAt:  tx.updatedAt ? new Date(tsToMs(tx.updatedAt) ?? 0).toISOString() : null,
  };
}

/**
 * server/services/betaRiskSummaryService.ts
 * ───────────────────────────────────────────
 * Aggregates the single-call "Beta Risk Summary" admin dashboard:
 *   - Total beta users / active users today   (Firebase Auth)
 *   - Pending KYC                              (kyc_documents)
 *   - Fraud review                             (fraud_decisions)
 *   - Blocked / failed transfers               (sim_transactions)
 *   - Reconciliation queue                     (reconciliation_reports)
 *   - Agent liquidity warnings                 (agents)
 *   - Firestore/API health                     (live Firestore probe + process uptime)
 *   - Recent alerts                            (dashboardService.getAlertsDashboard)
 *
 * All reads are live — no hardcoded or mocked values. Every counter fails
 * safely to 0/'unknown' so a single collection outage doesn't 500 the whole card.
 */

import { adminAuth, adminDb } from '../firebaseAdmin';
import { AGENT_COL } from './agentPayoutService';
import { FRAUD_COL } from './fraudEngine';
import {
  getAlertsDashboard,
  getAgentsDashboard,
  LOW_FLOAT_THRESHOLD_ETB,
  type DashboardAlert,
} from './dashboardService';

const PROCESS_START = Date.now();

export interface BetaRiskSummary {
  users: {
    totalBetaUsers: number;
    activeToday: number;
  };
  kyc: {
    pending: number;
  };
  fraud: {
    pendingReview: number;
    blockedLast24h: number;
  };
  transfers: {
    blocked: number;
    failed: number;
  };
  reconciliation: {
    queueLength: number;
    mismatched: number;
    lastRunAt: string | null;
  };
  liquidity: {
    lowFloatAgents: number;
    offlineAgents: number;
    thresholdETB: number;
  };
  health: {
    status: 'ok' | 'degraded' | 'error';
    firestore: 'connected' | 'unreachable';
    uptimeSeconds: number;
  };
  alerts: {
    recent: DashboardAlert[];
    total: number;
    bySeverity: Record<string, number>;
  };
  fetchedAt: string;
}

const FAILED_TX_STATUSES = new Set(['FAILED', 'TIMED_OUT', 'PAYMENT_FAILED', 'PAYMENT_EXPIRED']);

async function countUsers(): Promise<{ totalBetaUsers: number; activeToday: number }> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();

  let totalBetaUsers = 0;
  let activeToday = 0;
  let pageToken: string | undefined;
  const MAX_SCAN = 5000; // bounded scan — matches convention in adminUsersService

  do {
    const page = await adminAuth.listUsers(1000, pageToken);
    totalBetaUsers += page.users.length;
    for (const u of page.users) {
      const lastSignIn = u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).getTime() : null;
      if (lastSignIn !== null && lastSignIn >= dayStartMs) activeToday++;
    }
    pageToken = page.pageToken;
  } while (pageToken && totalBetaUsers < MAX_SCAN);

  return { totalBetaUsers, activeToday };
}

async function countKycPending(): Promise<number> {
  try {
    const snap = await adminDb.collection('kyc_documents').where('status', '==', 'pending').get();
    return snap.size;
  } catch {
    return 0;
  }
}

async function countFraud(): Promise<{ pendingReview: number; blockedLast24h: number }> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const [reviewSnap, blockedSnap] = await Promise.all([
      adminDb.collection(FRAUD_COL.decisions).where('decision', '==', 'PENDING_REVIEW').get(),
      adminDb.collection(FRAUD_COL.decisions).where('decision', '==', 'BLOCKED').get(),
    ]);
    const blockedLast24h = blockedSnap.docs.filter((d) => {
      const ts = d.data().createdAt ?? d.data().timestamp;
      const iso = typeof ts === 'string' ? ts : ts?.toDate?.()?.toISOString?.();
      return iso ? iso >= dayAgo : false;
    }).length;
    return { pendingReview: reviewSnap.size, blockedLast24h };
  } catch {
    return { pendingReview: 0, blockedLast24h: 0 };
  }
}

async function countTransfers(): Promise<{ blocked: number; failed: number }> {
  try {
    const snap = await adminDb.collection(AGENT_COL.txns).get();
    let blocked = 0;
    let failed = 0;
    for (const doc of snap.docs) {
      const status = doc.data().status as string;
      if (status === 'BLOCKED_FRAUD') blocked++;
      if (FAILED_TX_STATUSES.has(status)) failed++;
    }
    return { blocked, failed };
  } catch {
    return { blocked: 0, failed: 0 };
  }
}

async function getReconciliationQueue(): Promise<{ queueLength: number; mismatched: number; lastRunAt: string | null }> {
  try {
    const snap = await adminDb.collection('reconciliation_reports').orderBy('createdAt', 'desc').limit(500).get();
    const reports = snap.docs.map((d) => d.data());
    const mismatched = reports.filter((r) => r.status === 'MISMATCH').length;
    const queueLength = reports.filter((r) => r.status === 'MISSING_EXTERNAL' || r.status === 'MISSING_INTERNAL').length;
    const lastRunAt = (reports[0]?.createdAt as string | undefined) ?? null;
    return { queueLength, mismatched, lastRunAt };
  } catch {
    return { queueLength: 0, mismatched: 0, lastRunAt: null };
  }
}

async function getFirestoreHealth(): Promise<{ status: 'ok' | 'degraded' | 'error'; firestore: 'connected' | 'unreachable'; uptimeSeconds: number }> {
  let firestore: 'connected' | 'unreachable' = 'unreachable';
  try {
    await adminDb.collection('system_errors').limit(1).get();
    firestore = 'connected';
  } catch {
    firestore = 'unreachable';
  }
  const uptimeSeconds = Math.floor((Date.now() - PROCESS_START) / 1000);
  const status: 'ok' | 'degraded' | 'error' = firestore === 'unreachable' ? 'error' : 'ok';
  return { status, firestore, uptimeSeconds };
}

export async function getBetaRiskSummary(): Promise<BetaRiskSummary> {
  const [
    users,
    kycPending,
    fraud,
    transfers,
    reconciliation,
    agents,
    health,
    alertsData,
  ] = await Promise.all([
    countUsers().catch(() => ({ totalBetaUsers: 0, activeToday: 0 })),
    countKycPending(),
    countFraud(),
    countTransfers(),
    getReconciliationQueue(),
    getAgentsDashboard().catch(() => ({
      summary: { lowFloat: 0, offline: 0 },
    } as Awaited<ReturnType<typeof getAgentsDashboard>>)),
    getFirestoreHealth(),
    getAlertsDashboard().catch(() => ({
      alerts: [],
      count: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      fetchedAt: new Date().toISOString(),
    } as Awaited<ReturnType<typeof getAlertsDashboard>>)),
  ]);

  return {
    users,
    kyc: { pending: kycPending },
    fraud,
    transfers,
    reconciliation,
    liquidity: {
      lowFloatAgents: agents.summary.lowFloat,
      offlineAgents: agents.summary.offline,
      thresholdETB: LOW_FLOAT_THRESHOLD_ETB,
    },
    health,
    alerts: {
      recent: alertsData.alerts.slice(0, 10),
      total: alertsData.count,
      bySeverity: alertsData.bySeverity,
    },
    fetchedAt: new Date().toISOString(),
  };
}

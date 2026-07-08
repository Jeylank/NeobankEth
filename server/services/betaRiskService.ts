import * as admin from 'firebase-admin';
import { adminDb } from '../firebaseAdmin';

export interface BetaLimits {
  maxTransferAmount: number;
  maxDailyTransfersPerUser: number;
  maxDailyVolumePerUser: number;
  maxTotalPlatformExposure: number;
}

export interface BetaControls {
  paused: boolean;
  limits: BetaLimits;
  updatedAt?: FirebaseFirestore.Timestamp;
  updatedBy?: string;
}

export type BetaRiskAlertType =
  | 'DUPLICATE_REQUEST'
  | 'FAILED_PAYMENT'
  | 'STUCK_RECOVERY'
  | 'LOW_AGENT_FLOAT'
  | 'LEDGER_IMBALANCE';

export const DEFAULT_BETA_CONTROLS: BetaControls = {
  paused: false,
  limits: {
    maxTransferAmount: 1_000,
    maxDailyTransfersPerUser: 10,
    maxDailyVolumePerUser: 5_000,
    maxTotalPlatformExposure: 100_000,
  },
};

const TERMINAL_STATUSES = new Set([
  'PAYMENT_FAILED', 'PAYMENT_EXPIRED', 'REFUNDED', 'FAILED', 'CANCELLED', 'COMPLETED', 'PAID_OUT',
]);

function millis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis();
  }
  return new Date(String(value ?? 0)).getTime();
}

export class BetaLimitError extends Error {
  constructor(
    public readonly code: 'BETA_PAUSED' | 'BETA_LIMIT_EXCEEDED',
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BetaLimitError';
  }
}

export async function getBetaControls(): Promise<BetaControls> {
  const snapshot = await adminDb.collection('beta_controls').doc('current').get();
  if (!snapshot.exists) return DEFAULT_BETA_CONTROLS;
  const data = snapshot.data()!;
  return {
    ...DEFAULT_BETA_CONTROLS,
    ...data,
    limits: { ...DEFAULT_BETA_CONTROLS.limits, ...(data.limits ?? {}) },
  };
}

export async function updateBetaControls(
  patch: { paused?: boolean; limits?: Partial<BetaLimits> },
  updatedBy = 'api',
): Promise<BetaControls> {
  const current = await getBetaControls();
  const next: BetaControls = {
    paused: patch.paused ?? current.paused,
    limits: { ...current.limits, ...(patch.limits ?? {}) },
    updatedAt: admin.firestore.Timestamp.now(),
    updatedBy,
  };
  await adminDb.collection('beta_controls').doc('current').set(next);
  return next;
}

export async function enforceBetaInitiationLimits(
  userId: string,
  amount: number,
  nowMs = Date.now(),
): Promise<void> {
  const [controls, transactions] = await Promise.all([
    getBetaControls(),
    adminDb.collection('sim_transactions').get(),
  ]);
  if (controls.paused) {
    throw new BetaLimitError('BETA_PAUSED', 'Closed beta is paused. New transfers are temporarily disabled.');
  }
  const dayStart = new Date(nowMs);
  dayStart.setUTCHours(0, 0, 0, 0);
  const today = transactions.docs
    .map(document => document.data())
    .filter(data => data.userId === userId && millis(data.createdAt) >= dayStart.getTime());
  const dailyVolume = today.reduce((sum, data) => sum + Number(data.amount ?? 0), 0);
  const exposure = transactions.docs
    .map(document => document.data())
    .filter(data => !TERMINAL_STATUSES.has(data.status))
    .reduce((sum, data) => sum + Number(data.amount ?? 0), 0);
  const { limits } = controls;

  const violation =
    amount > limits.maxTransferAmount ? ['maxTransferAmount', amount, limits.maxTransferAmount]
      : today.length >= limits.maxDailyTransfersPerUser ? ['maxDailyTransfersPerUser', today.length + 1, limits.maxDailyTransfersPerUser]
        : dailyVolume + amount > limits.maxDailyVolumePerUser ? ['maxDailyVolumePerUser', dailyVolume + amount, limits.maxDailyVolumePerUser]
          : exposure + amount > limits.maxTotalPlatformExposure ? ['maxTotalPlatformExposure', exposure + amount, limits.maxTotalPlatformExposure]
            : null;
  if (violation) {
    throw new BetaLimitError('BETA_LIMIT_EXCEEDED', `Closed-beta limit exceeded: ${violation[0]}.`, {
      limit: violation[0], attempted: violation[1], maximum: violation[2],
    });
  }
}

export async function createBetaRiskAlert(
  type: BetaRiskAlertType,
  entityId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const alertId = `${type}_${entityId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 1500);
  await adminDb.collection('beta_risk_alerts').doc(alertId).set({
    alertId,
    type,
    entityId,
    details,
    status: 'OPEN',
    createdAt: admin.firestore.Timestamp.now(),
  }, { merge: true });
}

export async function getBetaRiskSummary(): Promise<Record<string, unknown>> {
  const [controls, transactions, alerts, agents] = await Promise.all([
    getBetaControls(),
    adminDb.collection('sim_transactions').get(),
    adminDb.collection('beta_risk_alerts').get(),
    adminDb.collection('agents').get(),
  ]);
  const active = transactions.docs.map(document => document.data())
    .filter(data => !TERMINAL_STATUSES.has(data.status));
  const exposure = active.reduce((sum, data) => sum + Number(data.amount ?? 0), 0);
  const openAlerts = alerts.docs.map(document => document.data()).filter(alert => alert.status === 'OPEN');
  const alertsByType = openAlerts.reduce<Record<string, number>>((counts, alert) => {
    counts[alert.type] = (counts[alert.type] ?? 0) + 1;
    return counts;
  }, {});
  return {
    paused: controls.paused,
    limits: controls.limits,
    exposure,
    exposureRemaining: Math.max(0, controls.limits.maxTotalPlatformExposure - exposure),
    activeTransfers: active.length,
    lowFloatAgents: agents.docs.filter(document => Number(document.data().available_float ?? 0) < 500).length,
    openAlerts: openAlerts.length,
    alertsByType,
    generatedAt: new Date().toISOString(),
  };
}

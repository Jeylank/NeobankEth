/**
 * server/services/fraudEngine.ts
 * ────────────────────────────────
 * Real-time, rules-based fraud detection layer.
 *
 * SAFETY GUARANTEES (inviolable):
 *   - evaluateFraud() NEVER mutates wallets, balances, or transaction state.
 *   - evaluateFraud() NEVER executes or initiates payments.
 *   - It is a pure analysis layer that returns a decision for the caller to act on.
 *
 * Scoring rules (all weights configurable at runtime via riskConfig):
 *   NEW_DEVICE          +20*  deviceId deviates from user's established device set
 *   NEW_RECIPIENT       +15*  recipientId not seen in prior user transactions
 *   AMOUNT_ANOMALY      +25*  amount > configurable× user's average transaction amount
 *   VELOCITY_SPIKE      +30*  >N tx in last M minutes (N, M configurable)
 *   FAILED_LOGIN_BURST  +20*  >N failed login events in last M minutes
 *   GEO_MISMATCH        +25*  requesting IP deviates from user's established IP set
 *
 * Decision thresholds (configurable at runtime):
 *   score >= 60*  →  BLOCK  (403 FRAUD_BLOCKED)
 *   score >= 30*  →  REVIEW (202 PENDING_REVIEW)
 *   else          →  ALLOW
 *   (* = default value; live values stored in risk_config/current)
 *
 * Device/IP deviation model:
 *   NEW_DEVICE and GEO_MISMATCH only fire when the user HAS an established
 *   history. A first-time user with no recorded devices/IPs scores 0 for both
 *   rules — there is no baseline to deviate from.
 *
 * Persistence:
 *   Every decision is written to `fraud_decisions` for audit trails.
 */

import * as admin from 'firebase-admin';
import { adminDb } from '../firebaseAdmin';
import { getRiskConfig, type RiskConfig } from './riskConfig';

// ─── Firestore collection names ────────────────────────────────────────────────

export const FRAUD_COL = {
  decisions:     'fraud_decisions',
  userDevices:   'fraud_user_devices',
  userIps:       'fraud_user_ips',
  loginAttempts: 'fraud_login_attempts',
} as const;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface FraudContext {
  userId:      string;
  recipientId: string;
  amount:      number;
  currency:    string;
  type:        string;
  deviceId?:   string;
  ipAddress?:  string;
  userAgent?:  string;
  metadata?:   Record<string, unknown>;
}

export type FraudDecision = 'ALLOW' | 'REVIEW' | 'BLOCK';

export interface FraudResult {
  decision:       FraudDecision;
  score:          number;
  rulesTriggered: string[];
  decisionId:     string;
  configVersion:  number;
}

// ─── Rule evaluators ─────────────────────────────────────────────────────────
// Each function accepts only the parameters it needs from the runtime config.
// All Firestore reads are single-field equality queries (no composite indexes).

/** NEW_DEVICE: fires only when user HAS established device history but this device is new. */
async function checkNewDevice(
  userId:   string,
  deviceId: string | undefined,
  score:    number,
): Promise<number> {
  if (!deviceId) return 0;
  const doc = await adminDb.collection(FRAUD_COL.userDevices).doc(userId).get();
  if (!doc.exists) return 0;
  const known: string[] = (doc.data()?.deviceIds ?? []) as string[];
  if (known.length === 0) return 0;
  return known.includes(deviceId) ? 0 : score;
}

/** NEW_RECIPIENT: fires when recipientId has never appeared in this user's transaction history. */
async function checkNewRecipient(
  userId:      string,
  recipientId: string,
  score:       number,
): Promise<number> {
  const snap = await adminDb
    .collection('sim_transactions')
    .where('userId', '==', userId)
    .limit(50)
    .get();
  if (snap.empty) return score;
  const seen = snap.docs.some(d => d.data().recipientId === recipientId);
  return seen ? 0 : score;
}

/** AMOUNT_ANOMALY: fires when amount exceeds (factor × user's recent average). */
async function checkAmountAnomaly(
  userId:        string,
  amount:        number,
  factor:        number,
  historyLimit:  number,
  score:         number,
): Promise<number> {
  const snap = await adminDb
    .collection('sim_transactions')
    .where('userId', '==', userId)
    .limit(historyLimit * 2)
    .get();
  if (snap.empty) return 0;
  const amounts = snap.docs
    .map(d => d.data())
    .filter(d => d.status === 'PROCESSING' || d.status === 'COMPLETED')
    .map(d => (d.amount ?? 0) as number)
    .filter(a => a > 0)
    .slice(0, historyLimit);
  if (amounts.length === 0) return 0;
  const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
  return amount > avg * factor ? score : 0;
}

/** VELOCITY_SPIKE: fires when user has more than `threshold` active txs in the recent window. */
async function checkVelocitySpike(
  userId:    string,
  windowMs:  number,
  threshold: number,
  score:     number,
): Promise<number> {
  const windowStart = Date.now() - windowMs;
  const snap = await adminDb
    .collection('sim_transactions')
    .where('userId', '==', userId)
    .limit(100)
    .get();
  const activeCount = snap.docs.filter(d => {
    const data = d.data();
    const s = data.status as string;
    if (s === 'BLOCKED_FRAUD' || s === 'FAILED') return false;
    const ts: number = data.createdAt?.toMillis?.() ?? data.createdAt ?? 0;
    return ts >= windowStart;
  }).length;
  return activeCount > threshold ? score : 0;
}

/** FAILED_LOGIN_BURST: fires when user has more than `threshold` failed logins in the window. */
async function checkFailedLoginBurst(
  userId:    string,
  windowMs:  number,
  threshold: number,
  score:     number,
): Promise<number> {
  const doc = await adminDb.collection(FRAUD_COL.loginAttempts).doc(userId).get();
  if (!doc.exists) return 0;
  const cutoff = Date.now() - windowMs;
  const recent: number[] = ((doc.data()!.failedAt ?? []) as number[]).filter(
    (ts: number) => ts >= cutoff,
  );
  return recent.length > threshold ? score : 0;
}

/** GEO_MISMATCH: fires only when user HAS established IP history but this IP is new. */
async function checkGeoMismatch(
  userId:    string,
  ipAddress: string | undefined,
  score:     number,
): Promise<number> {
  if (!ipAddress) return 0;
  const doc = await adminDb.collection(FRAUD_COL.userIps).doc(userId).get();
  if (!doc.exists) return 0;
  const known: string[] = (doc.data()?.ipAddresses ?? []) as string[];
  if (known.length === 0) return 0;
  return known.includes(ipAddress) ? 0 : score;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * evaluateFraud — run all fraud rules and return a structured decision.
 *
 * Fetches the current risk config from the in-memory cache (no Firestore round-
 * trip unless the cache has expired). All rule weights and thresholds are
 * configurable at runtime via PATCH /api/v1/risk/config.
 *
 * Safe to call before any wallet operation — never mutates financial state.
 */
export async function evaluateFraud(
  ctx:             FraudContext,
  transactionId?:  string,
): Promise<FraudResult> {
  // Load runtime config (instant cache hit unless TTL expired).
  const cfg: RiskConfig = await getRiskConfig();
  const { scores, thresholds, limits } = cfg;

  const checks = await Promise.all([
    checkNewDevice(ctx.userId, ctx.deviceId, scores.NEW_DEVICE)
      .then(s => ({ rule: 'NEW_DEVICE', score: s })),
    checkNewRecipient(ctx.userId, ctx.recipientId, scores.NEW_RECIPIENT)
      .then(s => ({ rule: 'NEW_RECIPIENT', score: s })),
    checkAmountAnomaly(ctx.userId, ctx.amount, limits.amountAnomalyFactor, limits.amountHistoryLimit, scores.AMOUNT_ANOMALY)
      .then(s => ({ rule: 'AMOUNT_ANOMALY', score: s })),
    checkVelocitySpike(ctx.userId, limits.velocityWindowMs, limits.velocityThreshold, scores.VELOCITY_SPIKE)
      .then(s => ({ rule: 'VELOCITY_SPIKE', score: s })),
    checkFailedLoginBurst(ctx.userId, limits.velocityWindowMs, limits.loginBurstThreshold, scores.FAILED_LOGIN_BURST)
      .then(s => ({ rule: 'FAILED_LOGIN_BURST', score: s })),
    checkGeoMismatch(ctx.userId, ctx.ipAddress, scores.GEO_MISMATCH)
      .then(s => ({ rule: 'GEO_MISMATCH', score: s })),
  ]);

  const rulesTriggered = checks.filter(c => c.score > 0).map(c => c.rule);
  const score          = checks.reduce((total, c) => total + c.score, 0);
  const decision: FraudDecision =
    score >= thresholds.block  ? 'BLOCK'  :
    score >= thresholds.review ? 'REVIEW' :
    'ALLOW';

  console.log(
    `[FRAUD] user=${ctx.userId} score=${score} decision=${decision}` +
    (rulesTriggered.length ? ` rules=[${rulesTriggered.join(',')}]` : ' rules=[]') +
    ` cfg_v=${cfg.version}`,
  );

  const decisionRef = await adminDb.collection(FRAUD_COL.decisions).add({
    userId:         ctx.userId,
    transactionId:  transactionId ?? null,
    recipientId:    ctx.recipientId,
    amount:         ctx.amount,
    currency:       ctx.currency,
    type:           ctx.type,
    score,
    rulesTriggered,
    decision,
    configVersion:  cfg.version,
    deviceId:       ctx.deviceId   ?? null,
    ipAddress:      ctx.ipAddress  ?? null,
    userAgent:      ctx.userAgent  ?? null,
    timestamp:      admin.firestore.Timestamp.now(),
  });

  return { decision, score, rulesTriggered, decisionId: decisionRef.id, configVersion: cfg.version };
}

// ─── Trust-signal helpers ────────────────────────────────────────────────────

export async function recordTrustedDevice(userId: string, deviceId: string): Promise<void> {
  await adminDb.collection(FRAUD_COL.userDevices).doc(userId).set(
    { deviceIds: admin.firestore.FieldValue.arrayUnion(deviceId) },
    { merge: true },
  );
}

export async function recordTrustedIp(userId: string, ipAddress: string): Promise<void> {
  await adminDb.collection(FRAUD_COL.userIps).doc(userId).set(
    { ipAddresses: admin.firestore.FieldValue.arrayUnion(ipAddress) },
    { merge: true },
  );
}

export async function recordFailedLogin(userId: string): Promise<void> {
  const ref    = adminDb.collection(FRAUD_COL.loginAttempts).doc(userId);
  const cfg    = await getRiskConfig();
  const cutoff = Date.now() - cfg.limits.velocityWindowMs;
  const doc    = await ref.get();
  const prev: number[] = doc.exists
    ? ((doc.data()!.failedAt ?? []) as number[]).filter((ts: number) => ts >= cutoff)
    : [];
  await ref.set({ failedAt: [...prev, Date.now()] });
}

// ─── Fraud collection wipe ───────────────────────────────────────────────────

export async function resetFraudCollections(): Promise<void> {
  await Promise.all(
    Object.values(FRAUD_COL).map(async (col) => {
      const snap = await adminDb.collection(col).limit(500).get();
      if (snap.empty) return;
      const batch = adminDb.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }),
  );
  console.info('[FraudEngine] All fraud collections cleared.');
}

// ─── Exported constants (for tests and documentation) ────────────────────────

export const FRAUD_SCORES = {
  NEW_DEVICE:         20,
  NEW_RECIPIENT:      15,
  AMOUNT_ANOMALY:     25,
  VELOCITY_SPIKE:     30,
  FAILED_LOGIN_BURST: 20,
  GEO_MISMATCH:       25,
} as const;

export const SCORE_BLOCK  = 60;
export const SCORE_REVIEW = 30;

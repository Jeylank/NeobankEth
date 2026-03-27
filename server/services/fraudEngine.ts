/**
 * server/services/fraudEngine.ts
 * ────────────────────────────────
 * Real-time, rules-based fraud detection layer.
 *
 * SAFETY GUARANTEES (inviolable):
 *   - evaluateFraud() NEVER mutates wallets, balances, or transaction state.
 *   - evaluateFraud() NEVER executes or initiates payments.
 *   - It is a read-only analysis layer that returns a decision for the caller
 *     to act on.
 *
 * Scoring rules (MVP):
 *   NEW_DEVICE          +20   deviceId not in user's known devices
 *   NEW_RECIPIENT       +15   recipientId not seen in prior user transactions
 *   AMOUNT_ANOMALY      +25   amount > 2.5× user's average transaction amount
 *   VELOCITY_SPIKE      +30   >3 successful transactions in the last 10 minutes
 *   FAILED_LOGIN_BURST  +20   >3 failed login events in the last 10 minutes
 *   GEO_MISMATCH        +25   requesting IP not in user's known IP set
 *
 * Thresholds:
 *   score >= 60  →  BLOCK  (403 FRAUD_BLOCKED)
 *   score >= 30  →  REVIEW (202 PENDING_REVIEW)
 *   else         →  ALLOW
 *
 * Persistence:
 *   Every decision (ALLOW / REVIEW / BLOCK) is written to the
 *   `fraud_decisions` Firestore collection for audit trails.
 *
 * Velocity / device tracking:
 *   - Recent transactions are queried from `sim_transactions`.
 *   - Known devices are maintained in `fraud_user_devices/{userId}`.
 *   - Known IPs are maintained in `fraud_user_ips/{userId}`.
 *   - Failed login bursts are tracked in `fraud_login_attempts/{userId}`.
 */

import * as admin from 'firebase-admin';
import { adminDb } from '../firebaseAdmin';

// ─── Firestore collection names ────────────────────────────────────────────────

export const FRAUD_COL = {
  decisions:    'fraud_decisions',
  userDevices:  'fraud_user_devices',
  userIps:      'fraud_user_ips',
  loginAttempts: 'fraud_login_attempts',
} as const;

// ─── Constants ─────────────────────────────────────────────────────────────────

const VELOCITY_WINDOW_MS     = 10 * 60 * 1000; // 10 minutes
const VELOCITY_THRESHOLD     = 3;               // max allowed in window
const AMOUNT_ANOMALY_FACTOR  = 2.5;             // multiplier vs user avg
const AMOUNT_HISTORY_LIMIT   = 30;              // past txs to compute avg from
const LOGIN_BURST_THRESHOLD  = 3;               // failed logins in window
const SCORE_BLOCK            = 60;
const SCORE_REVIEW           = 30;

// ─── Public Types ──────────────────────────────────────────────────────────────

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
  decision:      FraudDecision;
  score:         number;
  rulesTriggered: string[];
  decisionId:    string;
}

// ─── Rule evaluators (pure-read, no side effects) ────────────────────────────

/** NEW_DEVICE — +20: deviceId is absent from the user's recorded device list.
 *
 * Only fires when the user HAS an established device history and this request
 * comes from a device not in that list. A brand-new user with no device record
 * scores 0 — there is no baseline pattern to deviate from.
 */
async function checkNewDevice(userId: string, deviceId: string | undefined): Promise<number> {
  if (!deviceId) return 0; // no device signal → skip rule
  const doc = await adminDb.collection(FRAUD_COL.userDevices).doc(userId).get();
  if (!doc.exists) return 0; // no established device history → cannot flag as deviation
  const known: string[] = (doc.data()?.deviceIds ?? []) as string[];
  if (known.length === 0) return 0;
  return known.includes(deviceId) ? 0 : 20;
}

/** NEW_RECIPIENT — +15: recipientId never seen in this user's prior transactions.
 *
 * Fetches the user's last N transactions (single-field query, no composite index)
 * and checks for a matching recipientId in-memory.
 */
async function checkNewRecipient(userId: string, recipientId: string): Promise<number> {
  const snap = await adminDb
    .collection('sim_transactions')
    .where('userId', '==', userId)
    .limit(50)
    .get();
  if (snap.empty) return 15; // no prior transactions → recipient is definitely new
  const seen = snap.docs.some(d => d.data().recipientId === recipientId);
  return seen ? 0 : 15;
}

/** AMOUNT_ANOMALY — +25: amount > 2.5× user's average from recent history.
 *
 * Query uses only userId (single-field equality) so no composite index is
 * required. Status filtering is done in-memory after the fetch.
 */
async function checkAmountAnomaly(userId: string, amount: number): Promise<number> {
  const snap = await adminDb
    .collection('sim_transactions')
    .where('userId', '==', userId)
    .limit(AMOUNT_HISTORY_LIMIT * 2) // over-fetch to compensate for in-memory filtering
    .get();
  if (snap.empty) return 0; // no history → cannot compute anomaly
  const amounts = snap.docs
    .map(d => d.data())
    .filter(d => d.status === 'PROCESSING' || d.status === 'COMPLETED')
    .map(d => (d.amount ?? 0) as number)
    .filter(a => a > 0)
    .slice(0, AMOUNT_HISTORY_LIMIT);
  if (amounts.length === 0) return 0;
  const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
  return amount > avg * AMOUNT_ANOMALY_FACTOR ? 25 : 0;
}

/** VELOCITY_SPIKE — +30: more than 3 non-blocked transactions in the last 10 min.
 *
 * Fetches up to 100 of the user's transactions (single-field query, no composite
 * index required) and filters by time and status in-memory.
 */
async function checkVelocitySpike(userId: string): Promise<number> {
  const windowStart = Date.now() - VELOCITY_WINDOW_MS;
  const snap = await adminDb
    .collection('sim_transactions')
    .where('userId', '==', userId)
    .limit(100)
    .get();
  const activeCount = snap.docs.filter(d => {
    const data = d.data();
    const s = data.status as string;
    if (s === 'BLOCKED_FRAUD' || s === 'FAILED') return false;
    // createdAt may be a Firestore Timestamp or a millis number
    const ts: number = data.createdAt?.toMillis?.() ?? data.createdAt ?? 0;
    return ts >= windowStart;
  }).length;
  return activeCount > VELOCITY_THRESHOLD ? 30 : 0;
}

/** FAILED_LOGIN_BURST — +20: more than 3 failed login events in the last 10 min. */
async function checkFailedLoginBurst(userId: string): Promise<number> {
  const doc = await adminDb.collection(FRAUD_COL.loginAttempts).doc(userId).get();
  if (!doc.exists) return 0;
  const data = doc.data()!;
  const cutoff = Date.now() - VELOCITY_WINDOW_MS;
  const recentFailures: number[] = ((data.failedAt ?? []) as number[]).filter(
    (ts: number) => ts >= cutoff,
  );
  return recentFailures.length > LOGIN_BURST_THRESHOLD ? 20 : 0;
}

/** GEO_MISMATCH — +25: requesting IP not in user's known IP set.
 *
 * Only fires when the user HAS an established IP history and this request
 * comes from an IP not in that list. A brand-new user with no IP record
 * scores 0 — there is no baseline pattern to deviate from.
 */
async function checkGeoMismatch(userId: string, ipAddress: string | undefined): Promise<number> {
  if (!ipAddress) return 0; // no IP signal → skip rule
  const doc = await adminDb.collection(FRAUD_COL.userIps).doc(userId).get();
  if (!doc.exists) return 0; // no established IP history → cannot flag as deviation
  const known: string[] = (doc.data()?.ipAddresses ?? []) as string[];
  if (known.length === 0) return 0;
  return known.includes(ipAddress) ? 0 : 25;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * evaluateFraud — run all fraud rules against a transaction context.
 *
 * This function is SAFE to call before wallet debit.  It never mutates
 * financial state.  It persists the decision to `fraud_decisions` for
 * the audit trail and returns a structured result for the route handler.
 */
export async function evaluateFraud(
  ctx: FraudContext,
  transactionId?: string,
): Promise<FraudResult> {
  const checks = await Promise.all([
    checkNewDevice(ctx.userId, ctx.deviceId).then(s => ({ rule: 'NEW_DEVICE', score: s })),
    checkNewRecipient(ctx.userId, ctx.recipientId).then(s => ({ rule: 'NEW_RECIPIENT', score: s })),
    checkAmountAnomaly(ctx.userId, ctx.amount).then(s => ({ rule: 'AMOUNT_ANOMALY', score: s })),
    checkVelocitySpike(ctx.userId).then(s => ({ rule: 'VELOCITY_SPIKE', score: s })),
    checkFailedLoginBurst(ctx.userId).then(s => ({ rule: 'FAILED_LOGIN_BURST', score: s })),
    checkGeoMismatch(ctx.userId, ctx.ipAddress).then(s => ({ rule: 'GEO_MISMATCH', score: s })),
  ]);

  const rulesTriggered = checks.filter(c => c.score > 0).map(c => c.rule);
  const score          = checks.reduce((total, c) => total + c.score, 0);
  const decision: FraudDecision =
    score >= SCORE_BLOCK  ? 'BLOCK'  :
    score >= SCORE_REVIEW ? 'REVIEW' :
    'ALLOW';

  // ── Structured log ──────────────────────────────────────────────────────────
  console.log(
    `[FRAUD] user=${ctx.userId} score=${score} decision=${decision}` +
    (rulesTriggered.length ? ` rules=[${rulesTriggered.join(',')}]` : ' rules=[]'),
  );

  // ── Persist fraud decision ──────────────────────────────────────────────────
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
    deviceId:       ctx.deviceId   ?? null,
    ipAddress:      ctx.ipAddress  ?? null,
    userAgent:      ctx.userAgent  ?? null,
    timestamp:      admin.firestore.Timestamp.now(),
  });

  return { decision, score, rulesTriggered, decisionId: decisionRef.id };
}

// ─── Helpers for recording device/IP trust signals ───────────────────────────

/**
 * recordTrustedDevice — call this after a user successfully authenticates
 * and confirms a new device (e.g. via 2FA) to prevent future NEW_DEVICE hits.
 */
export async function recordTrustedDevice(userId: string, deviceId: string): Promise<void> {
  const ref = adminDb.collection(FRAUD_COL.userDevices).doc(userId);
  await ref.set(
    { deviceIds: admin.firestore.FieldValue.arrayUnion(deviceId) },
    { merge: true },
  );
}

/**
 * recordTrustedIp — call this when a user successfully completes a transaction
 * from a new IP (post-REVIEW approval) to prevent future GEO_MISMATCH hits.
 */
export async function recordTrustedIp(userId: string, ipAddress: string): Promise<void> {
  const ref = adminDb.collection(FRAUD_COL.userIps).doc(userId);
  await ref.set(
    { ipAddresses: admin.firestore.FieldValue.arrayUnion(ipAddress) },
    { merge: true },
  );
}

/**
 * recordFailedLogin — call this on each failed authentication attempt.
 * Maintains a rolling timestamp list for burst detection.
 */
export async function recordFailedLogin(userId: string): Promise<void> {
  const ref     = adminDb.collection(FRAUD_COL.loginAttempts).doc(userId);
  const cutoff  = Date.now() - VELOCITY_WINDOW_MS;
  const doc     = await ref.get();
  const existing: number[] = doc.exists
    ? ((doc.data()!.failedAt ?? []) as number[]).filter((ts: number) => ts >= cutoff)
    : [];
  await ref.set({ failedAt: [...existing, Date.now()] });
}

// ─── Full fraud collection wipe (used by simulation reset) ───────────────────

export async function resetFraudCollections(): Promise<void> {
  const collections = Object.values(FRAUD_COL);
  await Promise.all(
    collections.map(async (col) => {
      const snap = await adminDb.collection(col).limit(500).get();
      if (snap.empty) return;
      const batch = adminDb.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }),
  );
  console.info('[FraudEngine] All fraud collections cleared.');
}

// ─── Export rule constants for tests ─────────────────────────────────────────

export const FRAUD_SCORES = {
  NEW_DEVICE:         20,
  NEW_RECIPIENT:      15,
  AMOUNT_ANOMALY:     25,
  VELOCITY_SPIKE:     30,
  FAILED_LOGIN_BURST: 20,
  GEO_MISMATCH:       25,
} as const;

export { SCORE_BLOCK, SCORE_REVIEW };

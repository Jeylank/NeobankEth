/**
 * server/services/agentPayoutService.ts
 * ──────────────────────────────────────
 * Agent Cash-Payout module for Sumsuma — hawala-style last-mile delivery,
 * fully tracked and OTP-verified.
 *
 * Collections used (Firestore):
 *   agents             — registered payout agents
 *   assignments        — transfer↔agent linkage records
 *   transfer_timeline  — immutable event log per transfer
 *   agent_otps         — hashed OTP + payout-session token (5-minute TTL)
 *   sim_transactions   — extended with payout_method, assigned_agent_id,
 *                        assignment_attempts, excluded_agent_ids, recipient_city
 *
 * Transfer state machine:
 *   PAYMENT_PENDING → FUNDS_RECEIVED → AGENT_ASSIGNED → OTP_SENT
 *   → READY_FOR_PAYOUT → PAID_OUT → COMPLETED | FAILED | TIMED_OUT
 *
 * Retry model:
 *   - Agent rejection triggers immediate auto-reassignment to next best agent
 *     (rejected agent is excluded from future attempts on this transfer).
 *   - Agent non-response for AGENT_RESPONSE_TIMEOUT_MS triggers checkAndReassignStaleAssignment().
 *   - After MAX_ASSIGNMENT_ATTEMPTS total attempts the transfer moves to FAILED.
 *   - OTP allows MAX_OTP_ATTEMPTS wrong guesses before invalidation (brute-force guard).
 *   - Transfer stuck in OTP_SENT beyond OTP_FLOW_TIMEOUT_MS moves to TIMED_OUT.
 */

import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { createBetaRiskAlert } from './betaRiskService';
import { adminDb } from '../firebaseAdmin';

// ─── Firestore collection keys ────────────────────────────────────────────────

export const AGENT_COL = {
  agents:   'agents',
  assigns:  'assignments',
  timeline: 'transfer_timeline',
  otps:     'agent_otps',
  txns:     'sim_transactions',
} as const;

// ─── Configurable timing / limit constants ────────────────────────────────────

export const AGENT_RESPONSE_TIMEOUT_MS  = 5 * 60 * 1000;   // 5 min to accept/reject
export const OTP_VALIDITY_MS            = 5 * 60 * 1000;   // 5 min OTP TTL
export const OTP_FLOW_TIMEOUT_MS        = 15 * 60 * 1000;  // 15 min: max time in OTP_SENT
export const MAX_ASSIGNMENT_ATTEMPTS    = 3;               // before transfer → FAILED
export const MAX_OTP_ATTEMPTS           = 3;               // wrong guesses before invalidation

// ─── Types ───────────────────────────────────────────────────────────────────

export type TransferState =
  | 'PAYMENT_PENDING' | 'FUNDS_RECEIVED' | 'AGENT_ASSIGNED' | 'OTP_SENT'
  | 'READY_FOR_PAYOUT' | 'PAID_OUT' | 'COMPLETED' | 'FAILED' | 'TIMED_OUT';

export type PayoutMethod       = 'bank' | 'mobile_money' | 'agent_cash';
export type AgentStatus        = 'online' | 'offline';
export type AssignmentStatus   = 'assigned' | 'accepted' | 'rejected' | 'timed_out' | 'completed';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface Agent {
  id:              string;
  full_name:       string;
  phone:           string;
  city:            string;
  status:          AgentStatus;
  available_float: number;
  score:           number;
  created_at:      string;
}

export interface Assignment {
  id:                string;
  transfer_id:       string;
  agent_id:          string;
  status:            AssignmentStatus;
  response_deadline: string;  // assigned_at + AGENT_RESPONSE_TIMEOUT_MS
  created_at:        string;
  updated_at:        string;
}

export interface TimelineEvent {
  transfer_id: string;
  status:      string;
  note:        string;
  created_at:  string;
}

interface TransferRecord extends Record<string, unknown> {
  status: TransferState;
  assigned_agent_id?: string;
  amount: number;
  currency?: string;
}

export function hasSufficientAgentFloat(
  agent: Pick<Agent, 'available_float'>,
  amount: number,
): boolean {
  return agent.available_float >= amount;
}

export function requireVerifiedOtp(record: { verified?: boolean }): void {
  if (!record.verified) {
    throw new AgentPayoutError(
      'OTP_NOT_VERIFIED',
      'OTP has not been verified. Call verify-otp first.',
      422,
    );
  }
}

export function requireUnpaidTransfer(status: TransferState): void {
  if (status === 'PAID_OUT' || status === 'COMPLETED') {
    throw new AgentPayoutError(
      'DUPLICATE_PAYOUT',
      `Transfer is already ${status} — duplicate payout blocked.`,
      409,
    );
  }
}

// ─── Typed error codes (map to HTTP status in route layer) ───────────────────

export class AgentPayoutError extends Error {
  constructor(
    public readonly code:    string,
    message:                 string,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'AgentPayoutError';
  }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function generate6DigitOtp(): string {
  // Cryptographically random 6-digit OTP (avoids Math.random bias)
  const buf = crypto.randomBytes(4);
  const num = buf.readUInt32BE(0) % 900_000 + 100_000;
  return String(num);
}

function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function deadlineISO(fromMs = Date.now(), windowMs = AGENT_RESPONSE_TIMEOUT_MS): string {
  return new Date(fromMs + windowMs).toISOString();
}

// ─── Timeline logging ─────────────────────────────────────────────────────────

export async function logTimeline(
  transfer_id: string,
  status:      string,
  note:        string,
): Promise<void> {
  await adminDb.collection(AGENT_COL.timeline).add({
    transfer_id,
    status,
    note,
    created_at: new Date().toISOString(),
  } as TimelineEvent);
  console.log(`[AgentPayout] Timeline — transfer=${transfer_id} status=${status} note="${note}"`);
}

// ─── Agent CRUD ───────────────────────────────────────────────────────────────

export async function createAgent(data: Omit<Agent, 'id' | 'created_at'>): Promise<Agent> {
  // Validate phone: must be non-empty, 7–20 chars, digits/+/- only
  if (!/^\+?[\d\s\-]{7,20}$/.test(data.phone)) {
    throw new AgentPayoutError('INVALID_PHONE', 'phone must be 7–20 digits (with optional + prefix).', 400);
  }
  if (data.score < 0 || data.score > 1000) {
    throw new AgentPayoutError('INVALID_SCORE', 'score must be between 0 and 1000.', 400);
  }

  const agent: Omit<Agent, 'id'> = { ...data, created_at: new Date().toISOString() };
  const ref = await adminDb.collection(AGENT_COL.agents).add(agent);
  return { id: ref.id, ...agent };
}

export async function listAgents(city?: string): Promise<Agent[]> {
  let q: FirebaseFirestore.Query = adminDb.collection(AGENT_COL.agents);
  if (city) q = q.where('city', '==', city);
  const snap = await q.get();
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Agent, 'id'>) }));
}

export async function getAgent(agentId: string): Promise<Agent | null> {
  const doc = await adminDb.collection(AGENT_COL.agents).doc(agentId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as Omit<Agent, 'id'>) };
}

// ─── Assignment helpers ───────────────────────────────────────────────────────

const TERMINAL_STATES = new Set(['PAID_OUT', 'COMPLETED', 'FAILED', 'BLOCKED_FRAUD', 'TIMED_OUT']);

async function findActiveAssignmentForAgent(agentId: string): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const snap = await adminDb
    .collection(AGENT_COL.assigns)
    .where('agent_id', '==', agentId)
    .where('status',   '==', 'assigned')
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

// ─── Agent assignment ─────────────────────────────────────────────────────────

/**
 * assignBestAgent — select the highest-scoring online agent in the same city
 * with enough float (excluding previously rejected/timed-out agents), create
 * an assignment record, and advance transfer state to AGENT_ASSIGNED.
 *
 * Retry-aware: increments assignment_attempts on the transfer doc. Throws
 * MAX_ATTEMPTS_REACHED (→ FAILED) when the attempt ceiling is hit.
 */
export async function assignBestAgent(
  transferId:      string,
  cityOverride?:   string,
  excludeAgentIds: string[] = [],
): Promise<{ assignment: Assignment; agent: Agent }> {
  const txDoc = await adminDb.collection(AGENT_COL.txns).doc(transferId).get();
  if (!txDoc.exists) {
    throw new AgentPayoutError('TRANSFER_NOT_FOUND', `Transfer ${transferId} not found.`, 404);
  }

  const tx        = txDoc.data()!;
  const amount    = tx.amount   as number;
  const currency  = (tx.currency ?? tx.sourceCurrency ?? 'USD') as string;
  const attempts  = (tx.assignment_attempts as number | undefined) ?? 0;

  // Merge persisted excluded IDs with caller-supplied ones
  const persistedExcluded: string[] = (tx.excluded_agent_ids as string[] | undefined) ?? [];
  const allExcluded = [...new Set([...persistedExcluded, ...excludeAgentIds])];

  // Resolve city
  const recipientCity =
    cityOverride ??
    (tx.recipient_city   as string | undefined) ??
    (tx.recipientCity    as string | undefined) ??
    (tx.city             as string | undefined);

  if (!recipientCity) {
    throw new AgentPayoutError(
      'MISSING_CITY',
      'Recipient city is required. Pass it in the request body as "city".',
      400,
    );
  }

  // Terminal state guard
  if (TERMINAL_STATES.has(tx.status as string)) {
    throw new AgentPayoutError(
      'TRANSFER_TERMINAL',
      `Cannot assign agent — transfer is in terminal state: ${tx.status}.`,
      422,
    );
  }

  // Retry ceiling
  if (attempts >= MAX_ASSIGNMENT_ATTEMPTS) {
    await adminDb.collection(AGENT_COL.txns).doc(transferId).update({
      status:    'FAILED',
      failReason: `Exhausted ${MAX_ASSIGNMENT_ATTEMPTS} assignment attempts — no eligible agent responded.`,
      updatedAt: admin.firestore.Timestamp.now(),
    });
    await logTimeline(
      transferId, 'FAILED',
      `No eligible agent responded after ${MAX_ASSIGNMENT_ATTEMPTS} attempts. Transfer failed.`,
    );
    throw new AgentPayoutError(
      'MAX_ATTEMPTS_REACHED',
      `Transfer failed — exhausted ${MAX_ASSIGNMENT_ATTEMPTS} agent assignment attempts.`,
      422,
    );
  }

  // Query eligible agents (single-field Firestore queries, sort in-memory)
  const agentSnap = await adminDb
    .collection(AGENT_COL.agents)
    .where('city',   '==', recipientCity)
    .where('status', '==', 'online')
    .get();

  const eligible = agentSnap.docs
    .map(d => ({ id: d.id, ...(d.data() as Omit<Agent, 'id'>) }))
    .filter(a => !allExcluded.includes(a.id))
    .filter(a => hasSufficientAgentFloat(a, amount))
    .sort((a, b) => b.score - a.score);

  if (eligible.length === 0) {
    const reason = agentSnap.empty
      ? `No agents registered in ${recipientCity}.`
      : allExcluded.length > 0
        ? `All agents in ${recipientCity} with sufficient float have already been tried.`
        : `No online agents in ${recipientCity} have float ≥ ${amount} ${currency}.`;
    await logTimeline(transferId, 'NO_AGENT', reason);
    throw new AgentPayoutError('NO_ELIGIBLE_AGENT', reason, 422);
  }

  const agent = eligible[0];
  const now   = new Date().toISOString();

  const assignData: Omit<Assignment, 'id'> = {
    transfer_id:       transferId,
    agent_id:          agent.id,
    status:            'assigned',
    response_deadline: deadlineISO(),
    created_at:        now,
    updated_at:        now,
  };
  const assignRef  = await adminDb.collection(AGENT_COL.assigns).add(assignData);
  const assignment: Assignment = { id: assignRef.id, ...assignData };

  // Update transfer
  await adminDb.collection(AGENT_COL.txns).doc(transferId).update({
    assigned_agent_id:   agent.id,
    payout_method:       'agent_cash',
    status:              'AGENT_ASSIGNED',
    recipient_city:      recipientCity,       // persist for future reassignments
    assignment_attempts: attempts + 1,
    excluded_agent_ids:  allExcluded,
    updatedAt:           admin.firestore.Timestamp.now(),
  });

  await logTimeline(
    transferId, 'AGENT_ASSIGNED',
    `Attempt ${attempts + 1}/${MAX_ASSIGNMENT_ATTEMPTS}: Agent ${agent.full_name} (${agent.city}) assigned — score ${agent.score}, float ${agent.available_float} ${currency}. Response deadline: ${assignment.response_deadline}.`,
  );
  console.log(`[AgentPayout] Agent assigned — transfer=${transferId} agent=${agent.id} attempt=${attempts + 1}`);
  return { assignment, agent };
}

// ─── Accept / Reject assignment ───────────────────────────────────────────────

export interface RespondResult {
  assignment:       Assignment;
  autoReassignment: { assignment: Assignment; agent: Agent } | null;
  noAgentReason?:   string;
}

/**
 * respondToAssignment — agent accepts or rejects their pending assignment.
 *
 * On reject: immediately attempts auto-reassignment to the next best agent,
 * excluding the rejecting agent. If no other agent is available, transfer
 * returns to FUNDS_RECEIVED with autoReassignment: null.
 */
export async function respondToAssignment(
  agentId: string,
  action:  'accept' | 'reject',
): Promise<RespondResult> {
  const assignDoc = await findActiveAssignmentForAgent(agentId);
  if (!assignDoc) {
    throw new AgentPayoutError(
      'NO_PENDING_ASSIGNMENT',
      `No pending (unaccepted) assignment found for agent ${agentId}.`,
      404,
    );
  }

  const assignment = { id: assignDoc.id, ...(assignDoc.data() as Omit<Assignment, 'id'>) };
  const now        = new Date().toISOString();

  if (action === 'accept') {
    await assignDoc.ref.update({ status: 'accepted', updated_at: now });
    await logTimeline(assignment.transfer_id, 'AGENT_ASSIGNED', `Agent ${agentId} accepted assignment.`);
    console.log(`[AgentPayout] Assignment accepted — agent=${agentId} transfer=${assignment.transfer_id}`);
    return { assignment: { ...assignment, status: 'accepted', updated_at: now }, autoReassignment: null };
  }

  // ── REJECT path ───────────────────────────────────────────────────────────
  await assignDoc.ref.update({ status: 'rejected', updated_at: now });
  await logTimeline(
    assignment.transfer_id, 'ASSIGNMENT_REJECTED',
    `Agent ${agentId} rejected. Attempting auto-reassignment.`,
  );
  console.log(`[AgentPayout] Assignment rejected — agent=${agentId} transfer=${assignment.transfer_id}`);

  // Attempt immediate reassignment, excluding the rejecting agent
  try {
    const reassign = await assignBestAgent(assignment.transfer_id, undefined, [agentId]);
    return {
      assignment: { ...assignment, status: 'rejected', updated_at: now },
      autoReassignment: reassign,
    };
  } catch (err: any) {
    // No other agent available → return to queue
    await adminDb.collection(AGENT_COL.txns).doc(assignment.transfer_id).update({
      assigned_agent_id: null,
      status:            'FUNDS_RECEIVED',
      updatedAt:         admin.firestore.Timestamp.now(),
    });
    await logTimeline(
      assignment.transfer_id, 'FUNDS_RECEIVED',
      `No replacement agent available after rejection. Transfer returned to queue. Reason: ${err.message}`,
    );
    return {
      assignment:       { ...assignment, status: 'rejected', updated_at: now },
      autoReassignment: null,
      noAgentReason:    err.message,
    };
  }
}

// ─── Stale-assignment detection and auto-reassignment ────────────────────────

export interface StaleAssignmentInfo {
  transferId:  string;
  agentId:     string;
  agentName?:  string;
  staleMs:     number;
  deadline:    string;
}

/**
 * scanStaleAssignments — find all transfers with an unresponded assignment
 * whose response_deadline has passed.
 */
export async function scanStaleAssignments(): Promise<StaleAssignmentInfo[]> {
  const snap = await adminDb
    .collection(AGENT_COL.assigns)
    .where('status', '==', 'assigned')
    .get();

  const now    = Date.now();
  const stale: StaleAssignmentInfo[] = [];

  for (const doc of snap.docs) {
    const data     = doc.data() as Omit<Assignment, 'id'>;
    const deadline = new Date(data.response_deadline).getTime();
    if (now > deadline) {
      stale.push({
        transferId: data.transfer_id,
        agentId:    data.agent_id,
        staleMs:    now - deadline,
        deadline:   data.response_deadline,
      });
    }
  }

  return stale;
}

/**
 * checkAndReassignStaleAssignment — if the agent assigned to transferId has not
 * responded within AGENT_RESPONSE_TIMEOUT_MS, mark them as timed_out and assign
 * the next best agent.
 *
 * Safe to call proactively on any transfer — returns immediately if no stale
 * assignment exists.
 */
export async function checkAndReassignStaleAssignment(transferId: string): Promise<{
  wasStale:        boolean;
  timedOutAgentId?: string;
  reassignment?:   { assignment: Assignment; agent: Agent } | null;
  reason?:         string;
}> {
  const txDoc = await adminDb.collection(AGENT_COL.txns).doc(transferId).get();
  if (!txDoc.exists) {
    throw new AgentPayoutError('TRANSFER_NOT_FOUND', `Transfer ${transferId} not found.`, 404);
  }

  const tx = txDoc.data()!;
  if (tx.status !== 'AGENT_ASSIGNED') {
    return { wasStale: false };
  }

  // Find the pending (unresponded) assignment
  const assignSnap = await adminDb
    .collection(AGENT_COL.assigns)
    .where('transfer_id', '==', transferId)
    .where('status',      '==', 'assigned')
    .limit(1)
    .get();

  if (assignSnap.empty) return { wasStale: false };

  const assignDoc  = assignSnap.docs[0];
  const assignment = assignDoc.data() as Omit<Assignment, 'id'>;
  const deadline   = new Date(assignment.response_deadline).getTime();

  if (Date.now() <= deadline) {
    return { wasStale: false };
  }

  // ── Assignment is stale ───────────────────────────────────────────────────
  const timedOutAgentId = assignment.agent_id;
  const staleSecs       = Math.round((Date.now() - deadline) / 1000);

  await assignDoc.ref.update({ status: 'timed_out', updated_at: new Date().toISOString() });
  await logTimeline(
    transferId, 'ASSIGNMENT_TIMEOUT',
    `Agent ${timedOutAgentId} did not respond within ${AGENT_RESPONSE_TIMEOUT_MS / 60_000} minutes (${staleSecs}s past deadline). Auto-reassigning.`,
  );
  console.log(`[AgentPayout] Assignment timed out — transfer=${transferId} agent=${timedOutAgentId} overdue=${staleSecs}s`);

  // Attempt reassignment, excluding the timed-out agent
  try {
    const reassign = await assignBestAgent(transferId, undefined, [timedOutAgentId]);
    return { wasStale: true, timedOutAgentId, reassignment: reassign };
  } catch (err: any) {
    await adminDb.collection(AGENT_COL.txns).doc(transferId).update({
      assigned_agent_id: null,
      status:            'FUNDS_RECEIVED',
      updatedAt:         admin.firestore.Timestamp.now(),
    });
    await logTimeline(
      transferId, 'FUNDS_RECEIVED',
      `No replacement agent available after timeout. Transfer returned to queue. Reason: ${err.message}`,
    );
    return { wasStale: true, timedOutAgentId, reassignment: null, reason: err.message };
  }
}

// ─── OTP: generate & send ─────────────────────────────────────────────────────

/**
 * sendOtp — generates a 6-digit OTP (cryptographically random), stores its
 * SHA-256 hash with a 5-minute TTL, checks for stale assignment first.
 *
 * Resend-safe: calling again invalidates the previous OTP and issues a fresh one.
 */
export async function sendOtp(transferId: string): Promise<{
  otp:       string;
  expiresAt: string;
  staleCheck?: { wasStale: boolean; timedOutAgentId?: string };
}> {
  const txDoc = await adminDb.collection(AGENT_COL.txns).doc(transferId).get();
  if (!txDoc.exists) {
    throw new AgentPayoutError('TRANSFER_NOT_FOUND', `Transfer ${transferId} not found.`, 404);
  }
  const tx = txDoc.data()!;

  // If still in AGENT_ASSIGNED, check for stale agent first
  let staleCheck: { wasStale: boolean; timedOutAgentId?: string } | undefined;
  if (tx.status === 'AGENT_ASSIGNED') {
    staleCheck = await checkAndReassignStaleAssignment(transferId);
    if (staleCheck.wasStale) {
      // Re-read transfer after potential reassignment
      const refreshed = await adminDb.collection(AGENT_COL.txns).doc(transferId).get();
      const refreshedStatus = refreshed.data()?.status;
      if (refreshedStatus !== 'AGENT_ASSIGNED') {
        throw new AgentPayoutError(
          'NO_ELIGIBLE_AGENT',
          `Previous agent timed out and no replacement found — transfer is now ${refreshedStatus}.`,
          422,
        );
      }
    }
  }

  // Validate transfer is in an OTP-sendable state (agent must be assigned)
  const reloadedDoc = await adminDb.collection(AGENT_COL.txns).doc(transferId).get();
  const reloaded    = reloadedDoc.data()!;
  if (!['AGENT_ASSIGNED', 'OTP_SENT'].includes(reloaded.status as string)) {
    throw new AgentPayoutError(
      'INVALID_STATE_FOR_OTP',
      `OTP can only be sent when transfer is AGENT_ASSIGNED or OTP_SENT. Current: ${reloaded.status}`,
      422,
    );
  }

  // Check transfer hasn't been in OTP_SENT too long (transfer timeout)
  if (reloaded.status === 'OTP_SENT') {
    const otpSentAt = reloaded.otpSentAt?.toMillis?.() ?? 0;
    if (otpSentAt && Date.now() - otpSentAt > OTP_FLOW_TIMEOUT_MS) {
      await adminDb.collection(AGENT_COL.txns).doc(transferId).update({
        status:    'TIMED_OUT',
        failReason: 'Transfer timed out: recipient did not verify OTP within the allowed window.',
        updatedAt:  admin.firestore.Timestamp.now(),
      });
      await logTimeline(
        transferId, 'TIMED_OUT',
        `Transfer timed out — OTP_SENT state exceeded ${OTP_FLOW_TIMEOUT_MS / 60_000} minutes without verification.`,
      );
      throw new AgentPayoutError(
        'TRANSFER_TIMED_OUT',
        `Transfer timed out — the ${OTP_FLOW_TIMEOUT_MS / 60_000}-minute OTP verification window has elapsed.`,
        410,
      );
    }
  }

  const otp       = generate6DigitOtp();
  const expiresAt = deadlineISO(Date.now(), OTP_VALIDITY_MS);

  // Upsert OTP record — overwrite on resend, reset attempt counter
  await adminDb.collection(AGENT_COL.otps).doc(transferId).set({
    transfer_id:      transferId,
    hashed_otp:       sha256(otp),
    expires_at:       expiresAt,
    verified:         false,
    failed_attempts:  0,
    payout_token:     null,
    created_at:       new Date().toISOString(),
  });

  await adminDb.collection(AGENT_COL.txns).doc(transferId).update({
    status:     'OTP_SENT',
    otpSentAt:  admin.firestore.Timestamp.now(),
    updatedAt:  admin.firestore.Timestamp.now(),
  });

  await logTimeline(transferId, 'OTP_SENT', `OTP dispatched to recipient. Expires: ${expiresAt}`);
  console.log(`[AgentPayout] OTP generated — transfer=${transferId} expires=${expiresAt}`);

  return { otp, expiresAt, staleCheck };
}

// ─── OTP: verify ─────────────────────────────────────────────────────────────

/**
 * verifyOtp — validate the 6-digit OTP.
 *
 * Safety:
 *   - Rejects expired OTPs (410).
 *   - Tracks failed attempts; after MAX_OTP_ATTEMPTS wrong guesses the OTP is
 *     invalidated and the recipient must request a new one (429).
 *   - Timing-safe comparison (sha256 constant-time via Node.js crypto).
 *   - Issues a single-use payout token on success.
 */
export async function verifyOtp(
  transferId: string,
  otp:        string,
): Promise<{ payoutToken: string }> {
  // Validate OTP format up front
  if (!/^\d{6}$/.test(otp)) {
    throw new AgentPayoutError('INVALID_OTP_FORMAT', 'OTP must be exactly 6 digits.', 400);
  }

  const otpDoc = await adminDb.collection(AGENT_COL.otps).doc(transferId).get();
  if (!otpDoc.exists) {
    throw new AgentPayoutError('OTP_NOT_FOUND', 'OTP record not found. Call send-otp first.', 404);
  }

  const record  = otpDoc.data()!;
  const failed  = (record.failed_attempts as number | undefined) ?? 0;

  if (record.verified) {
    throw new AgentPayoutError('OTP_ALREADY_USED', 'OTP already used. Request a new one via send-otp.', 409);
  }

  // Brute-force guard — check attempt count BEFORE comparing hash
  if (failed >= MAX_OTP_ATTEMPTS) {
    throw new AgentPayoutError(
      'OTP_ATTEMPTS_EXHAUSTED',
      `OTP invalidated after ${MAX_OTP_ATTEMPTS} failed attempts. Call send-otp to receive a new code.`,
      429,
    );
  }

  // Expiry check
  if (new Date(record.expires_at) < new Date()) {
    await logTimeline(transferId, 'OTP_EXPIRED', 'OTP expired before verification.');
    throw new AgentPayoutError(
      'OTP_EXPIRED',
      'OTP has expired (5-minute window). Call send-otp to receive a new code.',
      410,
    );
  }

  // Timing-safe hash comparison
  const hashedInput  = sha256(otp);
  const isMatch      = crypto.timingSafeEqual(
    Buffer.from(hashedInput,       'hex'),
    Buffer.from(record.hashed_otp, 'hex'),
  );

  if (!isMatch) {
    const newFailed    = failed + 1;
    const remaining    = MAX_OTP_ATTEMPTS - newFailed;
    await otpDoc.ref.update({ failed_attempts: newFailed });
    if (remaining === 0) {
      await logTimeline(transferId, 'OTP_ATTEMPTS_EXHAUSTED', `OTP invalidated after ${MAX_OTP_ATTEMPTS} failed attempts.`);
      throw new AgentPayoutError(
        'OTP_ATTEMPTS_EXHAUSTED',
        `Incorrect OTP. OTP invalidated after ${MAX_OTP_ATTEMPTS} attempts. Call send-otp to receive a new code.`,
        429,
      );
    }
    throw new AgentPayoutError(
      'INVALID_OTP',
      `Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      422,
    );
  }

  // OTP correct — issue single-use payout token
  const payoutToken = generateSecureToken();
  const hashedToken = sha256(payoutToken);

  await otpDoc.ref.update({
    verified:     true,
    payout_token: hashedToken,
    verified_at:  new Date().toISOString(),
  });

  await adminDb.collection(AGENT_COL.txns).doc(transferId).update({
    status:    'READY_FOR_PAYOUT',
    updatedAt: admin.firestore.Timestamp.now(),
  });

  await logTimeline(transferId, 'READY_FOR_PAYOUT', 'OTP verified — transfer approved for cash payout.');
  console.log(`[AgentPayout] OTP verified — transfer=${transferId}`);

  return { payoutToken };
}

// ─── Payout: mark paid ────────────────────────────────────────────────────────

/**
 * markPaid — execute the final cash payout.
 *
 * Safety checks (all inside a Firestore atomic transaction):
 *   1. Payout token valid and not already consumed (replay prevention).
 *   2. Transfer must be READY_FOR_PAYOUT (idempotency guard).
 *   3. Agent float must still cover the amount (concurrent depletion guard).
 */
export async function markPaid(
  transferId:  string,
  payoutToken: string,
): Promise<{ transfer: Record<string, unknown>; agent: Agent }> {
  if (!payoutToken || payoutToken.length !== 64) {
    throw new AgentPayoutError('INVALID_TOKEN_FORMAT', 'payout_token must be a 64-character hex string.', 400);
  }

  const otpDoc = await adminDb.collection(AGENT_COL.otps).doc(transferId).get();
  if (!otpDoc.exists) {
    throw new AgentPayoutError('OTP_NOT_FOUND', 'OTP record not found. OTP must be verified first.', 404);
  }

  const record = otpDoc.data()!;
  requireVerifiedOtp(record);
  if (!record.payout_token) {
    throw new AgentPayoutError('TOKEN_CONSUMED', 'Payout token has already been consumed.', 409);
  }

  const hashedInput = sha256(payoutToken);
  const isMatch     = crypto.timingSafeEqual(
    Buffer.from(hashedInput,          'hex'),
    Buffer.from(record.payout_token,  'hex'),
  );
  if (!isMatch) {
    throw new AgentPayoutError('INVALID_TOKEN', 'Invalid payout token.', 422);
  }

  // All state-critical checks run inside an atomic transaction
  const result = await adminDb.runTransaction(async (t) => {
    const txRef  = adminDb.collection(AGENT_COL.txns).doc(transferId);
    const txDoc  = await t.get(txRef);
    if (!txDoc.exists) {
      throw new AgentPayoutError('TRANSFER_NOT_FOUND', `Transfer ${transferId} not found.`, 404);
    }
    const tx = txDoc.data()! as TransferRecord;

    requireUnpaidTransfer(tx.status);
    if (tx.status === 'PAID_OUT' || tx.status === 'COMPLETED') {
      throw new AgentPayoutError(
        'DUPLICATE_PAYOUT',
        `Transfer is already ${tx.status} — duplicate payout blocked.`,
        409,
      );
    }
    if (tx.status !== 'READY_FOR_PAYOUT') {
      throw new AgentPayoutError(
        'INVALID_STATE',
        `Transfer must be READY_FOR_PAYOUT to mark paid. Current: ${tx.status}`,
        422,
      );
    }

    const agentId  = tx.assigned_agent_id as string;
    const amount   = tx.amount as number;

    if (!agentId) {
      throw new AgentPayoutError('NO_ASSIGNED_AGENT', 'Transfer has no assigned agent.', 422);
    }

    const agentRef = adminDb.collection(AGENT_COL.agents).doc(agentId);
    const agentDoc = await t.get(agentRef);
    if (!agentDoc.exists) {
      throw new AgentPayoutError('AGENT_NOT_FOUND', `Assigned agent ${agentId} not found.`, 404);
    }

    const agent = { id: agentDoc.id, ...(agentDoc.data() as Omit<Agent, 'id'>) };
    if (agent.available_float < amount) {
      throw new AgentPayoutError(
        'INSUFFICIENT_FLOAT',
        `Agent float insufficient: has ${agent.available_float}, needs ${amount} ${tx.currency ?? ''}.`,
        422,
      );
    }

    // Debit agent float
    t.update(agentRef, { available_float: admin.firestore.FieldValue.increment(-amount) });

    const payoutLedgerRef = adminDb.collection('sim_ledger').doc(`${transferId}_agent_payout`);
    t.set(payoutLedgerRef, {
      journalId: payoutLedgerRef.id,
      transactionId: transferId,
      type: 'AGENT_CASH_PAYOUT',
      currency: tx.currency,
      amount,
      agentId,
      agentFloatBefore: agent.available_float,
      agentFloatAfter: agent.available_float - amount,
      entries: [
        { account: 'remittance:clearing', side: 'CREDIT', amount },
        { account: `agent:${agentId}:cash`, side: 'DEBIT', amount },
      ],
      createdAt: admin.firestore.Timestamp.now(),
    });

    // Mark transfer PAID_OUT
    t.update(txRef, {
      status:    'PAID_OUT',
      paidOutAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });

    // Complete assignment record
    const assignSnap = await adminDb
      .collection(AGENT_COL.assigns)
      .where('transfer_id', '==', transferId)
      .where('agent_id',    '==', agentId)
      .limit(1)
      .get();
    if (!assignSnap.empty) {
      t.update(assignSnap.docs[0].ref, { status: 'completed', updated_at: new Date().toISOString() });
    }

    // Consume payout token
    t.update(adminDb.collection(AGENT_COL.otps).doc(transferId), {
      payout_token: null,
      paid_at:      new Date().toISOString(),
    });

    return {
      tx:    { ...tx, status: 'PAID_OUT' },
      agent: { ...agent, available_float: agent.available_float - amount },
    };
  });

  await logTimeline(
    transferId, 'PAID_OUT',
    `Cash paid by agent ${result.agent.full_name} (${result.agent.city}). Float debited: ${result.tx.amount} ${result.tx.currency ?? ''}.`,
  );
  console.log(`[AgentPayout] Payout complete — transfer=${transferId} agent=${result.agent.id} amount=${result.tx.amount}`);

  if (result.agent.available_float < 500) {
    await createBetaRiskAlert('LOW_AGENT_FLOAT', result.agent.id, {
      transactionId: transferId,
      availableFloat: result.agent.available_float,
      currency: result.tx.currency ?? null,
    });
  }
  return { transfer: result.tx, agent: result.agent };
}

// ─── Transfer timeline query ──────────────────────────────────────────────────

export async function getTimeline(transferId: string): Promise<TimelineEvent[]> {
  const snap = await adminDb
    .collection(AGENT_COL.timeline)
    .where('transfer_id', '==', transferId)
    .get();
  return snap.docs
    .map(d => d.data() as TimelineEvent)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

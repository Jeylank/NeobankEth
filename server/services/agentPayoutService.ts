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
 *   sim_transactions   — extended with payout_method + assigned_agent_id
 *
 * Transfer state machine:
 *   PAYMENT_PENDING → FUNDS_RECEIVED → AGENT_ASSIGNED → OTP_SENT
 *   → READY_FOR_PAYOUT → PAID_OUT → COMPLETED | FAILED
 */

import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { adminDb } from '../firebaseAdmin';

// ─── Firestore collection keys ────────────────────────────────────────────────

export const AGENT_COL = {
  agents:   'agents',
  assigns:  'assignments',
  timeline: 'transfer_timeline',
  otps:     'agent_otps',
  txns:     'sim_transactions',
} as const;

// ─── Transfer state machine ───────────────────────────────────────────────────

export type TransferState =
  | 'PAYMENT_PENDING'
  | 'FUNDS_RECEIVED'
  | 'AGENT_ASSIGNED'
  | 'OTP_SENT'
  | 'READY_FOR_PAYOUT'
  | 'PAID_OUT'
  | 'COMPLETED'
  | 'FAILED';

export type PayoutMethod = 'bank' | 'mobile_money' | 'agent_cash';

export type AgentStatus = 'online' | 'offline';

export type AssignmentStatus = 'assigned' | 'accepted' | 'rejected' | 'completed';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface Agent {
  id:             string;
  full_name:      string;
  phone:          string;
  city:           string;
  status:         AgentStatus;
  available_float: number;
  score:          number;
  created_at:     string;
}

export interface Assignment {
  id:          string;
  transfer_id: string;
  agent_id:    string;
  status:      AssignmentStatus;
  created_at:  string;
  updated_at:  string;
}

export interface TimelineEvent {
  transfer_id: string;
  status:      string;
  note:        string;
  created_at:  string;
}

// ─── Helper: SHA-256 hash ─────────────────────────────────────────────────────

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function generateOtp(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Timeline logging ─────────────────────────────────────────────────────────

export async function logTimeline(
  transfer_id: string,
  status: string,
  note: string,
): Promise<void> {
  const event: TimelineEvent = {
    transfer_id,
    status,
    note,
    created_at: new Date().toISOString(),
  };
  await adminDb.collection(AGENT_COL.timeline).add(event);
  console.log(`[AgentPayout] Timeline — transfer=${transfer_id} status=${status} note="${note}"`);
}

// ─── Agent CRUD ───────────────────────────────────────────────────────────────

export async function createAgent(
  data: Omit<Agent, 'id' | 'created_at'>,
): Promise<Agent> {
  const agent: Omit<Agent, 'id'> = {
    ...data,
    created_at: new Date().toISOString(),
  };
  const ref = await adminDb.collection(AGENT_COL.agents).add(agent);
  return { id: ref.id, ...agent };
}

export async function listAgents(city?: string): Promise<Agent[]> {
  let query: FirebaseFirestore.Query = adminDb.collection(AGENT_COL.agents);
  if (city) {
    query = query.where('city', '==', city);
  }
  const snap = await query.get();
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Agent, 'id'>) }));
}

export async function getAgent(agentId: string): Promise<Agent | null> {
  const doc = await adminDb.collection(AGENT_COL.agents).doc(agentId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as Omit<Agent, 'id'>) };
}

// ─── Agent assignment ─────────────────────────────────────────────────────────

// States that are considered eligible for agent assignment
const ASSIGNABLE_STATES = new Set([
  'PROCESSING', 'FUNDS_RECEIVED', 'PENDING_REVIEW', 'AGENT_ASSIGNED',
]);

/**
 * assignBestAgent — select the highest-scoring online agent in the same city
 * with enough float, create an assignment record, and advance transfer state.
 *
 * @param transferId  Firestore document ID of the transfer
 * @param cityOverride  Recipient city — required when the transfer doc doesn't
 *                      store recipientCity (e.g. remittance/initiate payloads).
 *                      Can also be passed explicitly to override the stored value.
 */
export async function assignBestAgent(
  transferId:   string,
  cityOverride?: string,
): Promise<{ assignment: Assignment; agent: Agent }> {
  // 1. Load the transfer
  const txDoc = await adminDb.collection(AGENT_COL.txns).doc(transferId).get();
  if (!txDoc.exists) throw new Error(`Transfer ${transferId} not found.`);

  const tx = txDoc.data()!;
  const amount:   number = tx.amount   as number;
  const currency: string = (tx.currency ?? tx.sourceCurrency ?? 'USD') as string;

  // Resolve city — stored field OR explicit override
  const recipientCity =
    cityOverride ??
    (tx.recipientCity as string | undefined) ??
    (tx.city         as string | undefined);

  if (!recipientCity) {
    throw new Error(
      'Recipient city is required for agent assignment. ' +
      'Pass it in the request body as "city" or ensure the transfer stores recipientCity.',
    );
  }

  // Guard: avoid assigning to already-paid or failed transfers
  const terminalStates = new Set(['PAID_OUT', 'COMPLETED', 'FAILED', 'BLOCKED_FRAUD']);
  if (terminalStates.has(tx.status as string)) {
    throw new Error(`Cannot assign agent — transfer is in terminal state: ${tx.status}.`);
  }

  // 2. Query eligible agents (Firestore: single-field filters, sort in-memory)
  const agentSnap = await adminDb
    .collection(AGENT_COL.agents)
    .where('city',   '==',     recipientCity)
    .where('status', '==',     'online')
    .get();

  const eligible = agentSnap.docs
    .map(d => ({ id: d.id, ...(d.data() as Omit<Agent, 'id'>) }))
    .filter(a => a.available_float >= amount)
    .sort((a, b) => b.score - a.score);

  if (eligible.length === 0) {
    throw new Error(
      `No eligible agents in ${recipientCity} with float ≥ ${amount} ${currency}.`,
    );
  }

  const agent = eligible[0];

  // 3. Create assignment record
  const now = new Date().toISOString();
  const assignData: Omit<Assignment, 'id'> = {
    transfer_id: transferId,
    agent_id:    agent.id,
    status:      'assigned',
    created_at:  now,
    updated_at:  now,
  };
  const assignRef = await adminDb.collection(AGENT_COL.assigns).add(assignData);
  const assignment: Assignment = { id: assignRef.id, ...assignData };

  // 4. Update transfer with agent + new state
  await adminDb.collection(AGENT_COL.txns).doc(transferId).update({
    assigned_agent_id: agent.id,
    payout_method:     'agent_cash',
    status:            'AGENT_ASSIGNED',
    updatedAt:         admin.firestore.Timestamp.now(),
  });

  await logTimeline(transferId, 'AGENT_ASSIGNED', `Agent ${agent.full_name} (${agent.city}) assigned — score ${agent.score}`);
  console.log(`[AgentPayout] Agent assigned — transfer=${transferId} agent=${agent.id} (${agent.full_name})`);

  return { assignment, agent };
}

// ─── Accept / Reject assignment ───────────────────────────────────────────────

export async function respondToAssignment(
  agentId:    string,
  action:     'accept' | 'reject',
): Promise<Assignment> {
  // Find the active assignment for this agent
  const snap = await adminDb
    .collection(AGENT_COL.assigns)
    .where('agent_id', '==', agentId)
    .where('status',   '==', 'assigned')
    .limit(1)
    .get();

  if (snap.empty) {
    throw new Error(`No pending assignment found for agent ${agentId}.`);
  }

  const assignDoc = snap.docs[0];
  const assignment = { id: assignDoc.id, ...(assignDoc.data() as Omit<Assignment, 'id'>) };
  const now = new Date().toISOString();

  const newStatus: AssignmentStatus = action === 'accept' ? 'accepted' : 'rejected';
  await assignDoc.ref.update({ status: newStatus, updated_at: now });

  if (action === 'reject') {
    // Clear the agent from the transfer so it can be re-assigned
    await adminDb.collection(AGENT_COL.txns).doc(assignment.transfer_id).update({
      assigned_agent_id: null,
      status:            'FUNDS_RECEIVED',
      updatedAt:         admin.firestore.Timestamp.now(),
    });
    await logTimeline(assignment.transfer_id, 'FUNDS_RECEIVED', `Agent ${agentId} rejected — transfer returned to queue.`);
    console.log(`[AgentPayout] Assignment rejected — agent=${agentId} transfer=${assignment.transfer_id}`);
  } else {
    await logTimeline(assignment.transfer_id, 'AGENT_ASSIGNED', `Agent ${agentId} accepted assignment.`);
    console.log(`[AgentPayout] Assignment accepted — agent=${agentId} transfer=${assignment.transfer_id}`);
  }

  return { ...assignment, status: newStatus, updated_at: now };
}

// ─── OTP: generate & send ─────────────────────────────────────────────────────

/**
 * sendOtp — generate a 6-digit OTP, store its hash with a 5-minute TTL,
 * and return the plain OTP (caller is responsible for delivering it via SMS/push).
 */
export async function sendOtp(transferId: string): Promise<{ otp: string; expiresAt: string }> {
  const txDoc = await adminDb.collection(AGENT_COL.txns).doc(transferId).get();
  if (!txDoc.exists) throw new Error(`Transfer ${transferId} not found.`);

  const tx = txDoc.data()!;
  if (!['AGENT_ASSIGNED', 'OTP_SENT'].includes(tx.status)) {
    throw new Error(`OTP can only be sent when transfer is AGENT_ASSIGNED or OTP_SENT. Current: ${tx.status}`);
  }

  const otp        = generateOtp();
  const hashedOtp  = sha256(otp);
  const expiresAt  = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Upsert OTP doc (one per transfer, overwrite on resend)
  await adminDb.collection(AGENT_COL.otps).doc(transferId).set({
    transfer_id: transferId,
    hashed_otp:  hashedOtp,
    expires_at:  expiresAt,
    verified:    false,
    payout_token: null,
    created_at:  new Date().toISOString(),
  });

  // Advance transfer state
  await adminDb.collection(AGENT_COL.txns).doc(transferId).update({
    status:    'OTP_SENT',
    updatedAt: admin.firestore.Timestamp.now(),
  });

  await logTimeline(transferId, 'OTP_SENT', 'OTP generated and dispatched to recipient.');
  console.log(`[AgentPayout] OTP generated — transfer=${transferId} expiresAt=${expiresAt}`);

  return { otp, expiresAt };
}

// ─── OTP: verify ─────────────────────────────────────────────────────────────

/**
 * verifyOtp — validate the 6-digit OTP, mark as READY_FOR_PAYOUT, and issue
 * a single-use payout token that the agent submits with mark-paid.
 */
export async function verifyOtp(
  transferId: string,
  otp:        string,
): Promise<{ payoutToken: string }> {
  const otpDoc = await adminDb.collection(AGENT_COL.otps).doc(transferId).get();
  if (!otpDoc.exists) throw new Error('OTP record not found. Send OTP first.');

  const record = otpDoc.data()!;

  if (record.verified) throw new Error('OTP already used. Request a new one.');
  if (new Date(record.expires_at) < new Date()) throw new Error('OTP has expired. Request a new one.');

  const hashedInput = sha256(otp);
  if (hashedInput !== record.hashed_otp) throw new Error('Invalid OTP.');

  const payoutToken = generateToken();
  const hashedToken = sha256(payoutToken);

  await otpDoc.ref.update({
    verified:      true,
    payout_token:  hashedToken,
    verified_at:   new Date().toISOString(),
  });

  // Advance transfer to READY_FOR_PAYOUT
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
 * Safety checks (all atomic):
 *   1. Payout token must be valid (prevents replay without OTP)
 *   2. Transfer must be in READY_FOR_PAYOUT state (idempotency guard)
 *   3. Agent float must still cover the amount (race-condition guard)
 *
 * On success: deducts agent float, advances transfer to PAID_OUT, logs timeline.
 */
export async function markPaid(
  transferId:  string,
  payoutToken: string,
): Promise<{ transfer: Record<string, unknown>; agent: Agent }> {
  const otpDoc = await adminDb.collection(AGENT_COL.otps).doc(transferId).get();
  if (!otpDoc.exists) throw new Error('OTP record not found. OTP must be verified first.');

  const record = otpDoc.data()!;
  if (!record.verified) throw new Error('OTP not verified. Verify OTP before marking paid.');

  const hashedToken = sha256(payoutToken);
  if (hashedToken !== record.payout_token) throw new Error('Invalid payout token.');

  // Run remaining checks + state updates inside a Firestore transaction
  const result = await adminDb.runTransaction(async (t) => {
    const txRef    = adminDb.collection(AGENT_COL.txns).doc(transferId);
    const txDoc    = await t.get(txRef);
    if (!txDoc.exists) throw new Error(`Transfer ${transferId} not found.`);

    const tx = txDoc.data()!;

    // Idempotency: already paid?
    if (tx.status === 'PAID_OUT' || tx.status === 'COMPLETED') {
      throw new Error(`Transfer is already ${tx.status} — duplicate payout blocked.`);
    }
    if (tx.status !== 'READY_FOR_PAYOUT') {
      throw new Error(`Transfer must be READY_FOR_PAYOUT to mark paid. Current: ${tx.status}`);
    }

    const agentId  = tx.assigned_agent_id as string;
    const amount   = tx.amount as number;

    const agentRef = adminDb.collection(AGENT_COL.agents).doc(agentId);
    const agentDoc = await t.get(agentRef);
    if (!agentDoc.exists) throw new Error(`Assigned agent ${agentId} not found.`);

    const agent = { id: agentDoc.id, ...(agentDoc.data() as Omit<Agent, 'id'>) };
    if (agent.available_float < amount) {
      throw new Error(`Agent float insufficient: has ${agent.available_float}, needs ${amount}.`);
    }

    // Debit agent float
    t.update(agentRef, {
      available_float: admin.firestore.FieldValue.increment(-amount),
    });

    // Mark transfer PAID_OUT
    t.update(txRef, {
      status:    'PAID_OUT',
      paidOutAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });

    // Mark assignment completed
    const assignSnap = await adminDb
      .collection(AGENT_COL.assigns)
      .where('transfer_id', '==', transferId)
      .where('agent_id',    '==', agentId)
      .limit(1)
      .get();

    if (!assignSnap.empty) {
      t.update(assignSnap.docs[0].ref, {
        status:     'completed',
        updated_at: new Date().toISOString(),
      });
    }

    // Invalidate OTP token to prevent re-use
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
    transferId,
    'PAID_OUT',
    `Cash paid by agent ${result.agent.full_name} (${result.agent.city}). Float debited: ${result.tx.amount} ${result.tx.currency}.`,
  );
  console.log(`[AgentPayout] Payout complete — transfer=${transferId} agent=${result.agent.id} amount=${result.tx.amount}`);

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

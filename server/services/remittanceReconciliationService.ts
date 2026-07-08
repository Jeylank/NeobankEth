import * as admin from 'firebase-admin';
import { adminDb } from '../firebaseAdmin';
import { createBetaRiskAlert } from './betaRiskService';

export const PAYMENT_PENDING_THRESHOLD_MS = 15 * 60 * 1000;
export const AGENT_PAYOUT_SLA_MS = 10 * 60 * 1000;

export type ReconciliationIssueType =
  | 'STALE_PAYMENT_PENDING'
  | 'STUCK_AGENT_PAYOUT'
  | 'WALLET_RESERVATION_MISMATCH'
  | 'UNBALANCED_LEDGER'
  | 'AGENT_FLOAT_MISMATCH';

export interface ReconciliationIssue {
  type: ReconciliationIssueType;
  transactionId?: string;
  userId?: string;
  details: Record<string, unknown>;
}

export interface ReconciliationOptions {
  nowMs?: number;
  paymentPendingThresholdMs?: number;
  agentPayoutSlaMs?: number;
  recover?: boolean;
}

function millis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis();
  }
  const parsed = new Date(String(value ?? 0)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

async function expirePendingPayment(transactionId: string, now: admin.firestore.Timestamp): Promise<boolean> {
  const txRef = adminDb.collection('sim_transactions').doc(transactionId);
  return adminDb.runTransaction(async transaction => {
    const txSnapshot = await transaction.get(txRef);
    if (!txSnapshot.exists) return false;
    const data = txSnapshot.data()!;
    if (data.status !== 'PAYMENT_PENDING' || data.reservationStatus !== 'RESERVED') return false;

    const walletRef = adminDb.collection('sim_wallets').doc(data.userId);
    const walletSnapshot = await transaction.get(walletRef);
    const reservations = walletSnapshot.exists
      ? (walletSnapshot.data()!.reservations as Record<string, number> | undefined) ?? {}
      : {};
    const reserved = reservations[data.currency] ?? 0;
    if (reserved < data.amount) return false;

    transaction.set(walletRef, {
      reservations: { ...reservations, [data.currency]: reserved - data.amount },
      updatedAt: now,
    }, { merge: true });
    transaction.update(txRef, {
      status: 'PAYMENT_EXPIRED',
      paymentStatus: 'EXPIRED',
      reservationStatus: 'RELEASED',
      reservedAmount: 0,
      recoveryAction: 'EXPIRED_AND_RELEASED',
      recoveredAt: now,
      updatedAt: now,
    });
    const ledgerRef = adminDb.collection('sim_ledger').doc(`${transactionId}_recovery_release`);
    transaction.set(ledgerRef, {
      journalId: ledgerRef.id,
      transactionId,
      type: 'RECOVERY_RESERVATION_RELEASE',
      currency: data.currency,
      amount: data.amount,
      entries: [
        { account: `wallet:${data.userId}:reserved`, side: 'CREDIT', amount: data.amount },
        { account: `wallet:${data.userId}:available`, side: 'DEBIT', amount: data.amount },
      ],
      createdAt: now,
    });
    return true;
  });
}

async function flagStuckPayout(transactionId: string, now: admin.firestore.Timestamp): Promise<boolean> {
  const txRef = adminDb.collection('sim_transactions').doc(transactionId);
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(txRef);
    if (!snapshot.exists) return false;
    const status = snapshot.data()!.status as string;
    if (status !== 'FUNDS_RECEIVED' && status !== 'OTP_SENT') return false;
    transaction.update(txRef, {
      status: 'RECOVERY_PENDING',
      recoveryPreviousStatus: status,
      recoveryReason: 'AGENT_PAYOUT_SLA_EXCEEDED',
      recoveryFlaggedAt: now,
      updatedAt: now,
    });
    return true;
  });
}

export async function reconcileSimulationRemittances(
  options: ReconciliationOptions = {},
): Promise<{ issues: ReconciliationIssue[]; actions: string[]; checkedTransfers: number }> {
  const nowMs = options.nowMs ?? Date.now();
  const paymentThreshold = options.paymentPendingThresholdMs ?? PAYMENT_PENDING_THRESHOLD_MS;
  const payoutSla = options.agentPayoutSlaMs ?? AGENT_PAYOUT_SLA_MS;
  const recover = options.recover !== false;
  const issues: ReconciliationIssue[] = [];
  const actions: string[] = [];
  const now = admin.firestore.Timestamp.fromMillis(nowMs);

  const initialTransactions = await adminDb.collection('sim_transactions').get();
  for (const document of initialTransactions.docs) {
    const data = document.data();
    const age = nowMs - millis(data.updatedAt ?? data.createdAt);
    if (data.status === 'PAYMENT_PENDING' && age > paymentThreshold) {
      issues.push({
        type: 'STALE_PAYMENT_PENDING',
        transactionId: document.id,
        userId: data.userId,
        details: { ageMs: age, thresholdMs: paymentThreshold },
      });
      if (recover && await expirePendingPayment(document.id, now)) {
        actions.push(`EXPIRED_PAYMENT:${document.id}`);
      }
    } else if (
      (data.status === 'FUNDS_RECEIVED' || data.status === 'OTP_SENT')
      && age > payoutSla
    ) {
      issues.push({
        type: 'STUCK_AGENT_PAYOUT',
        transactionId: document.id,
        userId: data.userId,
        details: { status: data.status, ageMs: age, thresholdMs: payoutSla },
      });
      if (recover && await flagStuckPayout(document.id, now)) {
        actions.push(`FLAGGED_RECOVERY:${document.id}`);
        await createBetaRiskAlert('STUCK_RECOVERY', document.id, {
          previousStatus: data.status,
          ageMs: age,
        });
      }
    }
  }

  const [transactions, wallets, ledger, agents] = await Promise.all([
    adminDb.collection('sim_transactions').get(),
    adminDb.collection('sim_wallets').get(),
    adminDb.collection('sim_ledger').get(),
    adminDb.collection('agents').get(),
  ]);

  const expectedReservations = new Map<string, number>();
  for (const document of transactions.docs) {
    const data = document.data();
    if (data.reservationStatus !== 'RESERVED') continue;
    const key = `${data.userId}:${data.currency}`;
    expectedReservations.set(key, (expectedReservations.get(key) ?? 0) + Number(data.reservedAmount ?? data.amount));
  }
  const checkedReservationKeys = new Set<string>();
  for (const wallet of wallets.docs) {
    const reservations = (wallet.data().reservations as Record<string, number> | undefined) ?? {};
    for (const currency of new Set([
      ...Object.keys(reservations),
      ...[...expectedReservations.keys()]
        .filter(key => key.startsWith(`${wallet.id}:`))
        .map(key => key.slice(wallet.id.length + 1)),
    ])) {
      const actual = reservations[currency] ?? 0;
      const reservationKey = `${wallet.id}:${currency}`;
      checkedReservationKeys.add(reservationKey);
      const expected = expectedReservations.get(reservationKey) ?? 0;
      if (actual !== expected) {
        issues.push({
          type: 'WALLET_RESERVATION_MISMATCH',
          userId: wallet.id,
          details: { currency, actual, expected },
        });
      }
    }
  }
  for (const [key, expected] of expectedReservations) {
    if (checkedReservationKeys.has(key)) continue;
    const separator = key.lastIndexOf(':');
    issues.push({
      type: 'WALLET_RESERVATION_MISMATCH',
      userId: key.slice(0, separator),
      details: { currency: key.slice(separator + 1), actual: 0, expected },
    });
  }

  const ledgerByTransfer = new Map<string, FirebaseFirestore.DocumentData[]>();
  for (const entry of ledger.docs) {
    const data = entry.data();
    const list = ledgerByTransfer.get(data.transactionId) ?? [];
    list.push(data);
    ledgerByTransfer.set(data.transactionId, list);
  }
  for (const [transactionId, journals] of ledgerByTransfer) {
    let debits = 0;
    let credits = 0;
    for (const journal of journals) {
      for (const entry of journal.entries ?? []) {
        if (entry.side === 'DEBIT') debits += Number(entry.amount);
        if (entry.side === 'CREDIT') credits += Number(entry.amount);
      }
    }
    if (Math.abs(debits - credits) > 0.000001) {
      issues.push({
        type: 'UNBALANCED_LEDGER',
        transactionId,
        details: { debits, credits, difference: debits - credits },
      });
      await createBetaRiskAlert('LEDGER_IMBALANCE', transactionId, {
        debits, credits, difference: debits - credits,
      });
    }
  }

  for (const document of transactions.docs) {
    const data = document.data();
    if (data.status !== 'PAID_OUT') continue;
    const payout = (ledgerByTransfer.get(document.id) ?? []).find(entry => entry.type === 'AGENT_CASH_PAYOUT');
    const validDelta = payout
      && Number(payout.agentFloatBefore) - Number(payout.agentFloatAfter) === Number(payout.amount);
    if (!validDelta || payout.agentId !== data.assigned_agent_id) {
      issues.push({
        type: 'AGENT_FLOAT_MISMATCH',
        transactionId: document.id,
        details: {
          agentId: data.assigned_agent_id,
          ledgerAgentId: payout?.agentId ?? null,
          amount: data.amount,
        },
      });
    }
  }

  const latestPayoutByAgent = new Map<string, FirebaseFirestore.DocumentData>();
  for (const journal of ledger.docs.map(document => document.data())) {
    if (journal.type !== 'AGENT_CASH_PAYOUT' || !journal.agentId) continue;
    const previous = latestPayoutByAgent.get(journal.agentId);
    if (!previous || millis(journal.createdAt) > millis(previous.createdAt)) {
      latestPayoutByAgent.set(journal.agentId, journal);
    }
  }
  for (const [agentId, payout] of latestPayoutByAgent) {
    const agent = agents.docs.find(document => document.id === agentId);
    const actualFloat = agent?.data().available_float;
    if (!agent || Number(actualFloat) !== Number(payout.agentFloatAfter)) {
      issues.push({
        type: 'AGENT_FLOAT_MISMATCH',
        transactionId: payout.transactionId,
        details: {
          agentId,
          actualFloat: actualFloat ?? null,
          expectedFloat: payout.agentFloatAfter,
        },
      });
    }
  }

  return { issues, actions, checkedTransfers: transactions.size };
}

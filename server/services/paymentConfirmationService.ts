import * as admin from 'firebase-admin';
import { adminDb } from '../firebaseAdmin';
import { startAgentCashPayout } from './agentCashRemittanceService';
import { processRemittance, type RemittanceResult } from './simulationEngine';
import type { RemittanceRequest } from './remittance';
import { createBetaRiskAlert } from './betaRiskService';
import { notifyRemittanceEvent } from './notificationService';

export type SimulatedPaymentOutcome = 'confirmed' | 'failed';

function transactionPayload(
  transactionId: string,
  data: FirebaseFirestore.DocumentData,
  duplicate = false,
): RemittanceResult {
  return {
    ok: data.status !== 'PAYMENT_FAILED',
    status: 200,
    payload: {
      transactionId,
      status: data.status,
      paymentStatus: data.paymentStatus,
      duplicate,
      ...(data.payout_method ? { payout_method: data.payout_method } : {}),
      ...(data.provider ? { provider: data.provider } : {}),
    },
  };
}

export async function confirmSimulationPayment(
  transactionId: string,
  outcome: SimulatedPaymentOutcome,
): Promise<RemittanceResult> {
  const txRef = adminDb.collection('sim_transactions').doc(transactionId);
  let pendingData: FirebaseFirestore.DocumentData | undefined;
  let duplicateData: FirebaseFirestore.DocumentData | undefined;

  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(txRef);
    if (!snapshot.exists) return;

    const data = snapshot.data()!;
    if (data.status !== 'PAYMENT_PENDING') {
      duplicateData = data;
      return;
    }

    if (outcome === 'failed') {
      const now = admin.firestore.Timestamp.now();
      const walletRef = adminDb.collection('sim_wallets').doc(data.userId);
      const wallet = await transaction.get(walletRef);
      const reservations = wallet.exists
        ? (wallet.data()!.reservations as Record<string, number> | undefined) ?? {}
        : {};
      const reserved = reservations[data.currency] ?? 0;
      if (reserved < data.amount) {
        throw new Error(`Reservation for '${transactionId}' is missing or already released.`);
      }
      transaction.set(walletRef, {
        reservations: { ...reservations, [data.currency]: reserved - data.amount },
        updatedAt: now,
      }, { merge: true });
      transaction.update(txRef, {
        status: 'PAYMENT_FAILED',
        paymentStatus: 'FAILED',
        reservationStatus: 'RELEASED',
        reservedAmount: 0,
        paymentFailedAt: now,
        updatedAt: now,
      });
      const ledgerRef = adminDb.collection('sim_ledger').doc(`${transactionId}_reservation_release`);
      transaction.set(ledgerRef, {
        journalId: ledgerRef.id,
        transactionId,
        type: 'RESERVATION_RELEASE',
        currency: data.currency,
        amount: data.amount,
        entries: [
          { account: `wallet:${data.userId}:reserved`, side: 'CREDIT', amount: data.amount },
          { account: `wallet:${data.userId}:available`, side: 'DEBIT', amount: data.amount },
        ],
        createdAt: now,
      });
      pendingData = { ...data, status: 'PAYMENT_FAILED', paymentStatus: 'FAILED' };
      return;
    }

    pendingData = data;
    transaction.update(txRef, {
      status: 'PAYMENT_CONFIRMING',
      paymentStatus: 'CONFIRMED',
      paymentConfirmedAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });
  });

  if (duplicateData) return transactionPayload(transactionId, duplicateData, true);
  if (!pendingData) {
    const exists = await txRef.get();
    if (!exists.exists) {
      return {
        ok: false,
        status: 404,
        payload: { error: 'TRANSACTION_NOT_FOUND', message: `Transaction '${transactionId}' not found.` },
      };
    }
    return transactionPayload(transactionId, exists.data()!, true);
  }
  if (outcome === 'failed') {
    await createBetaRiskAlert('FAILED_PAYMENT', transactionId, {
      userId: pendingData.userId,
      amount: pendingData.amount,
      currency: pendingData.currency,
    });
    void notifyRemittanceEvent({
      userId: pendingData.userId, event: 'TRANSFER_FAILED', txId: transactionId,
      amount: pendingData.amount, currency: pendingData.currency,
    });
    return transactionPayload(transactionId, pendingData);
  }

  void notifyRemittanceEvent({
    userId: pendingData.userId, event: 'PAYMENT_CONFIRMED', txId: transactionId,
    amount: pendingData.amount, currency: pendingData.currency,
  });

  const request: RemittanceRequest = {
    userId: pendingData.userId,
    recipientId: pendingData.recipientId,
    amount: pendingData.amount,
    currency: pendingData.currency,
    type: pendingData.type,
    metadata: pendingData.metadata ?? {},
    forcedRate: pendingData.rateUsed,
  };
  const funded = await processRemittance({
    ...request,
    paymentConfirmed: true,
    existingTransactionId: transactionId,
  });
  return startAgentCashPayout(request, funded);
}

export async function refundSimulationPayment(transactionId: string): Promise<RemittanceResult> {
  const txRef = adminDb.collection('sim_transactions').doc(transactionId);
  let resultData: FirebaseFirestore.DocumentData | undefined;

  await adminDb.runTransaction(async transaction => {
    const txSnapshot = await transaction.get(txRef);
    if (!txSnapshot.exists) return;
    const data = txSnapshot.data()!;
    if (data.status === 'REFUNDED') {
      resultData = { ...data, duplicate: true };
      return;
    }

    const walletRef = adminDb.collection('sim_wallets').doc(data.userId);
    const walletSnapshot = await transaction.get(walletRef);
    const balances = walletSnapshot.exists
      ? (walletSnapshot.data()!.balances as Record<string, number>)
      : {};
    const reservations = walletSnapshot.exists
      ? (walletSnapshot.data()!.reservations as Record<string, number> | undefined) ?? {}
      : {};
    const now = admin.firestore.Timestamp.now();
    const wasReserved = data.reservationStatus === 'RESERVED';
    const wasDebited = data.paymentStatus === 'CONFIRMED' && !wasReserved;

    if (!wasReserved && !wasDebited) {
      throw new Error(`Transaction '${transactionId}' has no debit or reservation to refund.`);
    }

    transaction.set(walletRef, {
      balances: {
        ...balances,
        [data.currency]: (balances[data.currency] ?? 0) + (wasDebited ? data.amount : 0),
      },
      reservations: {
        ...reservations,
        [data.currency]: (reservations[data.currency] ?? 0) - (wasReserved ? data.amount : 0),
      },
      updatedAt: now,
    }, { merge: true });
    transaction.update(txRef, {
      status: 'REFUNDED',
      paymentStatus: 'REFUNDED',
      reservationStatus: wasReserved ? 'RELEASED' : data.reservationStatus,
      reservedAmount: 0,
      refundedAt: now,
      updatedAt: now,
    });

    const ledgerRef = adminDb.collection('sim_ledger').doc(`${transactionId}_refund`);
    transaction.set(ledgerRef, {
      journalId: ledgerRef.id,
      transactionId,
      type: wasReserved ? 'RESERVATION_REFUND' : 'PAYMENT_REFUND',
      currency: data.currency,
      amount: data.amount,
      entries: wasReserved
        ? [
            { account: `wallet:${data.userId}:reserved`, side: 'CREDIT', amount: data.amount },
            { account: `wallet:${data.userId}:available`, side: 'DEBIT', amount: data.amount },
          ]
        : [
            { account: 'remittance:clearing', side: 'CREDIT', amount: data.amount },
            { account: `wallet:${data.userId}`, side: 'DEBIT', amount: data.amount },
          ],
      createdAt: now,
    });
    resultData = { ...data, status: 'REFUNDED', paymentStatus: 'REFUNDED' };
  });

  if (resultData && !resultData.duplicate) {
    void notifyRemittanceEvent({
      userId: resultData.userId, event: 'TRANSFER_REFUNDED', txId: transactionId,
      amount: resultData.amount, currency: resultData.currency,
    });
  }

  if (!resultData) {
    return {
      ok: false,
      status: 404,
      payload: { error: 'TRANSACTION_NOT_FOUND', message: `Transaction '${transactionId}' not found.` },
    };
  }
  return transactionPayload(transactionId, resultData, resultData.duplicate === true);
}

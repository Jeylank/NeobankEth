/**
 * server/services/notificationService.ts
 * ────────────────────────────────────────
 * Centralized helper for emitting in-app remittance notifications.
 *
 * Scope (per current requirements): IN-APP ONLY. Does not send SMS or push —
 * those channels are explicitly out of scope until requested. This module
 * never touches wallet balances, liquidity pools, or transaction state — it
 * is purely observational and fire-and-forget so a notification failure can
 * never block or alter the financial flow that triggered it.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';

export type RemittanceNotificationEvent =
  | 'TRANSFER_CREATED'
  | 'PAYMENT_CONFIRMED'
  | 'AGENT_ASSIGNED'
  | 'OTP_SENT'
  | 'PAYOUT_COMPLETED'
  | 'RECOVERY_PENDING'
  | 'TRANSFER_FAILED'
  | 'TRANSFER_REFUNDED';

const NOTIFICATION_COPY: Record<
  RemittanceNotificationEvent,
  (ctx: { amount?: number; currency?: string; agentName?: string }) => { title: string; message: string }
> = {
  TRANSFER_CREATED: ({ amount, currency }) => ({
    title: 'Transfer created',
    message: amount && currency
      ? `Your transfer of ${amount} ${currency} has been created and is awaiting payment confirmation.`
      : 'Your transfer has been created and is awaiting payment confirmation.',
  }),
  PAYMENT_CONFIRMED: () => ({
    title: 'Payment confirmed',
    message: 'Your payment has been confirmed. We are now processing your transfer.',
  }),
  AGENT_ASSIGNED: ({ agentName }) => ({
    title: 'Agent assigned',
    message: agentName
      ? `${agentName} has been assigned to deliver your cash payout.`
      : 'A cash-payout agent has been assigned to your transfer.',
  }),
  OTP_SENT: () => ({
    title: 'OTP sent',
    message: 'A one-time code has been sent to the recipient to collect their cash payout.',
  }),
  PAYOUT_COMPLETED: ({ amount, currency }) => ({
    title: 'Payout completed',
    message: amount && currency
      ? `Your transfer of ${amount} ${currency} has been delivered successfully.`
      : 'Your transfer has been delivered successfully.',
  }),
  RECOVERY_PENDING: () => ({
    title: 'Transfer delayed',
    message: 'Your transfer is temporarily queued while we secure available funds. It will resume automatically.',
  }),
  TRANSFER_FAILED: () => ({
    title: 'Transfer failed',
    message: 'Your transfer could not be completed. Please check the transfer details or contact support.',
  }),
  TRANSFER_REFUNDED: ({ amount, currency }) => ({
    title: 'Transfer refunded',
    message: amount && currency
      ? `${amount} ${currency} has been refunded to your wallet.`
      : 'Your transfer has been refunded to your wallet.',
  }),
};

export interface NotifyRemittanceEventInput {
  userId: string;
  event: RemittanceNotificationEvent;
  txId?: string;
  amount?: number;
  currency?: string;
  agentName?: string;
  extraData?: Record<string, unknown>;
}

/**
 * notifyRemittanceEvent — writes a single in-app notification document.
 *
 * Fire-and-forget by design: callers should invoke this with `void` and
 * never `await` it inline in a financial code path. Errors are caught and
 * logged here so a Firestore hiccup can never surface as (or cause) a
 * remittance failure.
 */
export async function notifyRemittanceEvent(input: NotifyRemittanceEventInput): Promise<void> {
  const { userId, event, txId, amount, currency, agentName, extraData } = input;

  if (!userId) {
    console.warn(`[Notifications] Skipped ${event} — missing userId.`);
    return;
  }

  try {
    const { title, message } = NOTIFICATION_COPY[event]({ amount, currency, agentName });

    await adminDb.collection('notifications').add({
      userId,
      type: 'remittance',
      title,
      message,
      read: false,
      data: {
        event,
        ...(txId ? { txId } : {}),
        ...(amount !== undefined ? { amount } : {}),
        ...(currency ? { currency } : {}),
        ...(extraData ?? {}),
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err: any) {
    console.error(`[Notifications] Failed to create ${event} notification for user ${userId}:`, err.message);
  }
}

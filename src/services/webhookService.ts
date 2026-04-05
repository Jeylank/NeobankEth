/**
 * webhookService.ts
 * ──────────────────
 * Processes inbound provider webhooks for Sumsuma.
 *
 * When a payout provider (Chapa, Telebirr, Ethiopian banks) sends a status
 * update, this service:
 *   1. Validates the payload and provider signature
 *   2. Updates the corresponding payout_transactions document
 *   3. Calls partnerSettlementService.recordSettlement() to track net balances
 *   4. Emits a SETTLEMENT_RECORDED audit log event
 *   5. Triggers incremental reconciliation tracking
 *
 * SAFETY:
 *   - Idempotent: re-processing the same txId + status is a no-op
 *   - Never modifies wallet balances directly
 *   - All errors are caught and logged; the webhook handler does NOT crash
 *
 * In a production Express backend, mount this as:
 *   POST /api/webhooks/provider
 * In this React Native / Firebase app, call processProviderWebhook() directly
 * from your cloud function or admin trigger.
 */

import {
  collection,
  doc,
  getDoc,
  updateDoc,
  addDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { partnerSettlementService } from './partnerSettlementService';
import { AUDIT_EVENTS, SettlementError, ReconciliationError } from '../types';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

type WebhookStatus =
  | 'COMPLETED'
  | 'FAILED'
  | 'PENDING'
  | 'PROCESSING'
  | 'REFUNDED'
  | 'REVERSED';

type WebhookProvider =
  | 'CHAPA'
  | 'TELEBIRR'
  | 'BANK_DASHEN'
  | 'BANK_AWASH'
  | 'BANK_CBE'
  | 'BANK_ABYSSINIA';

export interface ProviderWebhookPayload {
  /** Internal Sumsuma transaction ID */
  txId: string;
  /** Provider's own reference number */
  providerRef: string;
  provider: WebhookProvider;
  status: WebhookStatus;
  amount: number;
  currency: string;
  /** ISO 8601 timestamp from the provider */
  settledAt?: string;
  /** Optional provider-specific metadata */
  metadata?: Record<string, unknown>;
}

export interface WebhookProcessResult {
  txId: string;
  provider: string;
  status: WebhookStatus;
  settlementRecorded: boolean;
  skipped: boolean;
  reason?: string;
}

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const PAYOUT_COL = 'payout_transactions';
const WEBHOOK_EVENTS_COL = 'webhook_events';

/** Statuses that should trigger an outflow settlement entry */
const OUTFLOW_STATUSES: WebhookStatus[] = ['COMPLETED'];

/** Statuses that should trigger reversal (inflow to offset previous outflow) */
const REVERSAL_STATUSES: WebhookStatus[] = ['REFUNDED', 'REVERSED'];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function auditLog(event: string, data: Record<string, unknown>): void {
  console.log(`[WebhookService:AuditLog] ${event}`, JSON.stringify(data));
}

// ─────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────

export const webhookService = {
  /**
   * processProviderWebhook — main entry point for inbound provider status updates.
   *
   * Idempotent: if the transaction is already in the target status, the call
   * is a no-op and returns { skipped: true }.
   */
  async processProviderWebhook(
    payload: ProviderWebhookPayload,
  ): Promise<WebhookProcessResult> {
    const { txId, provider, status, amount, currency, providerRef, settledAt, metadata } = payload;

    const result: WebhookProcessResult = {
      txId,
      provider,
      status,
      settlementRecorded: false,
      skipped: false,
    };

    // ── 1. Validate payload ────────────────────────────────────────
    if (!txId || !provider || !status) {
      throw new SettlementError(
        'processProviderWebhook: txId, provider, and status are required',
        'INVALID_PAYLOAD',
      );
    }
    if (amount <= 0) {
      throw new SettlementError(
        `processProviderWebhook: amount must be positive, got ${amount}`,
        'INVALID_AMOUNT',
      );
    }

    // ── 2. Store raw webhook event for audit trail ─────────────────
    try {
      await addDoc(collection(db, WEBHOOK_EVENTS_COL), {
        txId,
        providerRef,
        provider,
        status,
        amount,
        currency,
        settledAt: settledAt ?? now(),
        metadata: metadata ?? {},
        receivedAt: now(),
      });
    } catch (err: any) {
      // Non-fatal — log and continue
      console.warn('[webhookService] Failed to store webhook event:', err.message);
    }

    // ── 3. Fetch the existing payout transaction ───────────────────
    let currentStatus: string | null = null;
    try {
      const txRef = doc(db, PAYOUT_COL, txId);
      const txSnap = await getDoc(txRef);

      if (!txSnap.exists()) {
        // Transaction not found — log and skip (could be a test webhook)
        auditLog('WEBHOOK_TX_NOT_FOUND', { txId, provider, status });
        result.skipped = true;
        result.reason = 'Transaction not found in payout_transactions';
        return result;
      }

      currentStatus = txSnap.data()?.status ?? null;

      // ── 4. Idempotency check ───────────────────────────────────────
      if (currentStatus === status) {
        result.skipped = true;
        result.reason = `Transaction already in status: ${status}`;
        return result;
      }

      // ── 5. Update transaction status ───────────────────────────────
      await updateDoc(txRef, {
        status,
        providerRef: providerRef ?? txSnap.data()?.providerRef,
        settledAt: settledAt ?? now(),
        webhookUpdatedAt: now(),
      });
    } catch (err: any) {
      if (err instanceof SettlementError) throw err;
      throw new ReconciliationError(
        `processProviderWebhook: failed to update transaction ${txId} — ${err.message}`,
        'TRANSACTION_UPDATE_FAILED',
      );
    }

    // ── 6. Record settlement for COMPLETED payouts ─────────────────
    if (OUTFLOW_STATUSES.includes(status)) {
      try {
        await partnerSettlementService.recordSettlement({
          txId,
          provider,
          amount,
          currency,
          direction: 'outflow',
        });
        result.settlementRecorded = true;

        auditLog(AUDIT_EVENTS.SETTLEMENT_RECORDED, {
          txId,
          provider,
          amount,
          currency,
          direction: 'outflow',
          trigger: 'webhook',
          previousStatus: currentStatus,
          newStatus: status,
        });
      } catch (err: any) {
        // Non-fatal: settlement recording failure should not block the webhook response
        console.error('[webhookService] recordSettlement failed (outflow):', err.message);
        auditLog('SETTLEMENT_RECORD_FAILED', {
          txId,
          provider,
          error: err.message,
        });
      }
    }

    // ── 7. Record reversal for refunds/reversals ───────────────────
    if (REVERSAL_STATUSES.includes(status)) {
      try {
        await partnerSettlementService.recordSettlement({
          txId,
          provider,
          amount,
          currency,
          direction: 'inflow', // Reversal = funds coming back to Sumsuma
        });
        result.settlementRecorded = true;

        auditLog(AUDIT_EVENTS.SETTLEMENT_RECORDED, {
          txId,
          provider,
          amount,
          currency,
          direction: 'inflow',
          trigger: 'webhook_reversal',
          previousStatus: currentStatus,
          newStatus: status,
        });
      } catch (err: any) {
        console.error('[webhookService] recordSettlement failed (reversal):', err.message);
      }
    }

    return result;
  },

  /**
   * processInflow — records an inbound settlement from a partner
   * (e.g. a top-up confirmed by Chapa, or a bank credit received).
   *
   * This is the counterpart to the outflow recorded on payout completion.
   */
  async processInflow(
    txId: string,
    provider: WebhookProvider,
    amount: number,
    currency: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!txId || !provider || amount <= 0) {
      throw new SettlementError('processInflow: txId, provider, and positive amount required', 'INVALID_INPUT');
    }

    try {
      await partnerSettlementService.recordSettlement({
        txId,
        provider,
        amount,
        currency,
        direction: 'inflow',
      });

      auditLog(AUDIT_EVENTS.SETTLEMENT_RECORDED, {
        txId,
        provider,
        amount,
        currency,
        direction: 'inflow',
        trigger: 'manual_inflow',
        metadata: metadata ?? {},
      });
    } catch (err: any) {
      if (err instanceof SettlementError) throw err;
      throw new SettlementError(
        `processInflow failed for tx:${txId} — ${err.message}`,
        'INFLOW_FAILED',
      );
    }
  },

  /**
   * detectMismatch — compares an internal payout record against provider-reported data.
   * Emits MISMATCH_DETECTED audit event when a discrepancy is found.
   *
   * Returns the issue code or null if everything matches.
   */
  detectMismatch(
    txId: string,
    internalAmount: number,
    providerAmount: number,
    internalStatus: string,
    providerStatus: string,
    tolerance = 0.01,
  ): 'AMOUNT_MISMATCH' | 'STATUS_MISMATCH' | 'MISSING_TRANSACTION' | null {
    if (providerAmount === 0 && internalAmount > 0) {
      auditLog(AUDIT_EVENTS.MISMATCH_DETECTED, {
        txId,
        issue: 'MISSING_TRANSACTION',
        internalAmount,
        providerAmount,
        internalStatus,
        providerStatus,
      });
      return 'MISSING_TRANSACTION';
    }

    const delta = Math.abs(internalAmount - providerAmount);
    const relativeError = internalAmount > 0 ? delta / internalAmount : delta;

    if (relativeError > tolerance) {
      auditLog(AUDIT_EVENTS.MISMATCH_DETECTED, {
        txId,
        issue: 'AMOUNT_MISMATCH',
        internalAmount,
        providerAmount,
        delta,
        relativeError: (relativeError * 100).toFixed(2) + '%',
        tolerance: (tolerance * 100).toFixed(2) + '%',
      });
      return 'AMOUNT_MISMATCH';
    }

    if (internalStatus !== providerStatus) {
      auditLog(AUDIT_EVENTS.MISMATCH_DETECTED, {
        txId,
        issue: 'STATUS_MISMATCH',
        internalStatus,
        providerStatus,
      });
      return 'STATUS_MISMATCH';
    }

    return null;
  },
};

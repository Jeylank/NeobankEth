/**
 * server/services/riskControls/safetyGuardsService.ts
 * ──────────────────────────────────────────────────────
 * Pre-flight safety checks before risky financial operations.
 *
 * Firestore collections used:
 *   risk_flags        — per-user freeze / review / block state
 *   kyc_documents     — KYC verification status
 *   fx_quotes         — quote validity
 *   treasury_liquidity — provider liquidity
 *   wallets           — available balance
 */

import { adminDb } from '../../firebaseAdmin';
import { writeAuditLog } from '../../middleware/auditLog';
import {
  SafetyGuardError,
  ReviewRequiredError,
  UserFrozenError,
  RiskErrorDetails,
} from './errors';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

const FLAGS_COL       = 'risk_flags';
const KYC_COL         = 'kyc_documents';
const WALLETS_COL     = 'wallets';
const FX_QUOTES_COL   = 'fx_quotes';
const LIQUIDITY_COL   = 'treasury_liquidity';
const PAYOUTS_COL     = 'payout_transactions';
const AUDIT_COL       = 'admin_action_logs';

// KYC threshold: require verified KYC above this USD equivalent
const KYC_THRESHOLD_USD = 500;

export interface RiskFlag {
  userId:         string;
  isFrozen:       boolean;
  isBlocked:      boolean;
  reviewRequired: boolean;
  reason:         string | null;
  updatedAt:      string;
}

function defaultFlag(userId: string): RiskFlag {
  return {
    userId,
    isFrozen:       false,
    isBlocked:      false,
    reviewRequired: false,
    reason:         null,
    updatedAt:      new Date().toISOString(),
  };
}

async function getFlag(userId: string): Promise<RiskFlag> {
  try {
    const snap = await adminDb.collection(FLAGS_COL).doc(userId).get();
    if (snap.exists) return snap.data() as RiskFlag;
  } catch (err: any) {
    console.error('[SafetyGuards] getFlag error:', err.message);
  }
  return defaultFlag(userId);
}

async function logBlockedOp(
  event:   string,
  userId:  string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await adminDb.collection(AUDIT_COL).add({
      adminId:    'system',
      adminEmail: 'system@sumsuma.internal',
      action:     event,
      entityId:   userId,
      entityType: 'user',
      payload:    details,
      ip:         '',
      timestamp:  new Date().toISOString(),
    });
  } catch {
    // audit logging must never crash the guard
  }
}

export const safetyGuardsService = {

  // ── User risk state ───────────────────────────────────────────────────────

  async validateUserRiskState(userId: string): Promise<void> {
    const flag = await getFlag(userId);

    if (flag.isFrozen || flag.isBlocked) {
      await logBlockedOp('payout_blocked_by_safety_guard', userId, {
        reason: 'user_frozen',
        flag,
      });
      throw new UserFrozenError(userId, flag.reason ?? undefined);
    }

    if (flag.reviewRequired) {
      await logBlockedOp('payout_blocked_by_safety_guard', userId, {
        reason: 'review_required',
        flag,
      });
      throw new ReviewRequiredError(flag.reason ?? undefined);
    }
  },

  // ── KYC check ─────────────────────────────────────────────────────────────

  async requireEnhancedKycIfNeeded(
    userId:   string,
    amount:   number,
    currency: string,
  ): Promise<void> {
    // Apply threshold only in USD for simplicity; convert other currencies roughly
    const usdEquivalent =
      currency === 'EUR' ? amount * 1.1 :
      currency === 'GBP' ? amount * 1.3 :
      amount;

    if (usdEquivalent < KYC_THRESHOLD_USD) return;

    const snap = await adminDb.collection(KYC_COL).doc(userId).get();
    if (!snap.exists || snap.data()?.status !== 'verified') {
      await logBlockedOp('payout_blocked_by_safety_guard', userId, {
        reason: 'kyc_not_verified',
        amount,
        currency,
      });
      throw new SafetyGuardError(
        'kyc_verification',
        'Identity verification is required for transfers above $500. Please complete KYC in the app.',
        { userId, amount, currency },
      );
    }
  },

  // ── Wallet balance ─────────────────────────────────────────────────────────

  async validateSufficientBalance(
    userId:   string,
    amount:   number,
    currency: string,
  ): Promise<void> {
    try {
      const snap = await adminDb.collection(WALLETS_COL).doc(userId).get();
      if (!snap.exists) return; // no wallet document → allow (demo mode)

      const balances = snap.data()?.balances ?? {};
      const available = balances[currency.toUpperCase()] ?? 0;

      if (available < amount) {
        throw new SafetyGuardError(
          'insufficient_balance',
          `Insufficient ${currency} balance. Available: ${available}, Required: ${amount}.`,
          { userId, available, amount, currency },
        );
      }
    } catch (err: any) {
      if (err instanceof SafetyGuardError) throw err;
      console.warn('[SafetyGuards] balance check skipped:', err.message);
    }
  },

  // ── FX quote validity ──────────────────────────────────────────────────────

  async validateFxQuote(quoteId: string, userId: string): Promise<void> {
    const snap = await adminDb.collection(FX_QUOTES_COL).doc(quoteId).get();
    if (!snap.exists) {
      throw new SafetyGuardError('fx_quote_not_found', 'The selected exchange rate quote was not found.');
    }

    const data = snap.data()!;

    if (data.userId !== userId) {
      throw new SafetyGuardError('fx_quote_owner_mismatch', 'This quote does not belong to the requesting user.');
    }

    const expiresAt: Timestamp | undefined = data.expiresAt;
    if (expiresAt && expiresAt.toDate() < new Date()) {
      throw new SafetyGuardError(
        'fx_quote_expired',
        'The selected exchange rate has expired. Please get a fresh quote.',
        { quoteId, expiresAt: expiresAt.toDate().toISOString() },
      );
    }
  },

  // ── Provider health ────────────────────────────────────────────────────────

  async validateProviderHealth(provider: string, currency: string): Promise<void> {
    try {
      const snap = await adminDb
        .collection(LIQUIDITY_COL)
        .where('provider', '==', provider.toUpperCase())
        .where('currency', '==', currency.toUpperCase())
        .limit(1)
        .get();

      if (snap.empty) return; // no liquidity document → skip check

      const data = snap.docs[0].data();
      const available = data.availableBalance ?? data.balance ?? 0;
      const minThreshold = data.criticalThreshold ?? 0;

      if (available <= minThreshold) {
        await logBlockedOp('payout_blocked_by_safety_guard', 'system', {
          reason: 'provider_insufficient_liquidity',
          provider,
          currency,
          available,
          minThreshold,
        });
        throw new SafetyGuardError(
          'provider_insufficient_liquidity',
          `Provider ${provider} does not have sufficient liquidity for this operation.`,
          { provider, currency, available, minThreshold },
        );
      }
    } catch (err: any) {
      if (err instanceof SafetyGuardError) throw err;
      console.warn('[SafetyGuards] provider health check skipped:', err.message);
    }
  },

  // ── Payout preconditions ───────────────────────────────────────────────────

  async validatePayoutPreconditions(txId: string, userId: string): Promise<void> {
    const snap = await adminDb.collection(PAYOUTS_COL).doc(txId).get();
    if (!snap.exists) {
      throw new SafetyGuardError('payout_not_found', `Payout transaction ${txId} not found.`);
    }

    const data = snap.data()!;

    if (data.userId !== userId) {
      throw new SafetyGuardError('payout_owner_mismatch', 'Payout does not belong to the requesting user.');
    }

    const blockedStatuses = ['COMPLETED', 'CANCELLED', 'FAILED'];
    if (blockedStatuses.includes(data.payoutStatus ?? '')) {
      throw new SafetyGuardError(
        'payout_already_terminal',
        `Payout is already in ${data.payoutStatus} state and cannot be processed again.`,
        { txId, status: data.payoutStatus },
      );
    }

    // Check user risk state as well
    await safetyGuardsService.validateUserRiskState(userId);
  },

  // ── Repeated failure check ─────────────────────────────────────────────────

  async checkRepeatedFailuresAndMark(userId: string): Promise<void> {
    const since = new Date();
    since.setDate(since.getDate() - 1);

    const snap = await adminDb
      .collection(PAYOUTS_COL)
      .where('userId', '==', userId)
      .where('payoutStatus', '==', 'FAILED')
      .where('createdAt', '>=', Timestamp.fromDate(since))
      .get();

    if (snap.size >= 3) {
      await safetyGuardsService.markReviewRequired(userId, `${snap.size} failed payouts in 24 hours`);
    }
  },

  // ── Flag management ────────────────────────────────────────────────────────

  async markReviewRequired(userId: string, reason?: string): Promise<void> {
    await adminDb.collection(FLAGS_COL).doc(userId).set(
      { userId, reviewRequired: true, reason: reason ?? null, updatedAt: new Date().toISOString() },
      { merge: true },
    );
    await logBlockedOp('review_required', userId, { reason });
  },

  async freezeUser(userId: string, adminUid: string, adminEmail: string, reason?: string): Promise<void> {
    await adminDb.collection(FLAGS_COL).doc(userId).set(
      { userId, isFrozen: true, reason: reason ?? null, updatedAt: new Date().toISOString() },
      { merge: true },
    );
    await writeAuditLog({
      adminId:    adminUid,
      adminEmail,
      action:     'user_frozen',
      entityId:   userId,
      entityType: 'user',
      payload:    { userId, reason },
      ip:         '',
    });
  },

  async unfreezeUser(userId: string, adminUid: string, adminEmail: string): Promise<void> {
    await adminDb.collection(FLAGS_COL).doc(userId).set(
      {
        userId,
        isFrozen:       false,
        isBlocked:      false,
        reviewRequired: false,
        reason:         null,
        updatedAt:      new Date().toISOString(),
      },
      { merge: true },
    );
    await writeAuditLog({
      adminId:    adminUid,
      adminEmail,
      action:     'user_unfrozen',
      entityId:   userId,
      entityType: 'user',
      payload:    { userId },
      ip:         '',
    });
  },

  async getAllRiskFlags(limit = 100): Promise<RiskFlag[]> {
    const snap = await adminDb
      .collection(FLAGS_COL)
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as RiskFlag);
  },

  async getRiskFlag(userId: string): Promise<RiskFlag> {
    return getFlag(userId);
  },
};

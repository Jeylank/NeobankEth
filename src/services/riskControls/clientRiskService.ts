/**
 * src/services/riskControls/clientRiskService.ts
 * ────────────────────────────────────────────────
 * Client-side (and worker-side) risk enforcement layer.
 *
 * Uses the Firebase client SDK — safe for both the React Native app
 * and Node.js workers (recurringSupportWorker, settlementWorker).
 *
 * Design: fail-open on Firestore read errors (never block due to infra).
 * Every check that would block throws a typed RiskError.
 * Every check that fails silently writes a console.warn (never crashes the caller).
 */

import { db, doc, getDoc, collection, getDocs, query, where } from '../firebase';
import { Timestamp } from 'firebase/firestore';

// ── Error types ───────────────────────────────────────────────────────────────

export class RiskError extends Error {
  readonly code:    string;
  readonly details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name    = 'RiskError';
    this.code    = code;
    this.details = details;
  }
}

export class FeatureDisabledError extends RiskError {
  constructor(feature: string, reason?: string) {
    super('FEATURE_DISABLED', 'This service is temporarily unavailable. Please try again later.', { feature, reason });
    this.name = 'FeatureDisabledError';
  }
}

export class LimitExceededError extends RiskError {
  constructor(limitKey: string, current: number, limit: number, currency?: string) {
    super('LIMIT_EXCEEDED', `Transaction exceeds the allowed limit (${limit}${currency ? ' ' + currency : ''}).`, { limitKey, current, limit, currency });
    this.name = 'LimitExceededError';
  }
}

export class VelocityLimitExceededError extends RiskError {
  constructor(limitKey: string, current: number, limit: number) {
    super('VELOCITY_LIMIT_EXCEEDED', 'Too many transactions in a short period. Please wait before trying again.', { limitKey, current, limit });
    this.name = 'VelocityLimitExceededError';
  }
}

export class ReviewRequiredError extends RiskError {
  constructor(reason?: string) {
    super('REVIEW_REQUIRED', 'This transaction requires manual review before it can proceed.', { reason });
    this.name = 'ReviewRequiredError';
  }
}

export class UserFrozenError extends RiskError {
  constructor(userId: string, reason?: string) {
    super('USER_FROZEN', 'Your account has been temporarily suspended. Please contact support.', { userId, reason });
    this.name = 'UserFrozenError';
  }
}

// ── Control keys ──────────────────────────────────────────────────────────────

export type ControlKey =
  | 'remittance_enabled'
  | 'wallet_topup_enabled'
  | 'recurring_support_enabled'
  | 'campaign_payout_enabled'
  | 'fx_marketplace_enabled'
  | 'referral_rewards_enabled';

// ── Hard-coded safe defaults (used if Firestore document is missing) ──────────

const LIMIT_DEFAULTS: Record<string, number> = {
  max_single_remittance_usd:     2000,
  max_single_remittance_eur:     1800,
  max_single_remittance_gbp:     1600,
  max_daily_remittance_usd:      5000,
  max_daily_remittance_eur:      4500,
  max_daily_remittance_gbp:      4000,
  max_weekly_remittance_usd:     10000,
  max_monthly_remittance_usd:    25000,
  max_daily_topup_usd:           5000,
  max_weekly_topup_usd:          15000,
  max_hourly_transfer_count:     5,
  max_daily_failed_payout_count: 3,
  max_campaign_contribution_usd: 1000,
  max_recurring_support_usd:     500,
};

// ── Internal helpers ──────────────────────────────────────────────────────────

async function readControl(key: ControlKey): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'system_controls', key));
    if (!snap.exists()) return true;
    return snap.data()?.enabled !== false;
  } catch {
    return true; // fail-open
  }
}

async function readLimit(key: string): Promise<{ value: number; enabled: boolean }> {
  try {
    const snap = await getDoc(doc(db, 'risk_limits', key));
    if (snap.exists()) {
      const d = snap.data();
      return { value: d?.value ?? LIMIT_DEFAULTS[key] ?? Infinity, enabled: d?.enabled !== false };
    }
  } catch {
    // fall through to default
  }
  const def = LIMIT_DEFAULTS[key];
  return { value: def ?? Infinity, enabled: def !== undefined };
}

async function readUserFlag(userId: string): Promise<{ isFrozen: boolean; isBlocked: boolean; reviewRequired: boolean; reason: string | null }> {
  try {
    const snap = await getDoc(doc(db, 'risk_flags', userId));
    if (!snap.exists()) return { isFrozen: false, isBlocked: false, reviewRequired: false, reason: null };
    const d = snap.data();
    return {
      isFrozen:       d?.isFrozen      ?? false,
      isBlocked:      d?.isBlocked     ?? false,
      reviewRequired: d?.reviewRequired ?? false,
      reason:         d?.reason        ?? null,
    };
  } catch {
    return { isFrozen: false, isBlocked: false, reviewRequired: false, reason: null }; // fail-open
  }
}

function windowStart(unit: 'hour' | 'day' | 'week' | 'month'): Date {
  const now = new Date();
  switch (unit) {
    case 'hour':  return new Date(now.getTime() - 60 * 60 * 1000);
    case 'day': { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }
    case 'week':  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'month': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}

async function sumTransactions(userId: string, since: Date, currency?: string): Promise<number> {
  try {
    let q = query(
      collection(db, 'transactions'),
      where('userId', '==', userId),
      where('createdAt', '>=', Timestamp.fromDate(since)),
    );
    const snap = await getDocs(q);
    return snap.docs
      .filter((d) => !currency || d.data().fromCurrency === currency.toUpperCase())
      .reduce((sum, d) => sum + (d.data().amount ?? 0), 0);
  } catch {
    return 0; // fail-open
  }
}

async function countTransactions(userId: string, since: Date): Promise<number> {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'transactions'),
        where('userId', '==', userId),
        where('createdAt', '>=', Timestamp.fromDate(since)),
      ),
    );
    return snap.size;
  } catch {
    return 0;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const clientRiskService = {

  /**
   * Throw FeatureDisabledError if the kill switch is off.
   */
  async checkKillSwitch(key: ControlKey): Promise<void> {
    const enabled = await readControl(key);
    if (!enabled) throw new FeatureDisabledError(key);
  },

  /**
   * Throw UserFrozenError or ReviewRequiredError if the user is blocked.
   */
  async checkUserRiskState(userId: string): Promise<void> {
    const flag = await readUserFlag(userId);
    if (flag.isFrozen || flag.isBlocked) throw new UserFrozenError(userId, flag.reason ?? undefined);
    if (flag.reviewRequired) throw new ReviewRequiredError(flag.reason ?? undefined);
  },

  /**
   * Validate remittance limits (single, daily, weekly, monthly).
   */
  async checkRemittanceLimits(userId: string, amount: number, currency: string): Promise<void> {
    const curr = currency.toUpperCase();

    const single = await readLimit(`max_single_remittance_${curr.toLowerCase()}`);
    if (single.enabled && amount > single.value) {
      throw new LimitExceededError(`max_single_remittance_${curr.toLowerCase()}`, amount, single.value, curr);
    }

    const daily = await readLimit(`max_daily_remittance_${curr.toLowerCase()}`);
    if (daily.enabled) {
      const dayTotal = await sumTransactions(userId, windowStart('day'), currency);
      if (dayTotal + amount > daily.value) throw new LimitExceededError(`max_daily_remittance_${curr.toLowerCase()}`, dayTotal + amount, daily.value, curr);
    }

    const weekly = await readLimit(`max_weekly_remittance_${curr.toLowerCase()}`);
    if (weekly.enabled) {
      const weekTotal = await sumTransactions(userId, windowStart('week'), currency);
      if (weekTotal + amount > weekly.value) throw new LimitExceededError(`max_weekly_remittance_${curr.toLowerCase()}`, weekTotal + amount, weekly.value, curr);
    }

    const monthly = await readLimit(`max_monthly_remittance_${curr.toLowerCase()}`);
    if (monthly.enabled) {
      const monthTotal = await sumTransactions(userId, windowStart('month'), currency);
      if (monthTotal + amount > monthly.value) throw new LimitExceededError(`max_monthly_remittance_${curr.toLowerCase()}`, monthTotal + amount, monthly.value, curr);
    }
  },

  /**
   * Validate wallet top-up limits (daily, weekly).
   */
  async checkTopupLimits(userId: string, amount: number, currency: string): Promise<void> {
    const curr = currency.toUpperCase();

    const daily = await readLimit(`max_daily_topup_${curr.toLowerCase()}`);
    if (daily.enabled) {
      const dayTotal = await sumTransactions(userId, windowStart('day'), currency);
      if (dayTotal + amount > daily.value) throw new LimitExceededError(`max_daily_topup_${curr.toLowerCase()}`, dayTotal + amount, daily.value, curr);
    }

    const weekly = await readLimit(`max_weekly_topup_${curr.toLowerCase()}`);
    if (weekly.enabled) {
      const weekTotal = await sumTransactions(userId, windowStart('week'), currency);
      if (weekTotal + amount > weekly.value) throw new LimitExceededError(`max_weekly_topup_${curr.toLowerCase()}`, weekTotal + amount, weekly.value, curr);
    }
  },

  /**
   * Validate campaign contribution limits.
   */
  async checkCampaignLimits(userId: string, amount: number, currency: string): Promise<void> {
    const curr = currency.toUpperCase();
    const lim  = await readLimit(`max_campaign_contribution_${curr.toLowerCase()}`);
    if (lim.enabled && amount > lim.value) throw new LimitExceededError(`max_campaign_contribution_${curr.toLowerCase()}`, amount, lim.value, curr);
  },

  /**
   * Validate recurring support limits.
   */
  async checkRecurringSupportLimits(userId: string, amount: number, currency: string): Promise<void> {
    const curr = currency.toUpperCase();
    const lim  = await readLimit(`max_recurring_support_${curr.toLowerCase()}`);
    if (lim.enabled && amount > lim.value) throw new LimitExceededError(`max_recurring_support_${curr.toLowerCase()}`, amount, lim.value, curr);
  },

  /**
   * Validate hourly transfer velocity.
   */
  async checkVelocity(userId: string): Promise<void> {
    const hourlyLimit = await readLimit('max_hourly_transfer_count');
    if (hourlyLimit.enabled) {
      const count = await countTransactions(userId, windowStart('hour'));
      if (count >= hourlyLimit.value) throw new VelocityLimitExceededError('max_hourly_transfer_count', count, hourlyLimit.value);
    }
  },

  /**
   * Convenience: run all standard remittance checks in sequence.
   * Returns the first RiskError encountered (for callers that want to inspect the type).
   * Throws on violation.
   */
  async runRemittanceChecks(userId: string, amount: number, currency: string): Promise<void> {
    await clientRiskService.checkKillSwitch('remittance_enabled');
    await clientRiskService.checkUserRiskState(userId);
    await clientRiskService.checkRemittanceLimits(userId, amount, currency);
    await clientRiskService.checkVelocity(userId);
  },

  /**
   * Convenience: run all top-up checks.
   */
  async runTopupChecks(userId: string, amount: number, currency: string): Promise<void> {
    await clientRiskService.checkKillSwitch('wallet_topup_enabled');
    await clientRiskService.checkUserRiskState(userId);
    await clientRiskService.checkTopupLimits(userId, amount, currency);
    await clientRiskService.checkVelocity(userId);
  },

  /**
   * Convenience: run all recurring support checks.
   * Returns false if the schedule should be skipped (frozen/review).
   * Throws on limit/velocity violations.
   */
  async runRecurringSupportChecks(userId: string, amount: number, currency: string): Promise<void> {
    await clientRiskService.checkKillSwitch('recurring_support_enabled');
    await clientRiskService.checkUserRiskState(userId);
    await clientRiskService.checkRecurringSupportLimits(userId, amount, currency);
    await clientRiskService.checkVelocity(userId);
  },

  /**
   * Convenience: run all FX marketplace checks.
   */
  async runFxMarketplaceChecks(userId: string): Promise<void> {
    await clientRiskService.checkKillSwitch('fx_marketplace_enabled');
    await clientRiskService.checkUserRiskState(userId);
  },

  /**
   * Convenience: run campaign contribution checks.
   */
  async runCampaignChecks(userId: string, amount: number, currency: string): Promise<void> {
    await clientRiskService.checkKillSwitch('campaign_payout_enabled');
    await clientRiskService.checkUserRiskState(userId);
    await clientRiskService.checkCampaignLimits(userId, amount, currency);
    await clientRiskService.checkVelocity(userId);
  },

  /**
   * Just check the referral rewards kill switch (reward payouts are low-risk).
   */
  async runReferralRewardChecks(userId: string): Promise<void> {
    await clientRiskService.checkKillSwitch('referral_rewards_enabled');
    await clientRiskService.checkUserRiskState(userId);
  },

  /** Re-export error constructors so callers can use instanceof without extra imports */
  errors: {
    FeatureDisabledError,
    LimitExceededError,
    VelocityLimitExceededError,
    ReviewRequiredError,
    UserFrozenError,
    RiskError,
  },
};

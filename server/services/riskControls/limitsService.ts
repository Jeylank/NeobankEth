/**
 * server/services/riskControls/limitsService.ts
 * ────────────────────────────────────────────────
 * Configurable transaction and velocity limits.
 *
 * Firestore collection: risk_limits
 * Document schema:
 *   { key, value, currency?, enabled, updatedAt }
 *
 * Limits are loaded from Firestore; hard-coded defaults apply if the
 * document does not exist, so the system is safe without prior setup.
 */

import { adminDb } from '../../firebaseAdmin';
import { writeAuditLog } from '../../middleware/auditLog';
import { LimitExceededError, VelocityLimitExceededError } from './errors';
import { Timestamp } from 'firebase-admin/firestore';

const LIMITS_COL       = 'risk_limits';
const TRANSACTIONS_COL = 'transactions';
const PAYOUTS_COL      = 'payout_transactions';

export interface RiskLimit {
  key:       string;
  value:     number;
  currency?: string;
  enabled:   boolean;
  updatedAt: string;
}

// ── Hard-coded safe defaults ─────────────────────────────────────────────────
const DEFAULTS: Record<string, number> = {
  max_single_remittance_usd:      2000,
  max_single_remittance_eur:      1800,
  max_single_remittance_gbp:      1600,
  max_daily_remittance_usd:       5000,
  max_daily_remittance_eur:       4500,
  max_daily_remittance_gbp:       4000,
  max_weekly_remittance_usd:      10000,
  max_monthly_remittance_usd:     25000,
  max_daily_topup_usd:            5000,
  max_weekly_topup_usd:           15000,
  max_hourly_transfer_count:      5,
  max_daily_failed_payout_count:  3,
  max_campaign_contribution_usd:  1000,
  max_recurring_support_usd:      500,
};

async function getLimit(key: string): Promise<{ value: number; enabled: boolean }> {
  try {
    const snap = await adminDb.collection(LIMITS_COL).doc(key).get();
    if (snap.exists) {
      const data = snap.data()!;
      return { value: data.value ?? DEFAULTS[key] ?? Infinity, enabled: data.enabled !== false };
    }
  } catch (err: any) {
    console.error('[Limits] getLimit error:', err.message);
  }
  const value = DEFAULTS[key];
  return { value: value ?? Infinity, enabled: value !== undefined };
}

function windowStart(unit: 'hour' | 'day' | 'week' | 'month'): Date {
  const now = new Date();
  switch (unit) {
    case 'hour':  return new Date(now.getTime() - 60 * 60 * 1000);
    case 'day':   return new Date(now.setHours(0, 0, 0, 0));
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d;
    }
    case 'month': {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return d;
    }
  }
}

async function sumUserTransactions(
  userId: string,
  since:  Date,
  currency?: string,
): Promise<number> {
  let q = adminDb
    .collection(TRANSACTIONS_COL)
    .where('userId', '==', userId)
    .where('createdAt', '>=', Timestamp.fromDate(since));

  if (currency) q = q.where('fromCurrency', '==', currency);

  const snap = await q.get();
  return snap.docs.reduce((sum, d) => sum + (d.data().amount ?? 0), 0);
}

async function countUserTransactions(userId: string, since: Date): Promise<number> {
  const snap = await adminDb
    .collection(TRANSACTIONS_COL)
    .where('userId', '==', userId)
    .where('createdAt', '>=', Timestamp.fromDate(since))
    .get();
  return snap.size;
}

async function countFailedPayouts(userId: string, since: Date): Promise<number> {
  const snap = await adminDb
    .collection(PAYOUTS_COL)
    .where('userId', '==', userId)
    .where('payoutStatus', '==', 'FAILED')
    .where('createdAt', '>=', Timestamp.fromDate(since))
    .get();
  return snap.size;
}

// ── Public validators ────────────────────────────────────────────────────────

export const limitsService = {

  async validateRemittanceLimits(userId: string, amount: number, currency: string): Promise<void> {
    const curr = currency.toUpperCase();

    // 1. Single-transaction max
    const singleKey = `max_single_remittance_${curr.toLowerCase()}`;
    const single    = await getLimit(singleKey);
    if (single.enabled && amount > single.value) {
      throw new LimitExceededError(singleKey, amount, single.value, curr);
    }

    // 2. Daily max
    const dailyKey = `max_daily_remittance_${curr.toLowerCase()}`;
    const daily    = await getLimit(dailyKey);
    if (daily.enabled) {
      const dayTotal = await sumUserTransactions(userId, windowStart('day'), currency);
      if (dayTotal + amount > daily.value) {
        throw new LimitExceededError(dailyKey, dayTotal + amount, daily.value, curr);
      }
    }

    // 3. Weekly max (USD baseline — convert if needed; using amount as-is for simplicity)
    const weeklyKey = `max_weekly_remittance_${curr.toLowerCase()}`;
    const weekly    = await getLimit(weeklyKey);
    if (weekly.enabled) {
      const weekTotal = await sumUserTransactions(userId, windowStart('week'), currency);
      if (weekTotal + amount > weekly.value) {
        throw new LimitExceededError(weeklyKey, weekTotal + amount, weekly.value, curr);
      }
    }

    // 4. Monthly max
    const monthlyKey = `max_monthly_remittance_${curr.toLowerCase()}`;
    const monthly    = await getLimit(monthlyKey);
    if (monthly.enabled) {
      const monthTotal = await sumUserTransactions(userId, windowStart('month'), currency);
      if (monthTotal + amount > monthly.value) {
        throw new LimitExceededError(monthlyKey, monthTotal + amount, monthly.value, curr);
      }
    }
  },

  async validateWalletTopupLimits(userId: string, amount: number, currency: string): Promise<void> {
    const curr = currency.toUpperCase();

    const dailyKey = `max_daily_topup_${curr.toLowerCase()}`;
    const daily    = await getLimit(dailyKey);
    if (daily.enabled) {
      const dayTotal = await sumUserTransactions(userId, windowStart('day'), currency);
      if (dayTotal + amount > daily.value) {
        throw new LimitExceededError(dailyKey, dayTotal + amount, daily.value, curr);
      }
    }

    const weeklyKey = `max_weekly_topup_${curr.toLowerCase()}`;
    const weekly    = await getLimit(weeklyKey);
    if (weekly.enabled) {
      const weekTotal = await sumUserTransactions(userId, windowStart('week'), currency);
      if (weekTotal + amount > weekly.value) {
        throw new LimitExceededError(weeklyKey, weekTotal + amount, weekly.value, curr);
      }
    }
  },

  async validateCampaignContributionLimits(userId: string, amount: number, currency: string): Promise<void> {
    const curr = currency.toUpperCase();
    const key  = `max_campaign_contribution_${curr.toLowerCase()}`;
    const lim  = await getLimit(key);
    if (lim.enabled && amount > lim.value) {
      throw new LimitExceededError(key, amount, lim.value, curr);
    }
  },

  async validateRecurringSupportLimits(userId: string, amount: number, currency: string): Promise<void> {
    const curr = currency.toUpperCase();
    const key  = `max_recurring_support_${curr.toLowerCase()}`;
    const lim  = await getLimit(key);
    if (lim.enabled && amount > lim.value) {
      throw new LimitExceededError(key, amount, lim.value, curr);
    }
  },

  async validateVelocity(userId: string): Promise<void> {
    // Hourly transfer count
    const hourlyLimit = await getLimit('max_hourly_transfer_count');
    if (hourlyLimit.enabled) {
      const count = await countUserTransactions(userId, windowStart('hour'));
      if (count >= hourlyLimit.value) {
        throw new VelocityLimitExceededError('max_hourly_transfer_count', count, hourlyLimit.value);
      }
    }

    // Daily failed payout count
    const failedLimit = await getLimit('max_daily_failed_payout_count');
    if (failedLimit.enabled) {
      const failed = await countFailedPayouts(userId, windowStart('day'));
      if (failed >= failedLimit.value) {
        throw new VelocityLimitExceededError('max_daily_failed_payout_count', failed, failedLimit.value);
      }
    }
  },

  // ── Limit management ──────────────────────────────────────────────────────

  async getAllLimits(): Promise<RiskLimit[]> {
    const snap = await adminDb.collection(LIMITS_COL).get();
    const existing = new Map<string, RiskLimit>();
    snap.docs.forEach((d) => existing.set(d.id, d.data() as RiskLimit));

    return Object.entries(DEFAULTS).map(([key, defaultValue]) => existing.get(key) ?? {
      key,
      value:     defaultValue,
      enabled:   true,
      updatedAt: new Date().toISOString(),
    });
  },

  async setLimit(
    key:       string,
    value:     number,
    enabled:   boolean,
    adminUid:  string,
    adminEmail: string,
    currency?: string,
  ): Promise<RiskLimit> {
    const now = new Date().toISOString();
    const data: RiskLimit = { key, value, enabled, updatedAt: now, ...(currency ? { currency } : {}) };

    await adminDb.collection(LIMITS_COL).doc(key).set(data, { merge: true });

    await writeAuditLog({
      adminId:    adminUid,
      adminEmail,
      action:     'limit_changed',
      entityId:   key,
      entityType: 'risk_limit',
      payload:    { key, value, enabled, currency },
      ip:         '',
    });

    return data;
  },
};

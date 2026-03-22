/**
 * treasuryAlertsService.ts
 * ─────────────────────────
 * Creates, acknowledges, and resolves Treasury alerts.
 *
 * Alert types:
 *   LOW_LIQUIDITY       — pool available < low watermark
 *   CRITICAL_LIQUIDITY  — pool available < critical watermark
 *   NEGATIVE_EXPOSURE   — pool balance is negative
 *   OVERDUE_SETTLEMENT  — settlement obligation past due date
 *   STUCK_RESERVATION   — reservation pending > TTL with no confirmation
 *   POOL_SUSPENDED      — pool manually suspended
 *   SETTLEMENT_DISPUTED — settlement obligation marked as disputed
 *
 * Firestore: treasury_alerts/{alertId}
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  TreasuryAlert,
  TreasuryAlertType,
  TreasuryAlertSeverity,
  TreasuryAlertStatus,
  TreasuryProvider,
  TreasuryCurrency,
  AlertFilters,
} from './treasuryTypes';

const ALERTS_COL = 'treasury_alerts';

function now(): string {
  return new Date().toISOString();
}

function generateAlertId(): string {
  return `talert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function deriveSeverity(type: TreasuryAlertType): TreasuryAlertSeverity {
  switch (type) {
    case 'NEGATIVE_EXPOSURE':
    case 'CRITICAL_LIQUIDITY':
    case 'SETTLEMENT_DISPUTED':
      return 'critical';
    case 'OVERDUE_SETTLEMENT':
    case 'POOL_SUSPENDED':
    case 'STUCK_RESERVATION':
      return 'high';
    case 'LOW_LIQUIDITY':
      return 'medium';
    default:
      return 'info';
  }
}

export const treasuryAlertsService = {
  /**
   * createAlert — writes a new treasury alert to Firestore.
   */
  async createAlert(params: {
    type: TreasuryAlertType;
    provider: TreasuryProvider;
    currency?: TreasuryCurrency;
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<TreasuryAlert> {
    const alertId = generateAlertId();
    const severity = deriveSeverity(params.type);
    const alert: TreasuryAlert = {
      alertId,
      type: params.type,
      severity,
      status: 'open',
      provider: params.provider,
      currency: params.currency,
      poolId: params.currency ? `${params.provider}_${params.currency}` : undefined,
      description: params.description,
      createdAt: now(),
      metadata: params.metadata,
    };

    if (__DEV__) {
      console.log(
        `[TreasuryAlert] ${params.type} | ${params.provider} | severity:${severity} | ${params.description.slice(0, 80)}`,
      );
      return alert;
    }

    try {
      await setDoc(doc(db, ALERTS_COL, alertId), alert);
    } catch (err) {
      console.error('[treasuryAlertsService] createAlert failed:', err);
    }
    return alert;
  },

  /**
   * acknowledgeAlert — marks an alert as acknowledged by an admin.
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void> {
    if (__DEV__) {
      console.log(`[TreasuryAlert] ACKNOWLEDGE ${alertId} by ${acknowledgedBy}`);
      return;
    }
    await updateDoc(doc(db, ALERTS_COL, alertId), {
      status: 'acknowledged' as TreasuryAlertStatus,
      acknowledgedAt: now(),
      resolvedBy: acknowledgedBy,
    });
  },

  /**
   * resolveAlert — marks an alert as resolved.
   */
  async resolveAlert(alertId: string, resolvedBy: string): Promise<void> {
    if (__DEV__) {
      console.log(`[TreasuryAlert] RESOLVE ${alertId} by ${resolvedBy}`);
      return;
    }
    await updateDoc(doc(db, ALERTS_COL, alertId), {
      status: 'resolved' as TreasuryAlertStatus,
      resolvedAt: now(),
      resolvedBy,
    });
  },

  /**
   * suppressAlert — marks an alert as suppressed (admin decision to ignore).
   */
  async suppressAlert(alertId: string, suppressedBy: string): Promise<void> {
    if (__DEV__) {
      console.log(`[TreasuryAlert] SUPPRESS ${alertId} by ${suppressedBy}`);
      return;
    }
    await updateDoc(doc(db, ALERTS_COL, alertId), {
      status: 'suppressed' as TreasuryAlertStatus,
      resolvedAt: now(),
      resolvedBy: suppressedBy,
    });
  },

  /**
   * getAllAlerts — returns alerts with optional filters.
   */
  async getAllAlerts(filters?: AlertFilters): Promise<TreasuryAlert[]> {
    if (__DEV__) {
      let alerts = getMockAlerts();
      if (filters?.type) alerts = alerts.filter((a) => a.type === filters.type);
      if (filters?.severity) alerts = alerts.filter((a) => a.severity === filters.severity);
      if (filters?.status) alerts = alerts.filter((a) => a.status === filters.status);
      if (filters?.provider) alerts = alerts.filter((a) => a.provider === filters.provider);
      return alerts;
    }
    try {
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(200)];
      if (filters?.status) constraints.push(where('status', '==', filters.status));
      if (filters?.type) constraints.push(where('type', '==', filters.type));
      if (filters?.severity) constraints.push(where('severity', '==', filters.severity));
      if (filters?.provider) constraints.push(where('provider', '==', filters.provider));
      const q = query(collection(db, ALERTS_COL), ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as TreasuryAlert);
    } catch (err) {
      console.error('[treasuryAlertsService] getAllAlerts failed:', err);
      return [];
    }
  },

  /**
   * getOpenAlerts — returns only open alerts.
   */
  async getOpenAlerts(filters?: AlertFilters): Promise<TreasuryAlert[]> {
    return this.getAllAlerts({ ...filters, status: 'open' });
  },

  /**
   * checkAndAlertLowLiquidity — examines a pool and creates an alert if below watermarks.
   */
  async checkAndAlertLowLiquidity(pool: {
    poolId: string;
    provider: TreasuryProvider;
    currency: TreasuryCurrency;
    availableBalance: number;
    lowWatermarkAmount: number;
    criticalWatermarkAmount: number;
  }): Promise<void> {
    if (pool.availableBalance < 0) {
      await this.createAlert({
        type: 'NEGATIVE_EXPOSURE',
        provider: pool.provider,
        currency: pool.currency,
        description: `Pool ${pool.poolId} has NEGATIVE available balance: ${pool.availableBalance} ${pool.currency}. Immediate action required.`,
        metadata: { poolId: pool.poolId, availableBalance: pool.availableBalance },
      });
    } else if (pool.availableBalance <= pool.criticalWatermarkAmount) {
      await this.createAlert({
        type: 'CRITICAL_LIQUIDITY',
        provider: pool.provider,
        currency: pool.currency,
        description: `Pool ${pool.poolId} available balance (${pool.availableBalance} ${pool.currency}) is at or below critical watermark (${pool.criticalWatermarkAmount}).`,
        metadata: {
          poolId: pool.poolId,
          availableBalance: pool.availableBalance,
          criticalWatermark: pool.criticalWatermarkAmount,
        },
      });
    } else if (pool.availableBalance <= pool.lowWatermarkAmount) {
      await this.createAlert({
        type: 'LOW_LIQUIDITY',
        provider: pool.provider,
        currency: pool.currency,
        description: `Pool ${pool.poolId} available balance (${pool.availableBalance} ${pool.currency}) is below low watermark (${pool.lowWatermarkAmount}).`,
        metadata: {
          poolId: pool.poolId,
          availableBalance: pool.availableBalance,
          lowWatermark: pool.lowWatermarkAmount,
        },
      });
    }
  },
};

// ─────────────────────────────────────────────
// DEV MOCK DATA
// ─────────────────────────────────────────────

function getMockAlerts(): TreasuryAlert[] {
  return [
    {
      alertId: 'talert_mock_001',
      type: 'CRITICAL_LIQUIDITY',
      severity: 'critical',
      status: 'open',
      provider: 'BANK_AWASH',
      currency: 'ETB',
      poolId: 'BANK_AWASH_ETB',
      description:
        'Pool BANK_AWASH_ETB available balance (75,000 ETB) is at or below critical watermark (100,000 ETB).',
      createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      metadata: { availableBalance: 75000, criticalWatermark: 100000 },
    },
    {
      alertId: 'talert_mock_002',
      type: 'LOW_LIQUIDITY',
      severity: 'medium',
      status: 'open',
      provider: 'BANK_DASHEN',
      currency: 'ETB',
      poolId: 'BANK_DASHEN_ETB',
      description:
        'Pool BANK_DASHEN_ETB available balance (320,000 ETB) is below low watermark (500,000 ETB).',
      createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      metadata: { availableBalance: 320000, lowWatermark: 500000 },
    },
    {
      alertId: 'talert_mock_003',
      type: 'OVERDUE_SETTLEMENT',
      severity: 'high',
      status: 'open',
      provider: 'TELEBIRR',
      currency: 'ETB',
      description:
        'Settlement obligation sett_mock_002 is overdue. Was due 6h ago. Amount: 89,500 ETB.',
      createdAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
      metadata: { obligationId: 'sett_mock_002', amount: 89500, overdueHours: '6.0' },
    },
    {
      alertId: 'talert_mock_004',
      type: 'STUCK_RESERVATION',
      severity: 'high',
      status: 'acknowledged',
      provider: 'BANK_AWASH',
      currency: 'ETB',
      poolId: 'BANK_AWASH_ETB',
      description:
        'Reservation tres_mock_004 auto-expired after 2h TTL.',
      createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      acknowledgedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      resolvedBy: 'admin_uid_001',
      metadata: { reservationId: 'tres_mock_004', amount: 15200 },
    },
    {
      alertId: 'talert_mock_005',
      type: 'SETTLEMENT_DISPUTED',
      severity: 'critical',
      status: 'open',
      provider: 'BANK_AWASH',
      currency: 'ETB',
      description:
        'Settlement obligation sett_mock_005 is disputed. Awash Bank claims settlement wired. Under investigation.',
      createdAt: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
      metadata: { obligationId: 'sett_mock_005', amount: 54800 },
    },
    {
      alertId: 'talert_mock_006',
      type: 'LOW_LIQUIDITY',
      severity: 'medium',
      status: 'resolved',
      provider: 'CHAPA',
      currency: 'ETB',
      poolId: 'CHAPA_ETB',
      description: 'Pool CHAPA_ETB was below low watermark. Now resolved.',
      createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      resolvedAt: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
      resolvedBy: 'admin_uid_001',
    },
  ];
}

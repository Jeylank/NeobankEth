/**
 * reconciliationAlertService.ts
 * ─────────────────────────────
 * Creates, resolves, and queries reconciliation alerts in Firestore.
 * Alerts are admin-only read — clients never write to this collection.
 */

import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  ReconciliationAlert,
  ReconciliationAlertType,
  ReconciliationSeverity,
  ReconciliationAlertStatus,
  AlertFilters,
} from './reconciliationTypes';

const ALERTS_COL = 'reconciliation_alerts';

function generateAlertId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

/** Determine severity based on alert type. */
function deriveSeverity(type: ReconciliationAlertType): ReconciliationSeverity {
  switch (type) {
    case 'DUPLICATE_PAYOUT':
    case 'LEDGER_INCONSISTENCY':
    case 'AMOUNT_MISMATCH':
      return 'critical';
    case 'MISSING_EXTERNAL':
    case 'MISSING_INTERNAL':
    case 'SETTLEMENT_OVERDUE':
      return 'high';
    case 'STATUS_MISMATCH':
    case 'STALE_RESERVATION':
      return 'medium';
    default:
      return 'low';
  }
}

/** Build a human-readable description for each alert type. */
function buildDescription(
  type: ReconciliationAlertType,
  txId: string,
  provider: string,
  extra?: string,
): string {
  switch (type) {
    case 'AMOUNT_MISMATCH':
      return `Amount mismatch on tx ${txId} via ${provider}. ${extra ?? ''}`.trim();
    case 'STATUS_MISMATCH':
      return `Status mismatch on tx ${txId}: internal vs provider ${provider}. ${extra ?? ''}`.trim();
    case 'MISSING_EXTERNAL':
      return `Tx ${txId} exists internally but not in ${provider} settlement report. ${extra ?? ''}`.trim();
    case 'MISSING_INTERNAL':
      return `Provider ${provider} settlement entry has no matching internal tx. ${extra ?? ''}`.trim();
    case 'DUPLICATE_PAYOUT':
      return `Duplicate payout detected for tx ${txId} via ${provider}. ${extra ?? ''}`.trim();
    case 'STALE_RESERVATION':
      return `FX/treasury reservation not confirmed or released for tx ${txId}. ${extra ?? ''}`.trim();
    case 'SETTLEMENT_OVERDUE':
      return `Settlement obligation for tx ${txId} is overdue. ${extra ?? ''}`.trim();
    case 'LEDGER_INCONSISTENCY':
      return `Ledger inconsistency on tx ${txId}: debit exists without matching payout or vice-versa. ${extra ?? ''}`.trim();
    default:
      return `Reconciliation alert on tx ${txId} via ${provider}.`;
  }
}

export const reconciliationAlertService = {
  /**
   * createAlert — writes a new alert document to Firestore.
   * Returns the created alert.
   */
  async createAlert(params: {
    runId: string;
    txId: string;
    provider: string;
    type: ReconciliationAlertType;
    extra?: string;
  }): Promise<ReconciliationAlert> {
    const { runId, txId, provider, type, extra } = params;
    const severity = deriveSeverity(type);
    const alertId = generateAlertId();
    const alert: ReconciliationAlert = {
      alertId,
      runId,
      txId,
      provider,
      type,
      severity,
      status: 'open',
      description: buildDescription(type, txId, provider, extra),
      createdAt: now(),
    };

    if (__DEV__) {
      console.log(`[ReconciliationAlert] CREATE ${type} | tx:${txId} | severity:${severity}`);
      return alert;
    }

    try {
      await setDoc(doc(db, ALERTS_COL, alertId), alert);
    } catch (err) {
      console.error('[reconciliationAlertService] createAlert failed:', err);
    }
    return alert;
  },

  /**
   * resolveAlert — marks an alert as resolved.
   */
  async resolveAlert(alertId: string, resolvedBy: string): Promise<void> {
    if (__DEV__) {
      console.log(`[ReconciliationAlert] RESOLVE ${alertId} by ${resolvedBy}`);
      return;
    }
    await updateDoc(doc(db, ALERTS_COL, alertId), {
      status: 'resolved' as ReconciliationAlertStatus,
      resolvedAt: now(),
      resolvedBy,
    });
  },

  /**
   * ignoreAlert — marks an alert as ignored (suppressed by admin).
   */
  async ignoreAlert(alertId: string, resolvedBy: string): Promise<void> {
    if (__DEV__) {
      console.log(`[ReconciliationAlert] IGNORE ${alertId} by ${resolvedBy}`);
      return;
    }
    await updateDoc(doc(db, ALERTS_COL, alertId), {
      status: 'ignored' as ReconciliationAlertStatus,
      resolvedAt: now(),
      resolvedBy,
    });
  },

  /**
   * getOpenAlerts — returns all alerts that are open or investigating.
   */
  async getOpenAlerts(filters?: AlertFilters): Promise<ReconciliationAlert[]> {
    if (__DEV__) {
      return getMockAlerts().filter((a) => a.status === 'open' || a.status === 'investigating');
    }
    try {
      const constraints: any[] = [
        where('status', 'in', ['open', 'investigating']),
        orderBy('createdAt', 'desc'),
        limit(100),
      ];
      if (filters?.type) constraints.push(where('type', '==', filters.type));
      if (filters?.severity) constraints.push(where('severity', '==', filters.severity));
      if (filters?.provider) constraints.push(where('provider', '==', filters.provider));
      const q = query(collection(db, ALERTS_COL), ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as ReconciliationAlert);
    } catch (err) {
      console.error('[reconciliationAlertService] getOpenAlerts failed:', err);
      return [];
    }
  },

  /**
   * getAllAlerts — returns all alerts, optionally filtered.
   */
  async getAllAlerts(filters?: AlertFilters): Promise<ReconciliationAlert[]> {
    if (__DEV__) {
      let alerts = getMockAlerts();
      if (filters?.status) alerts = alerts.filter((a) => a.status === filters.status);
      if (filters?.type) alerts = alerts.filter((a) => a.type === filters.type);
      if (filters?.severity) alerts = alerts.filter((a) => a.severity === filters.severity);
      if (filters?.provider) alerts = alerts.filter((a) => a.provider === filters.provider);
      if (filters?.runId) alerts = alerts.filter((a) => a.runId === filters.runId);
      return alerts;
    }
    try {
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(200)];
      if (filters?.status) constraints.push(where('status', '==', filters.status));
      if (filters?.type) constraints.push(where('type', '==', filters.type));
      if (filters?.provider) constraints.push(where('provider', '==', filters.provider));
      if (filters?.runId) constraints.push(where('runId', '==', filters.runId));
      const q = query(collection(db, ALERTS_COL), ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as ReconciliationAlert);
    } catch (err) {
      console.error('[reconciliationAlertService] getAllAlerts failed:', err);
      return [];
    }
  },
};

// ─────────────────────────────────────────────
// DEV MOCK DATA
// ─────────────────────────────────────────────

function getMockAlerts(): ReconciliationAlert[] {
  return [
    {
      alertId: 'alert_mock_001',
      runId: 'rec_2026_03_08_001',
      txId: 'TXN_1001',
      provider: 'CHAPA',
      type: 'AMOUNT_MISMATCH',
      severity: 'critical',
      status: 'open',
      description: 'Amount mismatch on tx TXN_1001 via CHAPA. Internal: 12,056 ETB vs External: 12,000 ETB.',
      createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    },
    {
      alertId: 'alert_mock_002',
      runId: 'rec_2026_03_08_001',
      txId: 'TXN_1002',
      provider: 'TELEBIRR',
      type: 'MISSING_EXTERNAL',
      severity: 'high',
      status: 'investigating',
      description: 'Tx TXN_1002 exists internally but not in TELEBIRR settlement report.',
      createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    },
    {
      alertId: 'alert_mock_003',
      runId: 'rec_2026_03_08_001',
      txId: 'TXN_1003',
      provider: 'BANK',
      type: 'STATUS_MISMATCH',
      severity: 'medium',
      status: 'open',
      description: 'Status mismatch on tx TXN_1003: internal=COMPLETED vs provider=PROCESSING.',
      createdAt: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
    },
    {
      alertId: 'alert_mock_004',
      runId: 'rec_2026_03_08_001',
      txId: 'TXN_1004',
      provider: 'CHAPA',
      type: 'STALE_RESERVATION',
      severity: 'medium',
      status: 'open',
      description: 'FX/treasury reservation not confirmed or released for tx TXN_1004.',
      createdAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    },
    {
      alertId: 'alert_mock_005',
      runId: 'rec_2026_03_07_001',
      txId: 'TXN_0998',
      provider: 'TELEBIRR',
      type: 'DUPLICATE_PAYOUT',
      severity: 'critical',
      status: 'resolved',
      description: 'Duplicate payout detected for tx TXN_0998 via TELEBIRR.',
      createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      resolvedAt: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
      resolvedBy: 'admin_uid_001',
    },
    {
      alertId: 'alert_mock_006',
      runId: 'rec_2026_03_08_001',
      txId: 'TXN_1005',
      provider: 'BANK',
      type: 'SETTLEMENT_OVERDUE',
      severity: 'high',
      status: 'open',
      description: 'Settlement obligation for tx TXN_1005 is overdue by 48 hours.',
      createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    },
  ];
}

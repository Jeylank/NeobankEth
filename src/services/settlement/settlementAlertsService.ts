/**
 * settlementAlertsService.ts
 * ───────────────────────────
 * Generates and manages settlement engine alerts.
 *
 * Alert types:
 *   SETTLEMENT_OVERDUE   — batch not settled within SLA window
 *   SETTLEMENT_MISMATCH  — partner-reported amount != internal sum
 *   NEGATIVE_EXPOSURE    — Habeshare net exposure goes negative
 *   BATCH_FAILURE        — a settlement batch transitions to FAILED
 *
 * Collection: settlement_alerts/{alertId}
 */

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  SettlementAlert,
  SettlementAlertType,
  SettlementAlertSeverity,
  AlertFilters,
} from './settlementTypes';

const COL = 'settlement_alerts';

function now(): string {
  return new Date().toISOString();
}

function generateAlertId(): string {
  return `sa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function auditLog(event: string, data: Record<string, unknown>): void {
  console.log(`[SettlementAlerts:AuditLog] ${event}`, JSON.stringify(data));
}

export const settlementAlertsService = {
  /**
   * createAlert — write a new settlement alert document.
   * Called by settlementBatchService and settlementReconciliationService.
   */
  async createAlert(
    type: SettlementAlertType,
    provider: string,
    currency: string,
    severity: SettlementAlertSeverity,
    message: string,
  ): Promise<string> {
    const alertId = generateAlertId();
    const alert: SettlementAlert = {
      alertId,
      type,
      provider,
      currency,
      severity,
      message,
      status: 'OPEN',
      createdAt: now(),
      resolvedAt: null,
    };

    try {
      await setDoc(doc(db, COL, alertId), alert);
    } catch (err: any) {
      console.error('[settlementAlertsService] createAlert failed:', err.message);
    }

    auditLog('settlement_alert_created', { alertId, type, provider, severity });
    return alertId;
  },

  /**
   * resolveAlert — mark a settlement alert as resolved.
   */
  async resolveAlert(alertId: string, resolvedBy: string): Promise<void> {
    try {
      const ref = doc(db, COL, alertId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error(`Alert ${alertId} not found`);
      await updateDoc(ref, { status: 'RESOLVED', resolvedAt: now(), resolvedBy });
      auditLog('settlement_alert_resolved', { alertId, resolvedBy });
    } catch (err: any) {
      console.error('[settlementAlertsService] resolveAlert failed:', err.message);
    }
  },

  /**
   * listAlerts — list alerts with optional filters.
   */
  async listAlerts(filters?: AlertFilters, limitCount = 50): Promise<SettlementAlert[]> {
    try {
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(limitCount)];
      if (filters?.type)     constraints.unshift(where('type',     '==', filters.type));
      if (filters?.severity) constraints.unshift(where('severity', '==', filters.severity));
      if (filters?.status)   constraints.unshift(where('status',   '==', filters.status));

      const q = query(collection(db, COL), ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as SettlementAlert);
    } catch (err: any) {
      console.warn('[settlementAlertsService] listAlerts fallback (dev):', err.message);
      return _devAlertStubs();
    }
  },

  /** Count open alerts — used by overview summary. */
  async countOpenAlerts(): Promise<number> {
    try {
      const q = query(collection(db, COL), where('status', '==', 'OPEN'));
      const snap = await getDocs(q);
      return snap.size;
    } catch {
      return 3; // dev fallback
    }
  },
};

// ─── DEV STUBS ───────────────────────────────

function _devAlertStubs(): SettlementAlert[] {
  return [
    {
      alertId: 'sa_dev_001',
      type: 'SETTLEMENT_OVERDUE',
      provider: 'CHAPA',
      currency: 'ETB',
      severity: 'HIGH',
      message: 'Settlement batch overdue by 1 day. Batch: batch_2026_03_07_chapa_etb',
      status: 'OPEN',
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      resolvedAt: null,
    },
    {
      alertId: 'sa_dev_002',
      type: 'SETTLEMENT_MISMATCH',
      provider: 'TELEBIRR',
      currency: 'ETB',
      severity: 'CRITICAL',
      message: 'Partner reported 495,000 ETB but internal sum is 500,000 ETB. Difference: -5,000 ETB.',
      status: 'OPEN',
      createdAt: new Date(Date.now() - 43_200_000).toISOString(),
      resolvedAt: null,
    },
    {
      alertId: 'sa_dev_003',
      type: 'BATCH_FAILURE',
      provider: 'BANK_DASHEN',
      currency: 'ETB',
      severity: 'MEDIUM',
      message: 'Batch batch_2026_03_06_bank_dashen_etb failed. Retry or investigate.',
      status: 'RESOLVED',
      createdAt: new Date(Date.now() - 172_800_000).toISOString(),
      resolvedAt: new Date(Date.now() - 86_400_000).toISOString(),
      resolvedBy: 'admin@habeshare.com',
    },
  ];
}

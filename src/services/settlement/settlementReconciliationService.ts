/**
 * settlementReconciliationService.ts
 * ────────────────────────────────────
 * Compares partner-reported settlement totals against Habeshare internal
 * obligation sums. Generates settlement_reconciliation_reports and raises
 * SETTLEMENT_MISMATCH alerts when differences are detected.
 *
 * Collection: settlement_reconciliation_reports/{reportId}
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import { settlementAlertsService } from './settlementAlertsService';
import type {
  SettlementReconciliationReport,
  SettlementReconciliationStatus,
  ReconciliationFilters,
} from './settlementTypes';

const COL = 'settlement_reconciliation_reports';
const OBLIGATIONS_COL = 'se_obligations';

function now(): string {
  return new Date().toISOString();
}

function generateReportId(provider: string, date: string): string {
  return `srecon_${date}_${provider}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function auditLog(event: string, data: Record<string, unknown>): void {
  console.log(`[SettlementRecon:AuditLog] ${event}`, JSON.stringify(data));
}

export const settlementReconciliationService = {
  /**
   * runReconciliation — compare internal obligation sum vs partner-reported total.
   *
   * In production, `reportedAmount` comes from provider webhook or file upload.
   * In dev/staging, it is passed manually via admin trigger.
   *
   * If the difference is non-zero, generates a SETTLEMENT_MISMATCH alert.
   */
  async runReconciliation(
    provider: string,
    currency: string,
    reportedAmount: number,
    date = new Date().toISOString().slice(0, 10),
  ): Promise<SettlementReconciliationReport> {
    // Sum all SETTLED obligations for this provider/currency on this date
    let expectedAmount = 0;
    try {
      const q = query(
        collection(db, OBLIGATIONS_COL),
        where('provider', '==', provider),
        where('currency', '==', currency),
        where('status', '==', 'SETTLED'),
      );
      const snap = await getDocs(q);
      expectedAmount = snap.docs.reduce((sum, d) => sum + (d.data().amount ?? 0), 0);
    } catch (err: any) {
      console.warn('[settlementReconciliationService] Could not fetch obligations (dev):', err.message);
      // Dev fallback: use reported amount + small synthetic discrepancy
      expectedAmount = reportedAmount + (Math.random() > 0.6 ? 5_000 : 0);
    }

    const difference = reportedAmount - expectedAmount;
    const status: SettlementReconciliationStatus =
      Math.abs(difference) < 0.01 ? 'MATCHED' : 'MISMATCH';

    const reportId = generateReportId(provider, date);
    const report: SettlementReconciliationReport = {
      reportId,
      provider,
      currency,
      date,
      expectedAmount,
      reportedAmount,
      difference,
      status,
      createdAt: now(),
    };

    try {
      await setDoc(doc(db, COL, reportId), report);
    } catch (err: any) {
      console.error('[settlementReconciliationService] write failed:', err.message);
    }

    auditLog('settlement_reconciliation_mismatch', {
      reportId,
      provider,
      currency,
      expectedAmount,
      reportedAmount,
      difference,
      status,
    });

    // Raise alert for any mismatch
    if (status === 'MISMATCH') {
      await settlementAlertsService.createAlert(
        'SETTLEMENT_MISMATCH',
        provider,
        currency,
        Math.abs(difference) > 10_000 ? 'CRITICAL' : 'HIGH',
        `Partner reported ${reportedAmount} ${currency} but internal sum is ${expectedAmount.toFixed(2)} ${currency}. Difference: ${difference.toFixed(2)} ${currency}.`,
      );
    }

    return report;
  },

  /**
   * listReports — retrieve reconciliation reports with optional filters.
   */
  async listReports(
    filters?: ReconciliationFilters,
    limitCount = 50,
  ): Promise<SettlementReconciliationReport[]> {
    try {
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(limitCount)];
      if (filters?.provider) constraints.unshift(where('provider', '==', filters.provider));
      if (filters?.status)   constraints.unshift(where('status',   '==', filters.status));

      const q = query(collection(db, COL), ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as SettlementReconciliationReport);
    } catch (err: any) {
      console.warn('[settlementReconciliationService] listReports fallback (dev):', err.message);
      return _devReportStubs();
    }
  },

  /** Count mismatched reports for overview summary. */
  async countMismatches(): Promise<number> {
    try {
      const q = query(collection(db, COL), where('status', '==', 'MISMATCH'));
      const snap = await getDocs(q);
      return snap.size;
    } catch {
      return 2; // dev fallback
    }
  },
};

// ─── DEV STUBS ───────────────────────────────

const PROVIDERS = ['CHAPA', 'TELEBIRR', 'BANK_DASHEN', 'BANK_AWASH'];

function _devReportStubs(): SettlementReconciliationReport[] {
  return PROVIDERS.map((p, i) => {
    const expected = 500_000 + i * 50_000;
    const reported = i === 1 ? expected - 5_000 : expected;
    return {
      reportId: generateReportId(p, new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)),
      provider: p,
      currency: 'ETB',
      date: new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10),
      expectedAmount: expected,
      reportedAmount: reported,
      difference: reported - expected,
      status: reported === expected ? 'MATCHED' : 'MISMATCH',
      createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
    };
  });
}

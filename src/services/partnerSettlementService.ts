/**
 * partnerSettlementService.ts
 * ────────────────────────────
 * Tracks net financial balances between Sumsuma and each payout partner.
 *
 * This service operates on a RUNNING NET BALANCE model:
 *   - inflow  = funds received FROM a partner (e.g. top-up settled by Chapa)
 *   - outflow = funds sent TO a partner (e.g. payout dispatched via Telebirr)
 *   - netBalance = inflow − outflow  (positive = Sumsuma is owed; negative = Sumsuma owes)
 *
 * IMPORTANT: this is separate from treasury/settlementService.ts which tracks
 * per-payout settlement OBLIGATIONS. This service aggregates totals and
 * produces the daily settlement summary for finance reconciliation.
 *
 * Firestore collection: partner_settlements/{provider_currency}
 *
 * SAFETY:
 *   - Only the backend writes to partner_settlements
 *   - Reads are admin-only via adminService
 *   - No wallet or payout data is mutated here
 */

import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  increment,
} from 'firebase/firestore';
import { db } from './firebase';
import { AUDIT_EVENTS, SettlementError } from '../types';
import type { SettlementRecord, ReconciliationReport, ReconciliationDiscrepancy } from '../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const SETTLEMENTS_COL = 'partner_settlements';
const RECON_REPORTS_COL = 'reconciliation_reports';

// Canonical provider IDs used across the system
type PayoutProvider = 'CHAPA' | 'TELEBIRR' | 'BANK_DASHEN' | 'BANK_AWASH' | 'BANK_CBE' | 'BANK_ABYSSINIA';
type Currency = 'ETB' | 'USD' | 'EUR' | 'GBP';
type Direction = 'inflow' | 'outflow';

interface RecordSettlementInput {
  txId: string;
  provider: PayoutProvider | string;
  amount: number;
  currency: Currency | string;
  direction: Direction;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

/** Document ID is provider_currency so one doc per provider/currency pair */
function settlementDocId(provider: string, currency: string): string {
  return `${provider}_${currency}`.toUpperCase();
}

function generateReportId(date: string, provider: string): string {
  return `recon_rpt_${date}_${provider}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/** Structured audit logging — mirrors format used by reconciliationService */
function auditLog(event: string, data: Record<string, unknown>): void {
  console.log(`[PartnerSettlement:AuditLog] ${event}`, JSON.stringify(data));
}

// ─────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────

export const partnerSettlementService = {
  /**
   * recordSettlement — aggregate inflow or outflow for a provider/currency pair.
   *
   * Uses Firestore atomic increments to avoid race conditions when multiple
   * webhooks arrive simultaneously. Creates the document if it does not exist.
   *
   * Emits audit event: SETTLEMENT_RECORDED
   */
  async recordSettlement(input: RecordSettlementInput): Promise<void> {
    const { txId, provider, amount, currency, direction } = input;

    if (!provider || !currency || !txId) {
      throw new SettlementError('recordSettlement: txId, provider, and currency are required', 'INVALID_INPUT');
    }
    if (amount <= 0) {
      throw new SettlementError(`recordSettlement: amount must be positive, got ${amount}`, 'INVALID_AMOUNT');
    }
    if (direction !== 'inflow' && direction !== 'outflow') {
      throw new SettlementError(`recordSettlement: direction must be 'inflow' or 'outflow'`, 'INVALID_DIRECTION');
    }

    const docId = settlementDocId(provider, currency);
    const ref = doc(db, SETTLEMENTS_COL, docId);

    try {
      const snapshot = await getDoc(ref);

      if (!snapshot.exists()) {
        // Bootstrap the document on first write
        const initial: SettlementRecord = {
          settlementId: docId,
          provider,
          currency,
          inflow: direction === 'inflow' ? amount : 0,
          outflow: direction === 'outflow' ? amount : 0,
          netBalance: direction === 'inflow' ? amount : -amount,
          updatedAt: now(),
        };
        await setDoc(ref, initial);
      } else {
        // Atomic increments — no read-modify-write race condition
        const inflowDelta = direction === 'inflow' ? amount : 0;
        const outflowDelta = direction === 'outflow' ? amount : 0;
        const netDelta = direction === 'inflow' ? amount : -amount;

        await updateDoc(ref, {
          inflow: increment(inflowDelta),
          outflow: increment(outflowDelta),
          netBalance: increment(netDelta),
          updatedAt: now(),
        });
      }

      auditLog(AUDIT_EVENTS.SETTLEMENT_RECORDED, {
        txId,
        provider,
        currency,
        amount,
        direction,
        docId,
      });
    } catch (err: any) {
      if (err instanceof SettlementError) throw err;
      throw new SettlementError(
        `recordSettlement failed for tx:${txId} — ${err.message}`,
        'FIRESTORE_ERROR',
      );
    }
  },

  /**
   * getPartnerBalance — retrieve the current running net balance for a provider.
   *
   * Returns all currencies for that provider since a single provider may
   * settle in multiple currencies (e.g. Chapa settles ETB, USDT).
   */
  async getPartnerBalance(provider: string): Promise<SettlementRecord[]> {
    if (!provider) {
      throw new SettlementError('getPartnerBalance: provider is required', 'INVALID_INPUT');
    }

    try {
      const q = query(
        collection(db, SETTLEMENTS_COL),
        where('provider', '==', provider),
        orderBy('currency'),
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        // Return a zero-balance stub so callers don't need to handle null
        return [
          {
            settlementId: settlementDocId(provider, 'ETB'),
            provider,
            currency: 'ETB',
            inflow: 0,
            outflow: 0,
            netBalance: 0,
            updatedAt: now(),
          },
        ];
      }

      return snap.docs.map((d) => d.data() as SettlementRecord);
    } catch (err: any) {
      if (err instanceof SettlementError) throw err;
      // Dev fallback
      console.warn('[partnerSettlementService] getPartnerBalance fallback (dev):', err.message);
      return [
        {
          settlementId: settlementDocId(provider, 'ETB'),
          provider,
          currency: 'ETB',
          inflow: 5_000_000,
          outflow: 3_800_000,
          netBalance: 1_200_000,
          updatedAt: now(),
        },
      ];
    }
  },

  /**
   * generateSettlementSummary — produce an inflow/outflow/net report for a
   * specific date. Stores the result in reconciliation_reports/{reportId}.
   *
   * Called by the daily reconciliation worker after each full run.
   */
  async generateSettlementSummary(
    date: string,
    provider: string,
    totalTransactions: number,
    matched: number,
    mismatched: number,
    discrepancies: ReconciliationDiscrepancy[],
  ): Promise<ReconciliationReport> {
    const reportId = generateReportId(date, provider);

    let balance: SettlementRecord;
    try {
      const balances = await partnerSettlementService.getPartnerBalance(provider);
      balance = balances[0] ?? {
        settlementId: '',
        provider,
        currency: 'ETB',
        inflow: 0,
        outflow: 0,
        netBalance: 0,
        updatedAt: now(),
      };
    } catch {
      balance = {
        settlementId: '',
        provider,
        currency: 'ETB',
        inflow: 0,
        outflow: 0,
        netBalance: 0,
        updatedAt: now(),
      };
    }

    const report: ReconciliationReport = {
      reportId,
      date,
      provider,
      totalTransactions,
      matched,
      mismatched,
      discrepancies,
      totalInflow: balance.inflow,
      totalOutflow: balance.outflow,
      netSettlement: balance.netBalance,
      currency: balance.currency,
      createdAt: now(),
    };

    try {
      await setDoc(doc(db, RECON_REPORTS_COL, reportId), report);
    } catch (err: any) {
      // Log but do not throw — the worker must not crash on report write failures
      console.error('[partnerSettlementService] generateSettlementSummary write failed:', err.message);
    }

    auditLog(AUDIT_EVENTS.RECONCILIATION_RUN, {
      reportId,
      date,
      provider,
      totalTransactions,
      matched,
      mismatched,
      discrepancyCount: discrepancies.length,
      netSettlement: report.netSettlement,
    });

    return report;
  },

  /**
   * listAllPartnerBalances — returns current net balances for all providers.
   * Used by the admin settlements API.
   */
  async listAllPartnerBalances(): Promise<SettlementRecord[]> {
    try {
      const snap = await getDocs(collection(db, SETTLEMENTS_COL));
      if (snap.empty) {
        return _devSettlementStubs();
      }
      return snap.docs.map((d) => d.data() as SettlementRecord);
    } catch (err: any) {
      console.warn('[partnerSettlementService] listAllPartnerBalances fallback (dev):', err.message);
      return _devSettlementStubs();
    }
  },

  /**
   * listReconciliationReports — returns stored reconciliation reports, newest first.
   * Used by the admin API (equivalent to GET /api/admin/reconciliation).
   */
  async listReconciliationReports(limitCount = 30): Promise<ReconciliationReport[]> {
    try {
      const q = query(
        collection(db, RECON_REPORTS_COL),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(q);
      const all = snap.docs.map((d) => d.data() as ReconciliationReport);
      return all.slice(0, limitCount);
    } catch (err: any) {
      console.warn('[partnerSettlementService] listReconciliationReports fallback (dev):', err.message);
      return _devReportStubs();
    }
  },
};

// ─────────────────────────────────────────────
// DEV STUBS (used when Firestore returns empty)
// ─────────────────────────────────────────────

const PROVIDERS: PayoutProvider[] = [
  'CHAPA',
  'TELEBIRR',
  'BANK_DASHEN',
  'BANK_AWASH',
  'BANK_CBE',
  'BANK_ABYSSINIA',
];

function _devSettlementStubs(): SettlementRecord[] {
  return PROVIDERS.map((p, i) => {
    const inflow = (5_000_000 + i * 300_000);
    const outflow = (3_800_000 + i * 200_000);
    return {
      settlementId: settlementDocId(p, 'ETB'),
      provider: p,
      currency: 'ETB',
      inflow,
      outflow,
      netBalance: inflow - outflow,
      updatedAt: new Date(Date.now() - i * 3600 * 1000).toISOString(),
    };
  });
}

function _devReportStubs(): ReconciliationReport[] {
  return PROVIDERS.map((p, i) => {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    return {
      reportId: generateReportId(date, p),
      date,
      provider: p,
      totalTransactions: 1200 - i * 50,
      matched: 1180 - i * 45,
      mismatched: 20 + i * 2,
      discrepancies: [],
      totalInflow: 5_000_000 + i * 300_000,
      totalOutflow: 3_800_000 + i * 200_000,
      netSettlement: 1_200_000 + i * 100_000,
      currency: 'ETB',
      createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
    };
  });
}

/**
 * reconciliationService.ts
 * ────────────────────────
 * Main orchestration entrypoint for the Habeshare Reconciliation Engine.
 *
 * Responsibilities:
 *  - create and manage reconciliation runs
 *  - coordinate provider report fetching
 *  - invoke matcher logic
 *  - write ReconciliationItems to Firestore
 *  - create alerts via reconciliationAlertService
 *  - emit audit log events
 *  - finalize run with summary stats
 *
 * SAFETY: this service is READ-MOSTLY. It never modifies payout_transactions,
 * wallet entries, or any live transaction data. It only writes to:
 *   reconciliation_runs / reconciliation_items / reconciliation_alerts
 */

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
} from 'firebase/firestore';
import { app } from '../firebase';
import type {
  ReconciliationRun,
  ReconciliationItem,
  ReconciliationOptions,
  ReconciliationSummary,
  ReconciliationProvider,
  MatchResult,
} from './reconciliationTypes';
import { fetchProviderReport, saveProviderReport } from './providerReportService';
import {
  matchTransactions,
  detectDuplicates,
  detectStaleReservations,
  detectSettlementOverdue,
  detectLedgerInconsistency,
  type InternalPayoutRecord,
  type ReservationRecord,
  type SettlementObligation,
  type LedgerRecord,
} from './reconciliationMatcher';
import { reconciliationAlertService } from './reconciliationAlertService';

const db = getFirestore(app);
const RUNS_COL = 'reconciliation_runs';
const ITEMS_COL = 'reconciliation_items';
const PAYOUT_COL = 'payout_transactions';
const WALLET_COL = 'wallets';
const FX_RESERVATIONS_COL = 'fx_reservations';

function now(): string {
  return new Date().toISOString();
}

function generateRunId(): string {
  const d = new Date();
  const date = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}`;
  const seq = Math.floor(Math.random() * 900 + 100);
  return `rec_${date}_${seq}`;
}

function generateItemId(): string {
  return `rec_item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────
// AUDIT LOGGING
// ─────────────────────────────────────────────

function auditLog(event: string, data: Record<string, unknown>): void {
  console.log(`[AuditLog] ${event}`, JSON.stringify(data, null, 0));
}

// ─────────────────────────────────────────────
// INTERNAL DATA LOADERS
// ─────────────────────────────────────────────

async function loadInternalPayouts(
  provider: ReconciliationProvider,
  dateRange?: { start: string; end: string },
): Promise<InternalPayoutRecord[]> {
  if (__DEV__) {
    return getMockInternalPayouts(provider);
  }
  try {
    const constraints: any[] = [];
    if (provider !== 'all') constraints.push(where('provider', '==', provider));
    if (dateRange?.start) constraints.push(where('createdAt', '>=', dateRange.start));
    if (dateRange?.end) constraints.push(where('createdAt', '<=', dateRange.end));
    const q = query(collection(db, PAYOUT_COL), ...constraints, limit(5000));
    const snap = await getDocs(q);
    return snap.docs.map((d): InternalPayoutRecord => {
      const data = d.data();
      return {
        txId: data.id ?? d.id,
        providerRef: data.providerRef ?? '',
        provider: data.provider ?? '',
        amount: data.amount ?? 0,
        currency: data.currency ?? 'ETB',
        payoutStatus: data.payoutStatus ?? '',
        createdAt: data.createdAt ?? now(),
        recipientAccount: data.recipientAccount ?? '',
      };
    });
  } catch (err) {
    console.error('[reconciliationService] loadInternalPayouts failed:', err);
    return [];
  }
}

async function loadFxReservations(): Promise<ReservationRecord[]> {
  if (__DEV__) return getMockReservations();
  try {
    const q = query(
      collection(db, FX_RESERVATIONS_COL),
      where('status', '==', 'reserved'),
      limit(1000),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d): ReservationRecord => {
      const data = d.data();
      return {
        reservationId: data.reservationId ?? d.id,
        txId: data.quoteId ?? '',
        status: data.status ?? 'reserved',
        createdAt: data.createdAt ?? now(),
        provider: data.bank ?? 'UNKNOWN',
        reservedAmountETB: data.reservedAmountETB ?? 0,
      };
    });
  } catch (err) {
    console.error('[reconciliationService] loadFxReservations failed:', err);
    return [];
  }
}

async function loadSettlementObligations(): Promise<SettlementObligation[]> {
  if (__DEV__) return getMockObligations();
  // In production, this would query a settlement_obligations collection.
  return [];
}

async function loadLedgerEntries(
  provider: ReconciliationProvider,
): Promise<LedgerRecord[]> {
  if (__DEV__) return getMockLedgerEntries();
  // In production: query wallet ledger subcollections.
  return [];
}

// ─────────────────────────────────────────────
// RESULT → ITEM WRITER
// ─────────────────────────────────────────────

async function writeItem(
  runId: string,
  result: MatchResult,
  provider: string,
): Promise<ReconciliationItem> {
  const itemId = generateItemId();
  const item: ReconciliationItem = {
    itemId,
    runId,
    txId: result.txId,
    provider,
    providerRef: result.providerRef,
    internalAmount: result.internalAmount,
    externalAmount: result.externalAmount,
    currency: result.currency,
    internalStatus: result.internalStatus,
    externalStatus: result.externalStatus,
    result: result.result,
    notes: result.notes,
    createdAt: now(),
  };
  if (!__DEV__) {
    try {
      await setDoc(doc(db, ITEMS_COL, itemId), item);
    } catch (err) {
      console.error('[reconciliationService] writeItem failed:', err);
    }
  }
  return item;
}

// ─────────────────────────────────────────────
// ALERT CREATION FROM RESULTS
// ─────────────────────────────────────────────

const RESULT_TO_ALERT: Record<string, string> = {
  amount_mismatch: 'AMOUNT_MISMATCH',
  status_mismatch: 'STATUS_MISMATCH',
  missing_external: 'MISSING_EXTERNAL',
  missing_internal: 'MISSING_INTERNAL',
  duplicate: 'DUPLICATE_PAYOUT',
  reservation_stale: 'STALE_RESERVATION',
  settlement_overdue: 'SETTLEMENT_OVERDUE',
  ledger_inconsistency: 'LEDGER_INCONSISTENCY',
};

async function maybeCreateAlert(
  runId: string,
  item: ReconciliationItem,
): Promise<boolean> {
  const alertType = RESULT_TO_ALERT[item.result];
  if (!alertType || item.result === 'matched') return false;
  await reconciliationAlertService.createAlert({
    runId,
    txId: item.txId,
    provider: item.provider,
    type: alertType as any,
    extra: item.notes,
  });
  return true;
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

export const reconciliationService = {
  /**
   * runReconciliation — full orchestration entry point.
   * Creates a run, fetches data, matches, writes items, creates alerts, finalizes.
   */
  async runReconciliation(options: ReconciliationOptions): Promise<ReconciliationSummary> {
    const runId = generateRunId();
    const dateRange = options.dateRangeStart
      ? { start: options.dateRangeStart, end: options.dateRangeEnd ?? now() }
      : { start: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), end: now() };

    const run: ReconciliationRun = {
      runId,
      startedAt: now(),
      status: 'running',
      mode: options.mode,
      provider: options.provider,
      dateRangeStart: dateRange.start,
      dateRangeEnd: dateRange.end,
      totalChecked: 0,
      totalMatched: 0,
      totalMismatched: 0,
      totalMissing: 0,
      totalDuplicate: 0,
      totalAlertsCreated: 0,
      createdBy: options.createdBy,
    };

    auditLog('reconciliation_run_started', { runId, mode: options.mode, provider: options.provider });

    if (!__DEV__) {
      await setDoc(doc(db, RUNS_COL, runId), run);
    }

    try {
      const providers: Array<Exclude<ReconciliationProvider, 'all'>> =
        options.provider === 'all' ? ['CHAPA', 'TELEBIRR', 'BANK'] : [options.provider as any];

      let totalChecked = 0;
      let totalMatched = 0;
      let totalMismatched = 0;
      let totalMissing = 0;
      let totalDuplicate = 0;
      let totalAlerts = 0;

      for (const provider of providers) {
        const [internalPayouts, providerReport, reservations, obligations, ledgerEntries] =
          await Promise.all([
            loadInternalPayouts(provider, dateRange),
            fetchProviderReport(provider, dateRange),
            loadFxReservations(),
            loadSettlementObligations(),
            loadLedgerEntries(provider),
          ]);

        await saveProviderReport(providerReport);

        // Match payout transactions vs provider report
        const matchResults = matchTransactions(internalPayouts, providerReport.items);

        // Additional detections
        const duplicates = detectDuplicates(internalPayouts, providerReport.items);
        const staleRes = detectStaleReservations(reservations);
        const overdue = detectSettlementOverdue(obligations);
        const ledgerIssues = detectLedgerInconsistency(
          ledgerEntries,
          internalPayouts.filter((p) => normalizeStatus(p.payoutStatus) === 'COMPLETED'),
        );

        const allResults = [
          ...matchResults,
          ...duplicates,
          ...staleRes,
          ...overdue,
          ...ledgerIssues,
        ];

        for (const result of allResults) {
          const item = await writeItem(runId, result, provider);
          const alertCreated = await maybeCreateAlert(runId, item);

          totalChecked += 1;
          if (result.result === 'matched') totalMatched += 1;
          else if (result.result === 'duplicate') totalDuplicate += 1;
          else if (result.result === 'missing_external' || result.result === 'missing_internal')
            totalMissing += 1;
          else totalMismatched += 1;
          if (alertCreated) totalAlerts += 1;
        }
      }

      // Finalize
      run.status = 'completed';
      run.completedAt = now();
      run.totalChecked = totalChecked;
      run.totalMatched = totalMatched;
      run.totalMismatched = totalMismatched;
      run.totalMissing = totalMissing;
      run.totalDuplicate = totalDuplicate;
      run.totalAlertsCreated = totalAlerts;

      if (!__DEV__) {
        await setDoc(doc(db, RUNS_COL, runId), run);
      }

      auditLog('reconciliation_run_completed', {
        runId,
        totalChecked,
        totalMatched,
        totalMismatched,
        totalAlerts,
      });

      return {
        runId,
        status: 'completed',
        totalChecked,
        totalMatched,
        totalMismatched,
        totalMissing,
        totalDuplicate,
        totalAlertsCreated: totalAlerts,
        openAlerts: totalAlerts,
        criticalAlerts: 0,
        completedAt: run.completedAt,
      };
    } catch (err: any) {
      run.status = 'failed';
      run.errorMessage = err.message;
      run.completedAt = now();

      if (!__DEV__) {
        await setDoc(doc(db, RUNS_COL, runId), run);
      }

      auditLog('reconciliation_run_failed', { runId, error: err.message });
      throw err;
    }
  },

  /**
   * runProviderReconciliation — reconcile a single provider for a date range.
   */
  async runProviderReconciliation(
    provider: Exclude<ReconciliationProvider, 'all'>,
    dateRange: { start: string; end: string },
    createdBy = 'system',
  ): Promise<ReconciliationSummary> {
    return this.runReconciliation({
      provider,
      mode: 'scheduled',
      dateRangeStart: dateRange.start,
      dateRangeEnd: dateRange.end,
      createdBy,
    });
  },

  /**
   * getRunSummary — returns summary statistics for a reconciliation run.
   */
  async getRunSummary(runId: string): Promise<ReconciliationSummary | null> {
    if (__DEV__) {
      return getMockSummary(runId);
    }
    try {
      const snap = await getDoc(doc(db, RUNS_COL, runId));
      if (!snap.exists()) return null;
      const run = snap.data() as ReconciliationRun;
      const openAlerts = await reconciliationAlertService.getOpenAlerts({ runId });
      const criticalAlerts = openAlerts.filter((a) => a.severity === 'critical').length;
      return {
        runId: run.runId,
        status: run.status,
        totalChecked: run.totalChecked,
        totalMatched: run.totalMatched,
        totalMismatched: run.totalMismatched,
        totalMissing: run.totalMissing,
        totalDuplicate: run.totalDuplicate,
        totalAlertsCreated: run.totalAlertsCreated,
        openAlerts: openAlerts.length,
        criticalAlerts,
        completedAt: run.completedAt,
      };
    } catch (err) {
      console.error('[reconciliationService] getRunSummary failed:', err);
      return null;
    }
  },

  /**
   * listRuns — returns a list of reconciliation runs.
   */
  async listRuns(pageLimit = 20): Promise<ReconciliationRun[]> {
    if (__DEV__) return getMockRuns();
    try {
      const q = query(
        collection(db, RUNS_COL),
        orderBy('startedAt', 'desc'),
        limit(pageLimit),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as ReconciliationRun);
    } catch (err) {
      console.error('[reconciliationService] listRuns failed:', err);
      return [];
    }
  },

  /**
   * listItemsForRun — returns reconciliation items for a given run.
   */
  async listItemsForRun(runId: string): Promise<ReconciliationItem[]> {
    if (__DEV__) return getMockItems(runId);
    try {
      const q = query(
        collection(db, ITEMS_COL),
        where('runId', '==', runId),
        orderBy('createdAt', 'desc'),
        limit(500),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as ReconciliationItem);
    } catch (err) {
      console.error('[reconciliationService] listItemsForRun failed:', err);
      return [];
    }
  },
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function normalizeStatus(status: string): string {
  return (status ?? '').toUpperCase().replace(/[^A-Z_]/g, '');
}

// ─────────────────────────────────────────────
// DEV MOCK DATA
// ─────────────────────────────────────────────

function getMockInternalPayouts(provider: string): InternalPayoutRecord[] {
  return [
    {
      txId: 'TXN_1001_MOCK',
      providerRef: `${provider}_REF_1001`,
      provider,
      amount: 12056.4,
      currency: 'ETB',
      payoutStatus: 'COMPLETED',
      createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      recipientAccount: '+251911222333',
    },
    {
      txId: 'TXN_1002_MOCK',
      providerRef: `${provider}_REF_1002`,
      provider,
      amount: 12000.0,
      currency: 'ETB',
      payoutStatus: 'COMPLETED',
      createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      recipientAccount: '+251922333444',
    },
    {
      txId: 'TXN_1003_MOCK',
      providerRef: `${provider}_REF_1003`,
      provider,
      amount: 8750.0,
      currency: 'ETB',
      payoutStatus: 'COMPLETED',
      createdAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      recipientAccount: '+251933444555',
    },
    {
      txId: 'TXN_NO_EXTERNAL',
      providerRef: '',
      provider,
      amount: 6000.0,
      currency: 'ETB',
      payoutStatus: 'COMPLETED',
      createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      recipientAccount: '+251955666777',
    },
    {
      txId: 'TXN_DUP_MOCK',
      providerRef: `${provider}_REF_DUP_A`,
      provider,
      amount: 9000.0,
      currency: 'ETB',
      payoutStatus: 'COMPLETED',
      createdAt: new Date(Date.now() - 7 * 3600 * 1000).toISOString(),
      recipientAccount: '+251944555666',
    },
  ];
}

function getMockReservations(): ReservationRecord[] {
  return [
    {
      reservationId: 'RES_STALE_001',
      txId: 'TXN_STALE_MOCK',
      status: 'reserved',
      createdAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
      provider: 'CHAPA',
      reservedAmountETB: 14500,
    },
  ];
}

function getMockObligations(): SettlementObligation[] {
  return [
    {
      obligationId: 'OBLIG_001',
      txId: 'TXN_OBLIG_MOCK',
      provider: 'BANK',
      amount: 25000,
      currency: 'ETB',
      status: 'open',
      createdAt: new Date(Date.now() - 50 * 3600 * 1000).toISOString(),
    },
  ];
}

function getMockLedgerEntries(): LedgerRecord[] {
  return [
    {
      entryId: 'LDG_001',
      txId: 'TXN_1001_MOCK',
      type: 'DEBIT',
      category: 'REMITTANCE',
      amount: 200,
      currency: 'EUR',
      status: 'POSTED',
    },
    {
      entryId: 'LDG_002',
      txId: 'TXN_NO_DEBIT_MOCK',
      type: 'DEBIT',
      category: 'REMITTANCE',
      amount: 150,
      currency: 'EUR',
      status: 'POSTED',
    },
  ];
}

function getMockRuns(): ReconciliationRun[] {
  return [
    {
      runId: 'rec_2026_03_08_001',
      startedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      completedAt: new Date(Date.now() - 1.5 * 3600 * 1000).toISOString(),
      status: 'completed',
      mode: 'scheduled',
      provider: 'all',
      totalChecked: 48,
      totalMatched: 39,
      totalMismatched: 5,
      totalMissing: 3,
      totalDuplicate: 1,
      totalAlertsCreated: 6,
      createdBy: 'system',
    },
    {
      runId: 'rec_2026_03_07_001',
      startedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
      completedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      status: 'completed',
      mode: 'scheduled',
      provider: 'all',
      totalChecked: 52,
      totalMatched: 49,
      totalMismatched: 2,
      totalMissing: 1,
      totalDuplicate: 0,
      totalAlertsCreated: 2,
      createdBy: 'system',
    },
    {
      runId: 'rec_2026_03_06_001',
      startedAt: new Date(Date.now() - 50 * 3600 * 1000).toISOString(),
      completedAt: new Date(Date.now() - 49.5 * 3600 * 1000).toISOString(),
      status: 'failed',
      mode: 'manual',
      provider: 'CHAPA',
      totalChecked: 12,
      totalMatched: 0,
      totalMismatched: 0,
      totalMissing: 0,
      totalDuplicate: 0,
      totalAlertsCreated: 0,
      errorMessage: 'Provider API timeout',
      createdBy: 'admin_uid_001',
    },
  ];
}

function getMockSummary(runId: string): ReconciliationSummary {
  return {
    runId,
    status: 'completed',
    totalChecked: 48,
    totalMatched: 39,
    totalMismatched: 5,
    totalMissing: 3,
    totalDuplicate: 1,
    totalAlertsCreated: 6,
    openAlerts: 5,
    criticalAlerts: 2,
    completedAt: new Date(Date.now() - 1.5 * 3600 * 1000).toISOString(),
  };
}

function getMockItems(runId: string): ReconciliationItem[] {
  const types = [
    'matched', 'matched', 'matched', 'amount_mismatch',
    'status_mismatch', 'missing_external', 'duplicate', 'reservation_stale',
  ] as const;
  return types.map((result, i) => ({
    itemId: `rec_item_mock_${i}`,
    runId,
    txId: `TXN_${1000 + i}`,
    provider: ['CHAPA', 'TELEBIRR', 'BANK'][i % 3],
    providerRef: `REF_${1000 + i}`,
    internalAmount: 12000 + i * 100,
    externalAmount: result === 'amount_mismatch' ? 11000 + i * 100 : 12000 + i * 100,
    currency: 'ETB',
    internalStatus: 'COMPLETED',
    externalStatus: result === 'status_mismatch' ? 'PROCESSING' : 'COMPLETED',
    result,
    notes: result !== 'matched' ? `Mock ${result} for testing` : undefined,
    createdAt: new Date(Date.now() - i * 3600 * 1000).toISOString(),
  }));
}

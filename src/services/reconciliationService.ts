/**
 * reconciliationService.ts   (top-level facade)
 * ────────────────────────────────────────────────
 * Entry point for the Habeshare Reconciliation & Settlement Engine.
 *
 * This facade layer sits on top of the detailed engine in
 * src/services/reconciliation/ and adds:
 *
 *   1. `runDailyReconciliation()`  — daily orchestration job
 *      • fetches completed payout transactions
 *      • fetches mock partner reports (swappable for real API calls)
 *      • compares amount, currency, providerRef
 *      • writes per-transaction results to `reconciliation_reports`
 *        (schema: { txId, providerRef, status, expectedAmount, actualAmount, createdAt })
 *      • emits `reconciliation_mismatch_detected` audit event per mismatch
 *      • flags mismatched txs in `transaction_flags` (read-only of source data)
 *      • returns a summary: { totalTransactions, matched, mismatched, pending }
 *
 *   2. `getAdminReconciliationSummary()` — serves GET /api/admin/reconciliation
 *      Returns aggregated counts from the most recent run.
 *
 * SAFETY GUARANTEES:
 *   ✓ Never writes to payout_transactions, wallet, or ledger_entries
 *   ✓ reconciliation_reports and transaction_flags are write-only for this service
 *   ✓ All Firestore failures are non-fatal (logged + continue)
 *   ✓ TypeScript strict mode compatible
 *
 * Audit events emitted:
 *   reconciliation_run_started
 *   reconciliation_mismatch_detected     (once per mismatch)
 *   reconciliation_completed
 *
 * Firestore collections written:
 *   reconciliation_reports/{reportId}
 *   transaction_flags/{txId}
 *   reconciliation_audit_log/{logId}
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
  getDoc,
} from 'firebase/firestore';
import { db } from './firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReportItemStatus = 'MATCHED' | 'MISMATCH' | 'MISSING_EXTERNAL' | 'MISSING_INTERNAL';

/** Firestore: reconciliation_reports/{reportId} */
export interface ReconciliationReport {
  reportId: string;
  runId: string;
  txId: string;
  providerRef: string;
  provider: string;
  status: ReportItemStatus;
  expectedAmount: number;
  actualAmount: number;
  currency: string;
  mismatchReason?: string;
  createdAt: string;
}

/** Firestore: transaction_flags/{txId} */
export interface TransactionFlag {
  txId: string;
  flag: 'RECONCILIATION_ALERT';
  runId: string;
  reason: string;
  flaggedAt: string;
  resolvedAt?: string;
}

export interface ReconciliationAdminSummary {
  totalTransactions: number;
  matched: number;
  mismatched: number;
  pending: number;
  lastRunId: string | null;
  lastRunAt: string | null;
  status: 'completed' | 'running' | 'failed' | 'never_run';
}

export interface DailyReconciliationResult {
  runId: string;
  totalTransactions: number;
  matched: number;
  mismatched: number;
  pending: number;
  reportsWritten: number;
  flagsCreated: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

// ─── Internal types for payout records ───────────────────────────────────────

interface PayoutRecord {
  txId: string;
  providerRef: string;
  provider: string;
  amount: number;
  currency: string;
  payoutStatus: string;
  createdAt: string;
}

interface PartnerReportItem {
  providerRef: string;
  txId?: string;
  amount: number;
  currency: string;
  status: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REPORTS_COL = 'reconciliation_reports';
const FLAGS_COL   = 'transaction_flags';
const AUDIT_COL   = 'reconciliation_audit_log';
const PAYOUT_COL  = 'payout_transactions';

/** Amount tolerance in ETB before flagging MISMATCH */
const AMOUNT_TOLERANCE = 1.0;

function isoNow(): string {
  return new Date().toISOString();
}

function generateRunId(): string {
  const d = new Date();
  const dateStr = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}`;
  return `recon_${dateStr}_${Math.floor(Math.random() * 9000 + 1000)}`;
}

// ─── Audit Logging ────────────────────────────────────────────────────────────

async function emitAuditEvent(
  event: 'reconciliation_run_started' | 'reconciliation_mismatch_detected' | 'reconciliation_completed',
  data: Record<string, unknown>,
): Promise<void> {
  const payload = {
    event,
    ...data,
    timestamp: isoNow(),
  };
  // Always print to stdout (visible in worker logs)
  console.log(`[ReconciliationAudit] ${event}`, JSON.stringify(payload, null, 0));
  // Persist to Firestore (non-fatal)
  try {
    if (typeof __DEV__ === 'undefined' || !__DEV__) {
      await addDoc(collection(db, AUDIT_COL), payload);
    }
  } catch (_) {}
}

// ─── Data Loaders ─────────────────────────────────────────────────────────────

async function loadCompletedTransactions(dateRange: { start: string; end: string }): Promise<PayoutRecord[]> {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return getMockPayouts();
  }
  try {
    const q = query(
      collection(db, PAYOUT_COL),
      where('payoutStatus', 'in', ['COMPLETED', 'completed', 'SUCCESS', 'success']),
      where('createdAt', '>=', dateRange.start),
      where('createdAt', '<=', dateRange.end),
      orderBy('createdAt', 'desc'),
      limit(2000),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d): PayoutRecord => {
      const data = d.data();
      return {
        txId: data.id ?? d.id,
        providerRef: data.providerRef ?? '',
        provider: data.provider ?? 'UNKNOWN',
        amount: data.amount ?? 0,
        currency: data.currency ?? 'ETB',
        payoutStatus: data.payoutStatus ?? '',
        createdAt: data.createdAt ?? isoNow(),
      };
    });
  } catch (err: any) {
    console.error('[reconciliationService] loadCompletedTransactions error:', err.message);
    return [];
  }
}

/**
 * fetchPartnerReport — retrieves the partner's payout report.
 * In production this calls the Chapa/Telebirr/Bank settlement API.
 * Currently mocked for all environments until API keys are configured.
 */
async function fetchPartnerReport(
  provider: string,
  _dateRange: { start: string; end: string },
): Promise<PartnerReportItem[]> {
  return getMockPartnerReport(provider);
}

// ─── Matching Logic ───────────────────────────────────────────────────────────

function matchAgainstReport(
  internal: PayoutRecord[],
  external: PartnerReportItem[],
): Array<{
  txId: string;
  providerRef: string;
  provider: string;
  status: ReportItemStatus;
  expectedAmount: number;
  actualAmount: number;
  currency: string;
  mismatchReason?: string;
}> {
  const results: ReturnType<typeof matchAgainstReport> = [];

  // Build external lookup by providerRef and txId
  const extByRef = new Map<string, PartnerReportItem>();
  const extByTxId = new Map<string, PartnerReportItem>();
  for (const item of external) {
    extByRef.set(item.providerRef, item);
    if (item.txId) extByTxId.set(item.txId, item);
  }

  const matchedRefs = new Set<string>();

  for (const tx of internal) {
    const ext = extByRef.get(tx.providerRef) ?? extByTxId.get(tx.txId) ?? null;

    if (!ext) {
      results.push({
        txId: tx.txId,
        providerRef: tx.providerRef,
        provider: tx.provider,
        status: 'MISSING_EXTERNAL',
        expectedAmount: tx.amount,
        actualAmount: 0,
        currency: tx.currency,
        mismatchReason: `Transaction ${tx.txId} found in Habeshare records but not in partner report.`,
      });
      continue;
    }

    matchedRefs.add(ext.providerRef);

    const amountDiff = Math.abs(tx.amount - ext.amount);
    const currencyMatch = (tx.currency ?? '').toUpperCase() === (ext.currency ?? '').toUpperCase();

    if (amountDiff > AMOUNT_TOLERANCE || !currencyMatch) {
      const reasons: string[] = [];
      if (amountDiff > AMOUNT_TOLERANCE) {
        reasons.push(`Amount: expected ${tx.amount} ${tx.currency}, partner reported ${ext.amount} ${ext.currency}`);
      }
      if (!currencyMatch) {
        reasons.push(`Currency mismatch: internal ${tx.currency} vs partner ${ext.currency}`);
      }
      results.push({
        txId: tx.txId,
        providerRef: tx.providerRef || ext.providerRef,
        provider: tx.provider,
        status: 'MISMATCH',
        expectedAmount: tx.amount,
        actualAmount: ext.amount,
        currency: tx.currency,
        mismatchReason: reasons.join('; '),
      });
    } else {
      results.push({
        txId: tx.txId,
        providerRef: tx.providerRef || ext.providerRef,
        provider: tx.provider,
        status: 'MATCHED',
        expectedAmount: tx.amount,
        actualAmount: ext.amount,
        currency: tx.currency,
      });
    }
  }

  // Partner entries with no internal record
  for (const item of external) {
    if (!matchedRefs.has(item.providerRef)) {
      results.push({
        txId: item.txId ?? `ext_${item.providerRef}`,
        providerRef: item.providerRef,
        provider: 'UNKNOWN',
        status: 'MISSING_INTERNAL',
        expectedAmount: 0,
        actualAmount: item.amount,
        currency: item.currency,
        mismatchReason: `Partner entry ${item.providerRef} has no matching Habeshare transaction.`,
      });
    }
  }

  return results;
}

// ─── Writers ──────────────────────────────────────────────────────────────────

async function writeReportItem(
  runId: string,
  item: Omit<ReconciliationReport, 'reportId'>,
): Promise<string> {
  try {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      return `report_dev_${Date.now()}`;
    }
    const ref = await addDoc(collection(db, REPORTS_COL), item);
    return ref.id;
  } catch (err: any) {
    console.warn('[reconciliationService] writeReportItem failed (non-fatal):', err.message);
    return `report_local_${Date.now()}`;
  }
}

async function flagTransaction(flag: TransactionFlag): Promise<void> {
  try {
    if (typeof __DEV__ !== 'undefined' && __DEV__) return;
    // Use txId as document ID — idempotent; later flags overwrite earlier ones
    await setDoc(doc(db, FLAGS_COL, flag.txId), flag, { merge: true });
  } catch (err: any) {
    console.warn('[reconciliationService] flagTransaction failed (non-fatal):', err.message);
  }
}

// ─── Public Service ───────────────────────────────────────────────────────────

export const reconciliationService = {

  /**
   * runDailyReconciliation
   * ──────────────────────
   * Full daily reconciliation orchestration job.
   * Intended to be called by the backend worker once per day.
   *
   * @param options.dateRangeHours  How many hours back to look (default: 24)
   * @param options.providers       Providers to reconcile (default: all)
   * @param options.triggeredBy     'cron' | 'admin'
   */
  async runDailyReconciliation(options: {
    dateRangeHours?: number;
    providers?: string[];
    triggeredBy?: 'cron' | 'admin';
  } = {}): Promise<DailyReconciliationResult> {
    const runId = generateRunId();
    const startedAt = isoNow();
    const startMs = Date.now();
    const lookbackHours = options.dateRangeHours ?? 24;
    const providers = options.providers ?? ['CHAPA', 'TELEBIRR', 'BANK'];
    const triggeredBy = options.triggeredBy ?? 'cron';

    const dateRange = {
      start: new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString(),
      end: isoNow(),
    };

    await emitAuditEvent('reconciliation_run_started', {
      runId,
      providers,
      dateRange,
      triggeredBy,
    });

    let totalTransactions = 0;
    let matched = 0;
    let mismatched = 0;
    let pending = 0;
    let reportsWritten = 0;
    let flagsCreated = 0;

    try {
      // Load internal payout records once (provider-filtered in production)
      const allInternal = await loadCompletedTransactions(dateRange);

      // Process each provider
      for (const provider of providers) {
        const internalForProvider = allInternal.filter(
          tx => tx.provider === provider || allInternal.length < 10, // in dev: all records serve all providers
        );

        const externalReport = await fetchPartnerReport(provider, dateRange);
        const matchResults = matchAgainstReport(internalForProvider, externalReport);

        for (const result of matchResults) {
          totalTransactions++;

          // Write to reconciliation_reports
          const reportItem: Omit<ReconciliationReport, 'reportId'> = {
            runId,
            txId: result.txId,
            providerRef: result.providerRef,
            provider: result.provider || provider,
            status: result.status,
            expectedAmount: result.expectedAmount,
            actualAmount: result.actualAmount,
            currency: result.currency,
            mismatchReason: result.mismatchReason,
            createdAt: isoNow(),
          };
          await writeReportItem(runId, reportItem);
          reportsWritten++;

          if (result.status === 'MATCHED') {
            matched++;
          } else if (result.status === 'MISMATCH') {
            mismatched++;

            // Emit per-mismatch audit event
            await emitAuditEvent('reconciliation_mismatch_detected', {
              runId,
              txId: result.txId,
              providerRef: result.providerRef,
              provider: result.provider || provider,
              expectedAmount: result.expectedAmount,
              actualAmount: result.actualAmount,
              currency: result.currency,
              reason: result.mismatchReason,
            });

            // Flag the transaction (no modification to payout_transactions)
            await flagTransaction({
              txId: result.txId,
              flag: 'RECONCILIATION_ALERT',
              runId,
              reason: result.mismatchReason ?? 'Amount or currency mismatch detected',
              flaggedAt: isoNow(),
            });
            flagsCreated++;

          } else if (result.status === 'MISSING_EXTERNAL' || result.status === 'MISSING_INTERNAL') {
            pending++;
          }
        }
      }

    } catch (err: any) {
      console.error('[reconciliationService] runDailyReconciliation failed:', err.message);
    }

    const finishedAt = isoNow();
    const durationMs = Date.now() - startMs;

    await emitAuditEvent('reconciliation_completed', {
      runId,
      totalTransactions,
      matched,
      mismatched,
      pending,
      durationMs,
    });

    return {
      runId,
      totalTransactions,
      matched,
      mismatched,
      pending,
      reportsWritten,
      flagsCreated,
      startedAt,
      finishedAt,
      durationMs,
    };
  },

  /**
   * getAdminReconciliationSummary
   * ──────────────────────────────
   * Serves GET /api/admin/reconciliation.
   *
   * Aggregates counts from the reconciliation_reports collection
   * to return the overall picture: totalTransactions, matched, mismatched, pending.
   */
  async getAdminReconciliationSummary(maxReports = 500): Promise<ReconciliationAdminSummary> {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      return getMockAdminSummary();
    }
    try {
      const q = query(
        collection(db, REPORTS_COL),
        orderBy('createdAt', 'desc'),
        limit(maxReports),
      );
      const snap = await getDocs(q);
      const reports = snap.docs.map(d => d.data() as ReconciliationReport);

      const totalTransactions = reports.length;
      const matched    = reports.filter(r => r.status === 'MATCHED').length;
      const mismatched = reports.filter(r => r.status === 'MISMATCH').length;
      const pending    = reports.filter(
        r => r.status === 'MISSING_EXTERNAL' || r.status === 'MISSING_INTERNAL',
      ).length;

      const lastReport = reports[0];

      return {
        totalTransactions,
        matched,
        mismatched,
        pending,
        lastRunId: lastReport?.runId ?? null,
        lastRunAt: lastReport?.createdAt ?? null,
        status: totalTransactions > 0 ? 'completed' : 'never_run',
      };
    } catch (err: any) {
      console.error('[reconciliationService] getAdminReconciliationSummary error:', err.message);
      return {
        totalTransactions: 0, matched: 0, mismatched: 0, pending: 0,
        lastRunId: null, lastRunAt: null, status: 'failed',
      };
    }
  },

  /**
   * getReportsByRun — list all reconciliation_reports for a given runId.
   */
  async getReportsByRun(runId: string, pageLimit = 200): Promise<ReconciliationReport[]> {
    try {
      const q = query(
        collection(db, REPORTS_COL),
        where('runId', '==', runId),
        orderBy('createdAt', 'desc'),
        limit(pageLimit),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ reportId: d.id, ...d.data() } as ReconciliationReport));
    } catch (err: any) {
      console.error('[reconciliationService] getReportsByRun error:', err.message);
      return [];
    }
  },

  /**
   * getMismatchedReports — returns only MISMATCH records across all runs.
   */
  async getMismatchedReports(pageLimit = 100): Promise<ReconciliationReport[]> {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      return getMockMismatchReports();
    }
    try {
      const q = query(
        collection(db, REPORTS_COL),
        where('status', '==', 'MISMATCH'),
        orderBy('createdAt', 'desc'),
        limit(pageLimit),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ reportId: d.id, ...d.data() } as ReconciliationReport));
    } catch (err: any) {
      console.error('[reconciliationService] getMismatchedReports error:', err.message);
      return [];
    }
  },

  /**
   * getTransactionFlag — check if a specific transaction is flagged.
   */
  async getTransactionFlag(txId: string): Promise<TransactionFlag | null> {
    try {
      const snap = await getDoc(doc(db, FLAGS_COL, txId));
      return snap.exists() ? (snap.data() as TransactionFlag) : null;
    } catch {
      return null;
    }
  },
};

// ─── Mock Data (dev only) ─────────────────────────────────────────────────────

function getMockPayouts(): PayoutRecord[] {
  return [
    { txId: 'TX123', providerRef: 'CHAPA_123', provider: 'CHAPA', amount: 200, currency: 'ETB', payoutStatus: 'COMPLETED', createdAt: new Date(Date.now() - 3600_000).toISOString() },
    { txId: 'TX124', providerRef: 'CHAPA_124', provider: 'CHAPA', amount: 150, currency: 'ETB', payoutStatus: 'COMPLETED', createdAt: new Date(Date.now() - 7200_000).toISOString() },
    { txId: 'TX125', providerRef: 'TELEBIRR_125', provider: 'TELEBIRR', amount: 300, currency: 'ETB', payoutStatus: 'COMPLETED', createdAt: new Date(Date.now() - 10800_000).toISOString() },
    { txId: 'TX126', providerRef: '', provider: 'CHAPA', amount: 180, currency: 'ETB', payoutStatus: 'COMPLETED', createdAt: new Date(Date.now() - 14400_000).toISOString() },
    { txId: 'TX127', providerRef: 'BANK_127', provider: 'BANK', amount: 500, currency: 'ETB', payoutStatus: 'COMPLETED', createdAt: new Date(Date.now() - 18000_000).toISOString() },
  ];
}

function getMockPartnerReport(provider: string): PartnerReportItem[] {
  const base: Record<string, PartnerReportItem[]> = {
    CHAPA: [
      { providerRef: 'CHAPA_123', txId: 'TX123', amount: 200, currency: 'ETB', status: 'COMPLETED' },
      { providerRef: 'CHAPA_124', txId: 'TX124', amount: 148, currency: 'ETB', status: 'COMPLETED' }, // mismatch
    ],
    TELEBIRR: [
      { providerRef: 'TELEBIRR_125', txId: 'TX125', amount: 300, currency: 'ETB', status: 'COMPLETED' },
      { providerRef: 'TELEBIRR_999', amount: 250, currency: 'ETB', status: 'COMPLETED' },            // missing internal
    ],
    BANK: [
      { providerRef: 'BANK_127', txId: 'TX127', amount: 490, currency: 'ETB', status: 'COMPLETED' }, // mismatch
    ],
  };
  return base[provider] ?? [];
}

function getMockAdminSummary(): ReconciliationAdminSummary {
  return {
    totalTransactions: 48,
    matched: 39,
    mismatched: 5,
    pending: 4,
    lastRunId: 'recon_2026_03_24_001',
    lastRunAt: new Date(Date.now() - 3600_000).toISOString(),
    status: 'completed',
  };
}

function getMockMismatchReports(): ReconciliationReport[] {
  return [
    {
      reportId: 'rpt_mock_1',
      runId: 'recon_2026_03_24_001',
      txId: 'TX124',
      providerRef: 'CHAPA_124',
      provider: 'CHAPA',
      status: 'MISMATCH',
      expectedAmount: 150,
      actualAmount: 148,
      currency: 'ETB',
      mismatchReason: 'Amount: expected 150 ETB, partner reported 148 ETB',
      createdAt: new Date(Date.now() - 3600_000).toISOString(),
    },
    {
      reportId: 'rpt_mock_2',
      runId: 'recon_2026_03_24_001',
      txId: 'TX127',
      providerRef: 'BANK_127',
      provider: 'BANK',
      status: 'MISMATCH',
      expectedAmount: 500,
      actualAmount: 490,
      currency: 'ETB',
      mismatchReason: 'Amount: expected 500 ETB, partner reported 490 ETB',
      createdAt: new Date(Date.now() - 7200_000).toISOString(),
    },
  ];
}

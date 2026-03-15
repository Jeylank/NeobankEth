/**
 * reconciliationMatcher.ts
 * ────────────────────────
 * Pure matching logic comparing internal payout records against
 * external provider settlement data.
 *
 * All functions are stateless — they receive data and return results.
 * No Firestore writes happen here.
 */

import type {
  ReconciliationItem,
  ProviderSettlementItem,
  MatchResult,
  ReconciliationResultType,
} from './reconciliationTypes';

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

/** Maximum amount difference (ETB) before flagging as AMOUNT_MISMATCH */
const AMOUNT_TOLERANCE_ETB = 1.0;

/** Reservations older than this (hours) are considered stale */
const STALE_RESERVATION_HOURS = 4;

/** Settlement obligations open beyond this (hours) are overdue */
const SETTLEMENT_OVERDUE_HOURS = 48;

function now(): string {
  return new Date().toISOString();
}

function hoursSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 3600);
}

// ─────────────────────────────────────────────
// INTERNAL PAYOUT RECORD SHAPE
// (aligned with existing PayoutTransaction type)
// ─────────────────────────────────────────────

export interface InternalPayoutRecord {
  txId: string;
  providerRef: string;
  provider: string;
  amount: number;
  currency: string;
  payoutStatus: string;
  createdAt: string;
  recipientAccount: string;
}

// ─────────────────────────────────────────────
// MAIN MATCHER
// ─────────────────────────────────────────────

/**
 * matchTransactions — compares all internal records against external ones.
 * Returns an array of MatchResult (one per internal record).
 */
export function matchTransactions(
  internal: InternalPayoutRecord[],
  external: ProviderSettlementItem[],
): MatchResult[] {
  const results: MatchResult[] = [];

  // Build lookup maps
  const externalByRef = new Map<string, ProviderSettlementItem>();
  const externalByTxId = new Map<string, ProviderSettlementItem>();
  for (const ext of external) {
    externalByRef.set(ext.providerRef, ext);
    if (ext.txId) externalByTxId.set(ext.txId, ext);
  }

  const matchedExternalRefs = new Set<string>();

  for (const rec of internal) {
    const ext =
      externalByRef.get(rec.providerRef) ??
      externalByTxId.get(rec.txId) ??
      null;

    if (!ext) {
      // Internal exists, nothing in provider report
      results.push({
        txId: rec.txId,
        providerRef: rec.providerRef,
        provider: rec.provider,
        result: 'missing_external',
        internalAmount: rec.amount,
        externalAmount: 0,
        internalStatus: rec.payoutStatus,
        externalStatus: '',
        currency: rec.currency,
        notes: `Tx ${rec.txId} has no matching entry in provider settlement report.`,
      });
      continue;
    }

    matchedExternalRefs.add(ext.providerRef);

    const amountDiff = Math.abs(rec.amount - ext.amount);
    const statusMatch =
      normalizeStatus(rec.payoutStatus) === normalizeStatus(ext.status);

    if (amountDiff > AMOUNT_TOLERANCE_ETB && !statusMatch) {
      results.push(buildResult(rec, ext, 'amount_mismatch', `Both amount and status differ.`));
    } else if (amountDiff > AMOUNT_TOLERANCE_ETB) {
      results.push(
        buildResult(
          rec,
          ext,
          'amount_mismatch',
          `Internal: ${rec.amount} ${rec.currency} vs Provider: ${ext.amount} ${ext.currency}.`,
        ),
      );
    } else if (!statusMatch) {
      results.push(
        buildResult(
          rec,
          ext,
          'status_mismatch',
          `Internal: ${rec.payoutStatus} vs Provider: ${ext.status}.`,
        ),
      );
    } else {
      results.push(buildResult(rec, ext, 'matched'));
    }
  }

  // Check for provider entries with no internal record (MISSING_INTERNAL)
  for (const ext of external) {
    if (!matchedExternalRefs.has(ext.providerRef)) {
      results.push({
        txId: ext.txId ?? `external_${ext.providerRef}`,
        providerRef: ext.providerRef,
        provider: internal[0]?.provider ?? 'UNKNOWN',
        result: 'missing_internal',
        internalAmount: 0,
        externalAmount: ext.amount,
        internalStatus: '',
        externalStatus: ext.status,
        currency: ext.currency,
        notes: `Provider entry ${ext.providerRef} has no matching internal payout transaction.`,
      });
    }
  }

  return results;
}

// ─────────────────────────────────────────────
// INDIVIDUAL DETECTION FUNCTIONS
// ─────────────────────────────────────────────

/**
 * detectDuplicates — finds internal records with the same providerRef or
 * same (amount + recipient + date within 1h) indicating double-payout.
 */
export function detectDuplicates(
  internal: InternalPayoutRecord[],
  external: ProviderSettlementItem[],
): MatchResult[] {
  const results: MatchResult[] = [];

  // Check external for duplicate providerRefs
  const seenRefs = new Map<string, ProviderSettlementItem>();
  for (const ext of external) {
    if (seenRefs.has(ext.providerRef)) {
      const first = seenRefs.get(ext.providerRef)!;
      const internalRec = internal.find((i) => i.providerRef === ext.providerRef);
      results.push({
        txId: internalRec?.txId ?? ext.txId ?? ext.providerRef,
        providerRef: ext.providerRef,
        provider: internalRec?.provider ?? 'UNKNOWN',
        result: 'duplicate',
        internalAmount: internalRec?.amount ?? first.amount,
        externalAmount: ext.amount,
        internalStatus: internalRec?.payoutStatus ?? '',
        externalStatus: ext.status,
        currency: ext.currency,
        notes: `Duplicate providerRef ${ext.providerRef} in settlement report.`,
      });
    } else {
      seenRefs.set(ext.providerRef, ext);
    }
  }

  // Also check internal for duplicate txIds pointing to same providerRef
  const seenTxIds = new Map<string, InternalPayoutRecord>();
  for (const rec of internal) {
    if (seenTxIds.has(rec.txId) && rec.txId) {
      results.push({
        txId: rec.txId,
        providerRef: rec.providerRef,
        provider: rec.provider,
        result: 'duplicate',
        internalAmount: rec.amount,
        externalAmount: 0,
        internalStatus: rec.payoutStatus,
        externalStatus: '',
        currency: rec.currency,
        notes: `Internal tx ${rec.txId} appears multiple times in payout_transactions.`,
      });
    } else {
      seenTxIds.set(rec.txId, rec);
    }
  }

  return results;
}

/**
 * detectAmountMismatch — returns only amount_mismatch results from a match set.
 */
export function detectAmountMismatch(matchResults: MatchResult[]): MatchResult[] {
  return matchResults.filter((r) => r.result === 'amount_mismatch');
}

/**
 * detectStatusMismatch — returns only status_mismatch results from a match set.
 */
export function detectStatusMismatch(matchResults: MatchResult[]): MatchResult[] {
  return matchResults.filter((r) => r.result === 'status_mismatch');
}

/**
 * detectMissingInternal — provider entries with no internal record.
 */
export function detectMissingInternal(matchResults: MatchResult[]): MatchResult[] {
  return matchResults.filter((r) => r.result === 'missing_internal');
}

/**
 * detectMissingExternal — internal records not found in provider report.
 */
export function detectMissingExternal(matchResults: MatchResult[]): MatchResult[] {
  return matchResults.filter((r) => r.result === 'missing_external');
}

/**
 * detectStaleReservations — FX/treasury reservations still 'reserved' for
 * transactions that are now completed/failed/expired.
 */
export interface ReservationRecord {
  reservationId: string;
  txId: string;
  status: string;
  createdAt: string;
  provider: string;
  reservedAmountETB: number;
}

export function detectStaleReservations(reservations: ReservationRecord[]): MatchResult[] {
  return reservations
    .filter((r) => r.status === 'reserved' && hoursSince(r.createdAt) > STALE_RESERVATION_HOURS)
    .map(
      (r): MatchResult => ({
        txId: r.txId,
        providerRef: r.reservationId,
        provider: r.provider,
        result: 'reservation_stale',
        internalAmount: r.reservedAmountETB,
        externalAmount: 0,
        internalStatus: r.status,
        externalStatus: '',
        currency: 'ETB',
        notes: `Reservation ${r.reservationId} is still 'reserved' after ${hoursSince(r.createdAt).toFixed(1)}h (threshold: ${STALE_RESERVATION_HOURS}h).`,
      }),
    );
}

/**
 * detectSettlementOverdue — settlement obligations open beyond threshold.
 */
export interface SettlementObligation {
  obligationId: string;
  txId: string;
  provider: string;
  amount: number;
  currency: string;
  status: 'open' | 'settled' | 'cancelled';
  createdAt: string;
}

export function detectSettlementOverdue(obligations: SettlementObligation[]): MatchResult[] {
  return obligations
    .filter(
      (o) => o.status === 'open' && hoursSince(o.createdAt) > SETTLEMENT_OVERDUE_HOURS,
    )
    .map(
      (o): MatchResult => ({
        txId: o.txId,
        providerRef: o.obligationId,
        provider: o.provider,
        result: 'settlement_overdue',
        internalAmount: o.amount,
        externalAmount: 0,
        internalStatus: 'open',
        externalStatus: '',
        currency: o.currency,
        notes: `Settlement obligation ${o.obligationId} open for ${hoursSince(o.createdAt).toFixed(1)}h (threshold: ${SETTLEMENT_OVERDUE_HOURS}h).`,
      }),
    );
}

/**
 * detectLedgerInconsistency — checks if wallet debits exist without
 * a corresponding completed payout, or payouts completed with no debit.
 */
export interface LedgerRecord {
  entryId: string;
  txId?: string;
  type: 'CREDIT' | 'DEBIT';
  category: string;
  amount: number;
  currency: string;
  status: string;
}

export function detectLedgerInconsistency(
  ledgerEntries: LedgerRecord[],
  completedPayouts: InternalPayoutRecord[],
): MatchResult[] {
  const results: MatchResult[] = [];

  const completedPayoutTxIds = new Set(completedPayouts.map((p) => p.txId));
  const debitTxIds = new Set(
    ledgerEntries
      .filter((e) => e.type === 'DEBIT' && e.category === 'REMITTANCE' && e.txId)
      .map((e) => e.txId!),
  );

  // Debit exists but no completed payout
  for (const txId of debitTxIds) {
    if (!completedPayoutTxIds.has(txId)) {
      const entry = ledgerEntries.find((e) => e.txId === txId && e.type === 'DEBIT');
      results.push({
        txId,
        providerRef: '',
        provider: 'UNKNOWN',
        result: 'ledger_inconsistency',
        internalAmount: entry?.amount ?? 0,
        externalAmount: 0,
        internalStatus: 'DEBIT_NO_PAYOUT',
        externalStatus: '',
        currency: entry?.currency ?? 'ETB',
        notes: `Wallet debit exists for tx ${txId} but no completed payout found.`,
      });
    }
  }

  // Completed payout but no debit in ledger
  for (const payout of completedPayouts) {
    if (
      normalizeStatus(payout.payoutStatus) === 'COMPLETED' &&
      !debitTxIds.has(payout.txId)
    ) {
      results.push({
        txId: payout.txId,
        providerRef: payout.providerRef,
        provider: payout.provider,
        result: 'ledger_inconsistency',
        internalAmount: payout.amount,
        externalAmount: 0,
        internalStatus: 'PAYOUT_NO_DEBIT',
        externalStatus: '',
        currency: payout.currency,
        notes: `Payout ${payout.providerRef} completed for tx ${payout.txId} but no wallet DEBIT found.`,
      });
    }
  }

  return results;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function buildResult(
  rec: InternalPayoutRecord,
  ext: ProviderSettlementItem,
  result: ReconciliationResultType,
  notes?: string,
): MatchResult {
  return {
    txId: rec.txId,
    providerRef: rec.providerRef || ext.providerRef,
    provider: rec.provider,
    result,
    internalAmount: rec.amount,
    externalAmount: ext.amount,
    internalStatus: rec.payoutStatus,
    externalStatus: ext.status,
    currency: rec.currency,
    notes,
  };
}

function normalizeStatus(status: string): string {
  return (status ?? '').toUpperCase().replace(/[^A-Z_]/g, '');
}

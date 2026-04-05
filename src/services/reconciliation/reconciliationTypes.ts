/**
 * reconciliationTypes.ts
 * ──────────────────────
 * All TypeScript types for the Sumsuma Reconciliation Engine.
 * These mirror the Firestore document schemas exactly.
 */

// ─────────────────────────────────────────────
// ENUMERATIONS
// ─────────────────────────────────────────────

export type ReconciliationRunStatus = 'running' | 'completed' | 'failed';
export type ReconciliationRunMode = 'manual' | 'scheduled';
export type ReconciliationProvider = 'all' | 'CHAPA' | 'TELEBIRR' | 'BANK';

export type ReconciliationResultType =
  | 'matched'
  | 'amount_mismatch'
  | 'status_mismatch'
  | 'missing_external'
  | 'missing_internal'
  | 'duplicate'
  | 'reservation_stale'
  | 'settlement_overdue'
  | 'ledger_inconsistency';

export type ReconciliationAlertType =
  | 'AMOUNT_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'MISSING_EXTERNAL'
  | 'MISSING_INTERNAL'
  | 'DUPLICATE_PAYOUT'
  | 'STALE_RESERVATION'
  | 'SETTLEMENT_OVERDUE'
  | 'LEDGER_INCONSISTENCY';

export type ReconciliationSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ReconciliationAlertStatus =
  | 'open'
  | 'investigating'
  | 'resolved'
  | 'ignored';

export type ProviderReportSourceType = 'api' | 'manual_upload' | 'mock';
export type ProviderReportStatus = 'ready' | 'processing' | 'failed';

// ─────────────────────────────────────────────
// CORE DOCUMENTS
// ─────────────────────────────────────────────

/** Firestore: reconciliation_runs/{runId} */
export interface ReconciliationRun {
  runId: string;
  startedAt: string;
  completedAt?: string;
  status: ReconciliationRunStatus;
  mode: ReconciliationRunMode;
  provider: ReconciliationProvider;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  totalChecked: number;
  totalMatched: number;
  totalMismatched: number;
  totalMissing: number;
  totalDuplicate: number;
  totalAlertsCreated: number;
  errorMessage?: string;
  createdBy: string;
}

/** Firestore: reconciliation_items/{itemId} */
export interface ReconciliationItem {
  itemId: string;
  runId: string;
  txId: string;
  provider: string;
  providerRef: string;
  internalAmount: number;
  externalAmount: number;
  currency: string;
  internalStatus: string;
  externalStatus: string;
  result: ReconciliationResultType;
  notes?: string;
  createdAt: string;
}

/** Firestore: reconciliation_alerts/{alertId} */
export interface ReconciliationAlert {
  alertId: string;
  runId: string;
  txId: string;
  provider: string;
  type: ReconciliationAlertType;
  severity: ReconciliationSeverity;
  status: ReconciliationAlertStatus;
  description: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

/** Firestore: provider_settlement_reports/{reportId} */
export interface ProviderSettlementReport {
  reportId: string;
  provider: ReconciliationProvider;
  date: string;
  importedAt: string;
  itemCount: number;
  sourceType: ProviderReportSourceType;
  status: ProviderReportStatus;
  items: ProviderSettlementItem[];
}

/** A single line item in a provider settlement report */
export interface ProviderSettlementItem {
  providerRef: string;
  txId?: string;
  amount: number;
  currency: string;
  status: string;
  recipientAccount: string;
  settledAt: string;
  raw?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// RECONCILIATION OPTIONS & RESULTS
// ─────────────────────────────────────────────

export interface ReconciliationOptions {
  provider: ReconciliationProvider;
  mode: ReconciliationRunMode;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  createdBy: string;
}

export interface MatchResult {
  txId: string;
  providerRef: string;
  provider: string;
  result: ReconciliationResultType;
  internalAmount: number;
  externalAmount: number;
  internalStatus: string;
  externalStatus: string;
  currency: string;
  notes?: string;
}

export interface ReconciliationSummary {
  runId: string;
  status: ReconciliationRunStatus;
  totalChecked: number;
  totalMatched: number;
  totalMismatched: number;
  totalMissing: number;
  totalDuplicate: number;
  totalAlertsCreated: number;
  openAlerts: number;
  criticalAlerts: number;
  completedAt?: string;
}

// ─────────────────────────────────────────────
// ADMIN API RESPONSE TYPES
// ─────────────────────────────────────────────

export interface ReconciliationRunsResponse {
  runs: ReconciliationRun[];
  total: number;
  page: number;
  limit: number;
}

export interface ReconciliationAlertsResponse {
  alerts: ReconciliationAlert[];
  total: number;
  openCount: number;
  criticalCount: number;
}

export interface AlertFilters {
  type?: ReconciliationAlertType;
  severity?: ReconciliationSeverity;
  status?: ReconciliationAlertStatus;
  provider?: string;
  runId?: string;
}

export interface RunFilters {
  provider?: ReconciliationProvider;
  status?: ReconciliationRunStatus;
  startDate?: string;
  endDate?: string;
}

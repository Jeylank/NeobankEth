/**
 * providerReportService.ts
 * ────────────────────────
 * Fetches, normalizes, and stores provider settlement reports.
 * In production: calls provider APIs.
 * In __DEV__: returns seeded mock data so the engine can be tested.
 */

import {
  doc,
  setDoc,
  getDocs,
  collection,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  ProviderSettlementReport,
  ProviderSettlementItem,
  ReconciliationProvider,
} from './reconciliationTypes';

const REPORTS_COL = 'provider_settlement_reports';

function now(): string {
  return new Date().toISOString();
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────
// NORMALIZE — converts raw provider API data to canonical format
// ─────────────────────────────────────────────

/**
 * normalizeProviderReport — maps raw API / CSV responses to
 * ProviderSettlementItem[] regardless of provider schema.
 */
export function normalizeProviderReport(
  provider: ReconciliationProvider,
  rawData: unknown[],
): ProviderSettlementItem[] {
  return rawData.map((row: any): ProviderSettlementItem => {
    switch (provider) {
      case 'CHAPA':
        return {
          providerRef: row.tx_ref ?? row.id ?? '',
          txId: row.metadata?.txId ?? row.tx_id,
          amount: parseFloat(row.amount ?? 0),
          currency: row.currency ?? 'ETB',
          status: (row.status ?? '').toUpperCase(),
          recipientAccount: row.account_number ?? '',
          settledAt: row.settled_at ?? row.created_at ?? now(),
          raw: row,
        };
      case 'TELEBIRR':
        return {
          providerRef: row.outTradeNo ?? row.ref ?? '',
          txId: row.attachInfo?.txId ?? row.out_trade_no,
          amount: parseFloat(row.totalAmount ?? row.amount ?? 0),
          currency: 'ETB',
          status: (row.tradeStatus ?? row.status ?? '').toUpperCase(),
          recipientAccount: row.msisdn ?? row.phone ?? '',
          settledAt: row.payTime ?? row.pay_time ?? now(),
          raw: row,
        };
      case 'BANK':
        return {
          providerRef: row.reference ?? row.ref ?? '',
          txId: row.narration?.split(':')[1]?.trim() ?? row.txId,
          amount: parseFloat(row.credit_amount ?? row.amount ?? 0),
          currency: row.currency ?? 'ETB',
          status: (row.transaction_status ?? row.status ?? '').toUpperCase(),
          recipientAccount: row.beneficiary_account ?? '',
          settledAt: row.value_date ?? row.settlement_date ?? now(),
          raw: row,
        };
      default:
        return {
          providerRef: row.ref ?? row.id ?? '',
          txId: row.txId,
          amount: parseFloat(row.amount ?? 0),
          currency: row.currency ?? 'ETB',
          status: (row.status ?? '').toUpperCase(),
          recipientAccount: row.account ?? '',
          settledAt: row.date ?? now(),
          raw: row,
        };
    }
  });
}

// ─────────────────────────────────────────────
// FETCH — call provider API or return mock
// ─────────────────────────────────────────────

/**
 * fetchProviderReport — fetches settlement data for a given provider and date range.
 * In production this would call the real provider API.
 * In __DEV__ it returns seeded mock records.
 */
export async function fetchProviderReport(
  provider: ReconciliationProvider,
  dateRange: { start: string; end: string },
): Promise<ProviderSettlementReport> {
  const reportId = `${provider.toLowerCase()}_${dateRange.start}`;

  if (__DEV__) {
    const items = getMockItems(provider);
    const report: ProviderSettlementReport = {
      reportId,
      provider,
      date: dateRange.start,
      importedAt: now(),
      itemCount: items.length,
      sourceType: 'mock',
      status: 'ready',
      items,
    };
    console.log(
      `[providerReportService] DEV mock report for ${provider}: ${items.length} items`,
    );
    return report;
  }

  // Production: fetch from provider API
  // Each provider SDK/connector would be called here.
  // For now: return empty report (real integration left to backend team).
  console.warn(`[providerReportService] Production fetch not implemented for ${provider}`);
  return {
    reportId,
    provider,
    date: dateRange.start,
    importedAt: now(),
    itemCount: 0,
    sourceType: 'api',
    status: 'failed',
    items: [],
  };
}

/**
 * saveProviderReport — persists the report to Firestore.
 * Strips large item arrays before saving (stored in subcollection or in-memory).
 */
export async function saveProviderReport(report: ProviderSettlementReport): Promise<void> {
  if (__DEV__) {
    console.log(`[providerReportService] DEV: skip Firestore save for report ${report.reportId}`);
    return;
  }
  try {
    const { items: _items, ...meta } = report;
    await setDoc(doc(db, REPORTS_COL, report.reportId), meta);
  } catch (err) {
    console.error('[providerReportService] saveProviderReport failed:', err);
  }
}

// ─────────────────────────────────────────────
// MOCK DATA — for development / testing
// ─────────────────────────────────────────────

function getMockItems(provider: ReconciliationProvider): ProviderSettlementItem[] {
  const base: ProviderSettlementItem[] = [
    // MATCHED — all good
    {
      providerRef: `${provider}_REF_1001`,
      txId: 'TXN_1001_MOCK',
      amount: 12056.4,
      currency: 'ETB',
      status: 'COMPLETED',
      recipientAccount: '+251911222333',
      settledAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    },
    // AMOUNT_MISMATCH — provider has different amount
    {
      providerRef: `${provider}_REF_1002`,
      txId: 'TXN_1002_MOCK',
      amount: 11000.0,
      currency: 'ETB',
      status: 'COMPLETED',
      recipientAccount: '+251922333444',
      settledAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    },
    // STATUS_MISMATCH — provider still processing
    {
      providerRef: `${provider}_REF_1003`,
      txId: 'TXN_1003_MOCK',
      amount: 8750.0,
      currency: 'ETB',
      status: 'PROCESSING',
      recipientAccount: '+251933444555',
      settledAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    },
    // MISSING_INTERNAL — exists in provider but not in our DB
    {
      providerRef: `${provider}_REF_ORPHAN_001`,
      txId: undefined,
      amount: 5200.0,
      currency: 'ETB',
      status: 'COMPLETED',
      recipientAccount: '1001234567890',
      settledAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
    },
    // DUPLICATE — same amount/recipient twice
    {
      providerRef: `${provider}_REF_DUP_A`,
      txId: 'TXN_DUP_MOCK',
      amount: 9000.0,
      currency: 'ETB',
      status: 'COMPLETED',
      recipientAccount: '+251944555666',
      settledAt: new Date(Date.now() - 7 * 3600 * 1000).toISOString(),
    },
    {
      providerRef: `${provider}_REF_DUP_B`,
      txId: 'TXN_DUP_MOCK',
      amount: 9000.0,
      currency: 'ETB',
      status: 'COMPLETED',
      recipientAccount: '+251944555666',
      settledAt: new Date(Date.now() - 7.1 * 3600 * 1000).toISOString(),
    },
  ];
  return base;
}

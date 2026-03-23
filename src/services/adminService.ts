import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import type {
  AdminOverview,
  AdminPayout,
  FraudAlert,
  SupportTicket,
  Dispute,
  LiquidityData,
  AdminPayoutFilters,
  AdminAlertFilters,
  AdminTicketFilters,
  AdminDisputeFilters,
  FxMarketplaceStats,
  TransferStats,
  SettlementRecord,
  ReconciliationReport,
} from '../types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.habeshare.com';

const adminApi = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

adminApi.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

adminApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 403) {
      console.error('Admin access denied');
    }
    return Promise.reject(error);
  }
);

export const adminService = {
  async getAdminOverview(): Promise<AdminOverview> {
    const response = await adminApi.get('/api/admin/overview');
    return response.data;
  },

  async getPayouts(filters?: AdminPayoutFilters): Promise<AdminPayout[]> {
    const params: Record<string, string> = {};
    if (filters?.provider) params.provider = filters.provider;
    if (filters?.status) params.status = filters.status;
    if (filters?.startDate) params.startDate = filters.startDate;
    if (filters?.endDate) params.endDate = filters.endDate;
    if (filters?.search) params.search = filters.search;
    const response = await adminApi.get('/api/admin/payouts', { params });
    return response.data;
  },

  async getFraudAlerts(filters?: AdminAlertFilters): Promise<FraudAlert[]> {
    const params: Record<string, string> = {};
    if (filters?.status) params.status = filters.status;
    const response = await adminApi.get('/api/admin/fraud-alerts', { params });
    return response.data;
  },

  async approveFraudAlert(id: string): Promise<void> {
    await adminApi.post(`/api/admin/fraud-alerts/${id}/approve`);
  },

  async blockFraudAlert(id: string): Promise<void> {
    await adminApi.post(`/api/admin/fraud-alerts/${id}/block`);
  },

  async freezeAccount(id: string): Promise<void> {
    await adminApi.post(`/api/admin/fraud-alerts/${id}/freeze`);
  },

  async getSupportTickets(filters?: AdminTicketFilters): Promise<SupportTicket[]> {
    const params: Record<string, string> = {};
    if (filters?.status) params.status = filters.status;
    if (filters?.priority) params.priority = filters.priority;
    const response = await adminApi.get('/api/admin/support-tickets', { params });
    return response.data;
  },

  async updateSupportTicketStatus(id: string, status: string): Promise<void> {
    await adminApi.post(`/api/admin/support-tickets/${id}/status`, { status });
  },

  async getDisputes(filters?: AdminDisputeFilters): Promise<Dispute[]> {
    const params: Record<string, string> = {};
    if (filters?.status) params.status = filters.status;
    const response = await adminApi.get('/api/admin/disputes', { params });
    return response.data;
  },

  async updateDisputeStatus(id: string, status: string): Promise<void> {
    await adminApi.post(`/api/admin/disputes/${id}/status`, { status });
  },

  async refundDispute(id: string): Promise<void> {
    await adminApi.post(`/api/admin/disputes/${id}/refund`);
  },

  async getLiquidity(): Promise<LiquidityData> {
    const response = await adminApi.get('/api/admin/liquidity');
    return response.data;
  },

  async getFxMarketplaceStats(): Promise<FxMarketplaceStats> {
    const response = await adminApi.get('/api/admin/fx-marketplace');
    return response.data;
  },

  async getTransferStats(): Promise<TransferStats> {
    const response = await adminApi.get('/api/admin/transfer-stats');
    return response.data;
  },

  async getReconciliationOverview(): Promise<any> {
    if (__DEV__) {
      const { reconciliationService } = await import('./reconciliation/reconciliationService');
      const runs = await reconciliationService.listRuns(1);
      return { lastRun: runs[0] ?? null };
    }
    const response = await adminApi.get('/api/admin/reconciliation/summary');
    return response.data;
  },

  async getReconciliationRuns(): Promise<any[]> {
    const { reconciliationService } = await import('./reconciliation/reconciliationService');
    return reconciliationService.listRuns(50);
  },

  async getReconciliationAlerts(filters?: Record<string, string>): Promise<any[]> {
    const { reconciliationAlertService } = await import('./reconciliation/reconciliationAlertService');
    return reconciliationAlertService.getAllAlerts(filters as any);
  },

  async getReconciliationRunSummary(runId: string): Promise<any> {
    const { reconciliationService } = await import('./reconciliation/reconciliationService');
    return reconciliationService.getRunSummary(runId);
  },

  async getReconciliationItems(runId: string): Promise<any[]> {
    const { reconciliationService } = await import('./reconciliation/reconciliationService');
    return reconciliationService.listItemsForRun(runId);
  },

  async resolveReconciliationAlert(alertId: string, resolvedBy: string): Promise<void> {
    const { reconciliationAlertService } = await import('./reconciliation/reconciliationAlertService');
    return reconciliationAlertService.resolveAlert(alertId, resolvedBy);
  },

  async ignoreReconciliationAlert(alertId: string, resolvedBy: string): Promise<void> {
    const { reconciliationAlertService } = await import('./reconciliation/reconciliationAlertService');
    return reconciliationAlertService.ignoreAlert(alertId, resolvedBy);
  },

  async getTreasuryOverview(): Promise<any> {
    const { treasuryService } = await import('./treasury/treasuryService');
    return treasuryService.getOverview();
  },

  async getTreasuryPools(): Promise<any[]> {
    const { liquidityService } = await import('./treasury/liquidityService');
    return liquidityService.listAllPools();
  },

  async getTreasuryReservations(filters?: Record<string, any>): Promise<any[]> {
    const { reservationService } = await import('./treasury/reservationService');
    return reservationService.listReservations(filters as any);
  },

  async getTreasurySettlements(filters?: Record<string, any>): Promise<any[]> {
    const { settlementService } = await import('./treasury/settlementService');
    return settlementService.listObligations(filters as any);
  },

  async getTreasuryAlerts(filters?: Record<string, any>): Promise<any[]> {
    const { treasuryAlertsService } = await import('./treasury/treasuryAlertsService');
    return treasuryAlertsService.getAllAlerts(filters as any);
  },

  async releaseTreasuryReservation(reservationId: string, releasedBy: string): Promise<any> {
    const { reservationService } = await import('./treasury/reservationService');
    return reservationService.releaseReservation(reservationId, `admin_release_${releasedBy}`);
  },

  async closeTreasuryObligation(obligationId: string, settledAmount?: number, closedBy?: string): Promise<void> {
    const { settlementService } = await import('./treasury/settlementService');
    return settlementService.closeObligation(obligationId, settledAmount, closedBy);
  },

  async acknowledgeTreasuryAlert(alertId: string, acknowledgedBy: string): Promise<void> {
    const { treasuryAlertsService } = await import('./treasury/treasuryAlertsService');
    return treasuryAlertsService.acknowledgeAlert(alertId, acknowledgedBy);
  },

  async resolveTreasuryAlert(alertId: string, resolvedBy: string): Promise<void> {
    const { treasuryAlertsService } = await import('./treasury/treasuryAlertsService');
    return treasuryAlertsService.resolveAlert(alertId, resolvedBy);
  },

  async suppressTreasuryAlert(alertId: string, suppressedBy: string): Promise<void> {
    const { treasuryAlertsService } = await import('./treasury/treasuryAlertsService');
    return treasuryAlertsService.suppressAlert(alertId, suppressedBy);
  },

  // ─── Settlement + Reconciliation Engine ──────────────────────────────────

  /**
   * getPartnerSettlements — equivalent to GET /api/admin/settlements.
   *
   * Returns the current net balance for every payout provider.
   * Data lives in partner_settlements Firestore collection.
   */
  async getPartnerSettlements(): Promise<SettlementRecord[]> {
    const { partnerSettlementService } = await import('./partnerSettlementService');
    return partnerSettlementService.listAllPartnerBalances();
  },

  /**
   * getPartnerBalance — returns balance records for a single provider.
   */
  async getPartnerBalance(provider: string): Promise<SettlementRecord[]> {
    const { partnerSettlementService } = await import('./partnerSettlementService');
    return partnerSettlementService.getPartnerBalance(provider);
  },

  /**
   * getReconciliationReports — equivalent to GET /api/admin/reconciliation.
   *
   * Returns daily reconciliation reports (newest first).
   * Data lives in reconciliation_reports Firestore collection.
   */
  async getReconciliationReports(limitCount = 30): Promise<ReconciliationReport[]> {
    const { partnerSettlementService } = await import('./partnerSettlementService');
    return partnerSettlementService.listReconciliationReports(limitCount);
  },
};

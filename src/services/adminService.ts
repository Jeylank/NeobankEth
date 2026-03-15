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
};

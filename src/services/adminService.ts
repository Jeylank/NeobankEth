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

  // ─── Settlement Engine ───────────────────────────────────────────────────

  async getSettlementOverview() {
    const { settlementService } = await import('./settlement/settlementService');
    return settlementService.getOverview();
  },

  async getSettlementObligations(filters?: import('./settlement/settlementTypes').ObligationFilters) {
    const { settlementService } = await import('./settlement/settlementService');
    return settlementService.listObligations(filters);
  },

  async getSettlementBatches(filters?: import('./settlement/settlementTypes').BatchFilters) {
    const { settlementBatchService } = await import('./settlement/settlementBatchService');
    return settlementBatchService.listBatches(filters);
  },

  async getSettlementAlerts(filters?: import('./settlement/settlementTypes').AlertFilters) {
    const { settlementAlertsService } = await import('./settlement/settlementAlertsService');
    return settlementAlertsService.listAlerts(filters);
  },

  async getSettlementReconciliation(filters?: import('./settlement/settlementTypes').ReconciliationFilters) {
    const { settlementReconciliationService } = await import('./settlement/settlementReconciliationService');
    return settlementReconciliationService.listReports(filters);
  },

  async processSettlementBatch(batchId: string): Promise<void> {
    const { settlementBatchService } = await import('./settlement/settlementBatchService');
    await settlementBatchService.processBatch(batchId, 'admin');
    const { settlementAuditService } = await import('./settlement/settlementAuditService');
    await settlementAuditService.log({ action: 'process_batch', targetId: batchId, targetType: 'batch', performedBy: 'admin' });
  },

  async settleSettlementBatch(batchId: string): Promise<void> {
    const { settlementBatchService } = await import('./settlement/settlementBatchService');
    await settlementBatchService.settleBatch(batchId, 'admin');
    const { settlementAuditService } = await import('./settlement/settlementAuditService');
    await settlementAuditService.log({ action: 'settle_batch', targetId: batchId, targetType: 'batch', performedBy: 'admin' });
  },

  async failSettlementBatch(batchId: string): Promise<void> {
    const { settlementBatchService } = await import('./settlement/settlementBatchService');
    await settlementBatchService.failBatch(batchId, 'Manually failed by admin', 'admin');
    const { settlementAuditService } = await import('./settlement/settlementAuditService');
    await settlementAuditService.log({ action: 'fail_batch', targetId: batchId, targetType: 'batch', performedBy: 'admin', metadata: { reason: 'Manually failed by admin' } });
  },

  async resolveSettlementAlert(alertId: string): Promise<void> {
    const { settlementAlertsService } = await import('./settlement/settlementAlertsService');
    await settlementAlertsService.resolveAlert(alertId, 'admin');
    const { settlementAuditService } = await import('./settlement/settlementAuditService');
    await settlementAuditService.log({ action: 'resolve_alert', targetId: alertId, targetType: 'alert', performedBy: 'admin' });
  },

  // ─── Settlement Scheduler ────────────────────────────────────────────────

  async runSettlementScheduler(triggeredBy: 'admin' | 'auto' = 'admin') {
    const { settlementSchedulerService } = await import('./settlement/settlementSchedulerService');
    const result = await settlementSchedulerService.runFullSchedule(triggeredBy);
    const { settlementAuditService } = await import('./settlement/settlementAuditService');
    await settlementAuditService.log({
      action: 'run_scheduler',
      targetId: result.runId,
      targetType: 'scheduler',
      performedBy: triggeredBy,
      metadata: {
        durationMs: result.durationMs,
        batchesCreated: result.batchingResult.filter((b) => b.batchId !== null).length,
        overdueDetected: result.overdueResult.detected,
        errors: result.errors.length,
      },
    });
    return result;
  },

  async getSchedulerStatus() {
    const { settlementSchedulerService } = await import('./settlement/settlementSchedulerService');
    return settlementSchedulerService.getSchedulerStatus();
  },

  async shouldAutoRunScheduler() {
    const { settlementSchedulerService } = await import('./settlement/settlementSchedulerService');
    return settlementSchedulerService.shouldAutoRun();
  },

  // ─── System Health & Monitoring ──────────────────────────────────────────

  // ─── Recurring Support Scheduler ─────────────────────────────────────────

  /** getSchedulerRuns — list recent RECURRING_SUPPORT cron runs */
  async getSchedulerRuns() {
    const { scheduledSupportExecutionService } = await import('./recurringSupport/scheduledSupportExecutionService');
    return scheduledSupportExecutionService.getSchedulerRuns(50);
  },

  /** getSchedulerRunDetails — list all executions for a specific runId */
  async getSchedulerRunDetails(runId: string) {
    const { scheduledSupportExecutionService } = await import('./recurringSupport/scheduledSupportExecutionService');
    return scheduledSupportExecutionService.getSchedulerRunDetails(runId);
  },

  /** getSystemHealth — DB status, uptime, env validation for /api/health */
  async getSystemHealth() {
    const { systemHealthService } = await import('./systemHealthService');
    return systemHealthService.getHealthStatus();
  },

  /** getSystemSummary — aggregate error/job/fraud/webhook counts for admin monitor */
  async getSystemSummary() {
    const { systemHealthService } = await import('./systemHealthService');
    return systemHealthService.getSystemSummary();
  },

  /** getSettlementDashboardSummary — aggregate stats specifically for the overview widgets */
  async getSettlementDashboardSummary() {
    const { settlementService } = await import('./settlement/settlementService');
    const { settlementAlertsService } = await import('./settlement/settlementAlertsService');
    const { settlementReconciliationService } = await import('./settlement/settlementReconciliationService');

    const [overview, alerts, reports] = await Promise.all([
      settlementService.getOverview(),
      settlementAlertsService.listAlerts({ status: 'OPEN' }, 100),
      settlementReconciliationService.listReports(undefined, 20),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const todayReports = reports.filter((r) => r.date === today || r.createdAt.startsWith(today));
    const matchedToday   = todayReports.filter((r) => r.status === 'MATCHED').length;
    const mismatchedToday = todayReports.filter((r) => r.status === 'MISMATCH').length;

    return {
      ...overview,
      unresolvedAlerts: alerts.length,
      matchedToday,
      mismatchedToday,
      totalReconToday: todayReports.length,
    };
  },
};

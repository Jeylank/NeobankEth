/**
 * treasuryService.ts
 * ───────────────────
 * Main orchestration layer for the Habeshare Treasury Engine.
 *
 * Coordinates:
 *  - liquidityService (pool reads and balance mutations)
 *  - reservationService (full reservation lifecycle)
 *  - settlementService (obligation management)
 *  - treasuryAlertsService (alert creation and queries)
 *
 * Exposes a unified API consumed by admin screens and background workers.
 *
 * The treasury engine is READ-SAFE for the existing payout, FX marketplace,
 * and reconciliation flows — it does not modify payout_transactions or
 * fx_reservations. Instead, it tracks treasury-level positions separately.
 */

import { liquidityService } from './liquidityService';
import { reservationService } from './reservationService';
import { settlementService } from './settlementService';
import { treasuryAlertsService } from './treasuryAlertsService';
import type {
  TreasuryOverview,
  TreasuryProvider,
  TreasuryCurrency,
  LiquidityPool,
  TreasuryReservation,
  SettlementObligation,
  TreasuryAlert,
  ReserveResult,
  ReleaseResult,
  ConfirmResult,
} from './treasuryTypes';

// ─────────────────────────────────────────────
// UNIFIED TREASURY SERVICE
// ─────────────────────────────────────────────

export const treasuryService = {
  // ─────────────────────────
  // OVERVIEW
  // ─────────────────────────

  /**
   * getOverview — returns a high-level treasury health snapshot for the admin dashboard.
   */
  async getOverview(): Promise<TreasuryOverview> {
    const [pools, openAlerts, obligations, pendingReservations] = await Promise.all([
      liquidityService.listAllPools(),
      treasuryAlertsService.getOpenAlerts(),
      settlementService.listObligations(),
      reservationService.listReservations({ status: 'pending' }),
    ]);

    const criticalAlerts = openAlerts.filter(
      (a) => a.severity === 'critical',
    ).length;

    const now = new Date();
    const overdueObligations = obligations.filter(
      (o) =>
        (o.status === 'open' || o.status === 'partially_settled') &&
        new Date(o.dueDate) < now,
    ).length;

    const openObligations = obligations.filter(
      (o) => o.status === 'open' || o.status === 'partially_settled',
    ).length;

    const stuckReservations = openAlerts.filter(
      (a) => a.type === 'STUCK_RESERVATION',
    ).length;

    const totalAvailableByProvider: Record<string, number> = {};
    const totalReservedByProvider: Record<string, number> = {};
    for (const pool of pools) {
      totalAvailableByProvider[pool.provider] =
        (totalAvailableByProvider[pool.provider] ?? 0) + pool.availableBalance;
      totalReservedByProvider[pool.provider] =
        (totalReservedByProvider[pool.provider] ?? 0) + pool.reservedBalance;
    }

    return {
      totalPools: pools.length,
      totalAvailableByProvider,
      totalReservedByProvider,
      openObligations,
      overdueObligations,
      openAlerts: openAlerts.length,
      criticalAlerts,
      pendingReservations: pendingReservations.length,
      stuckReservations,
      lastUpdatedAt: new Date().toISOString(),
    };
  },

  // ─────────────────────────
  // LIQUIDITY POOLS
  // ─────────────────────────

  async listPools(): Promise<LiquidityPool[]> {
    return liquidityService.listAllPools();
  },

  async getPool(
    provider: TreasuryProvider,
    currency: TreasuryCurrency,
  ): Promise<LiquidityPool | null> {
    return liquidityService.getPool(provider, currency);
  },

  async checkLiquidity(
    provider: TreasuryProvider,
    currency: TreasuryCurrency,
    amount: number,
  ): Promise<boolean> {
    return liquidityService.checkAvailableLiquidity(provider, currency, amount);
  },

  // ─────────────────────────
  // RESERVATIONS
  // ─────────────────────────

  async createReservation(
    txId: string,
    provider: TreasuryProvider,
    currency: TreasuryCurrency,
    amount: number,
    createdBy?: string,
  ): Promise<ReserveResult> {
    return reservationService.createReservation(txId, provider, currency, amount, createdBy);
  },

  async confirmReservation(
    reservationId: string,
    confirmedBy?: string,
  ): Promise<ConfirmResult> {
    return reservationService.confirmReservation(reservationId, confirmedBy);
  },

  async releaseReservation(
    reservationId: string,
    reason?: string,
  ): Promise<ReleaseResult> {
    return reservationService.releaseReservation(reservationId, reason);
  },

  async listReservations(filters?: { status?: string; provider?: TreasuryProvider }): Promise<TreasuryReservation[]> {
    return reservationService.listReservations(filters as any);
  },

  // ─────────────────────────
  // SETTLEMENT OBLIGATIONS
  // ─────────────────────────

  async openObligation(
    txId: string,
    provider: TreasuryProvider,
    currency: TreasuryCurrency,
    amount: number,
    reservationId?: string,
  ): Promise<SettlementObligation> {
    return settlementService.openObligation(txId, provider, currency, amount, reservationId);
  },

  async closeObligation(
    obligationId: string,
    settledAmount?: number,
    closedBy?: string,
  ): Promise<void> {
    return settlementService.closeObligation(obligationId, settledAmount, closedBy);
  },

  async listObligations(filters?: { status?: string; provider?: TreasuryProvider }): Promise<SettlementObligation[]> {
    return settlementService.listObligations(filters as any);
  },

  // ─────────────────────────
  // ALERTS
  // ─────────────────────────

  async listAlerts(filters?: { status?: string; type?: string }): Promise<TreasuryAlert[]> {
    return treasuryAlertsService.getAllAlerts(filters as any);
  },

  async resolveAlert(alertId: string, resolvedBy: string): Promise<void> {
    return treasuryAlertsService.resolveAlert(alertId, resolvedBy);
  },

  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void> {
    return treasuryAlertsService.acknowledgeAlert(alertId, acknowledgedBy);
  },

  // ─────────────────────────
  // HEALTH CHECK
  // ─────────────────────────

  /**
   * runHealthCheck — checks all pools against watermarks and creates alerts.
   * Called by scheduled workers.
   */
  async runHealthCheck(): Promise<void> {
    const pools = await liquidityService.listAllPools();
    for (const pool of pools) {
      await treasuryAlertsService.checkAndAlertLowLiquidity(pool);
    }
    await settlementService.detectOverdueObligations();
    await reservationService.expireStaleReservations();
    console.log('[treasuryService] Health check completed');
  },
};

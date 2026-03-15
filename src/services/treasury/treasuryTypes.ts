/**
 * treasuryTypes.ts
 * ─────────────────
 * All TypeScript types for the Habeshare Treasury Engine.
 *
 * The Treasury Engine is a READ-MOSTLY, AUDIT-FIRST system.
 * It tracks liquidity, reservations, settlement obligations, and
 * movements for every payout executed through Habeshare partners.
 *
 * Habeshare is NON-CUSTODIAL — it never holds user funds.
 * This engine tracks treasury positions at licensed financial partners only.
 */

// ─────────────────────────────────────────────
// ENUMERATIONS
// ─────────────────────────────────────────────

export type TreasuryProvider = 'CHAPA' | 'TELEBIRR' | 'BANK_DASHEN' | 'BANK_AWASH' | 'BANK_CBE' | 'BANK_ABYSSINIA';
export type TreasuryCurrency = 'ETB' | 'USD' | 'EUR' | 'GBP';

export type LiquidityPoolStatus = 'active' | 'low' | 'critical' | 'suspended';

export type ReservationStatus = 'pending' | 'confirmed' | 'released' | 'expired' | 'failed';

export type SettlementObligationStatus = 'open' | 'partially_settled' | 'settled' | 'disputed' | 'overdue';

export type TreasuryMovementType =
  | 'RESERVE'
  | 'RELEASE'
  | 'CONFIRM'
  | 'POOL_CREDIT'
  | 'POOL_DEBIT'
  | 'SETTLEMENT_OPEN'
  | 'SETTLEMENT_CLOSE';

export type TreasuryAlertType =
  | 'LOW_LIQUIDITY'
  | 'CRITICAL_LIQUIDITY'
  | 'NEGATIVE_EXPOSURE'
  | 'OVERDUE_SETTLEMENT'
  | 'STUCK_RESERVATION'
  | 'POOL_SUSPENDED'
  | 'SETTLEMENT_DISPUTED';

export type TreasuryAlertSeverity = 'info' | 'medium' | 'high' | 'critical';
export type TreasuryAlertStatus = 'open' | 'acknowledged' | 'resolved' | 'suppressed';

// ─────────────────────────────────────────────
// LIQUIDITY POOL
// Firestore: liquidity_pools/{poolId}
// poolId format: {provider}_{currency}  e.g. CHAPA_ETB
// ─────────────────────────────────────────────

export interface LiquidityPool {
  poolId: string;
  provider: TreasuryProvider;
  currency: TreasuryCurrency;
  availableBalance: number;
  reservedBalance: number;
  totalBalance: number;
  lowWatermarkAmount: number;
  criticalWatermarkAmount: number;
  status: LiquidityPoolStatus;
  lastUpdatedAt: string;
  createdAt: string;
}

// ─────────────────────────────────────────────
// TREASURY RESERVATION
// Firestore: liquidity_reservations/{reservationId}
// ─────────────────────────────────────────────

export interface TreasuryReservation {
  reservationId: string;
  txId: string;
  provider: TreasuryProvider;
  currency: TreasuryCurrency;
  amount: number;
  status: ReservationStatus;
  poolId: string;
  createdAt: string;
  expiresAt: string;
  confirmedAt?: string;
  releasedAt?: string;
  expiredAt?: string;
  confirmedBy?: string;
  releasedReason?: string;
}

// ─────────────────────────────────────────────
// SETTLEMENT OBLIGATION
// Firestore: settlement_obligations/{obligationId}
// ─────────────────────────────────────────────

export interface SettlementObligation {
  obligationId: string;
  txId: string;
  provider: TreasuryProvider;
  currency: TreasuryCurrency;
  amount: number;
  status: SettlementObligationStatus;
  dueDate: string;
  openedAt: string;
  settledAt?: string;
  settledAmount?: number;
  notes?: string;
}

// ─────────────────────────────────────────────
// TREASURY MOVEMENT (immutable ledger)
// Firestore: treasury_movements/{movementId}
// ─────────────────────────────────────────────

export interface TreasuryMovement {
  movementId: string;
  type: TreasuryMovementType;
  poolId: string;
  provider: TreasuryProvider;
  currency: TreasuryCurrency;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  txId?: string;
  reservationId?: string;
  obligationId?: string;
  description: string;
  createdAt: string;
  createdBy: string;
}

// ─────────────────────────────────────────────
// TREASURY ALERT
// Firestore: treasury_alerts/{alertId}
// ─────────────────────────────────────────────

export interface TreasuryAlert {
  alertId: string;
  type: TreasuryAlertType;
  severity: TreasuryAlertSeverity;
  status: TreasuryAlertStatus;
  provider: TreasuryProvider;
  currency?: TreasuryCurrency;
  poolId?: string;
  description: string;
  createdAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// ADMIN API RESPONSE TYPES
// ─────────────────────────────────────────────

export interface TreasuryOverview {
  totalPools: number;
  totalAvailableByProvider: Record<string, number>;
  totalReservedByProvider: Record<string, number>;
  openObligations: number;
  overdueObligations: number;
  openAlerts: number;
  criticalAlerts: number;
  pendingReservations: number;
  stuckReservations: number;
  lastUpdatedAt: string;
}

export interface PoolSummary {
  poolId: string;
  provider: TreasuryProvider;
  currency: TreasuryCurrency;
  availableBalance: number;
  reservedBalance: number;
  totalBalance: number;
  status: LiquidityPoolStatus;
  utilizationRate: number;
}

export interface ReservationFilters {
  status?: ReservationStatus;
  provider?: TreasuryProvider;
  currency?: TreasuryCurrency;
}

export interface SettlementFilters {
  status?: SettlementObligationStatus;
  provider?: TreasuryProvider;
  overdue?: boolean;
}

export interface AlertFilters {
  type?: TreasuryAlertType;
  severity?: TreasuryAlertSeverity;
  status?: TreasuryAlertStatus;
  provider?: TreasuryProvider;
}

// ─────────────────────────────────────────────
// OPERATION RESULTS
// ─────────────────────────────────────────────

export interface ReserveResult {
  success: boolean;
  reservation?: TreasuryReservation;
  error?: string;
}

export interface ReleaseResult {
  success: boolean;
  reservationId: string;
  amountReleased: number;
  error?: string;
}

export interface ConfirmResult {
  success: boolean;
  reservationId: string;
  obligationId?: string;
  error?: string;
}

// Custom error classes
export class InsufficientLiquidityError extends Error {
  constructor(
    public provider: string,
    public currency: string,
    public available: number,
    public requested: number,
  ) {
    super(
      `Insufficient liquidity at ${provider} for ${currency}: available=${available}, requested=${requested}`,
    );
    this.name = 'InsufficientLiquidityError';
  }
}

export class ReservationNotFoundError extends Error {
  constructor(public reservationId: string) {
    super(`Reservation ${reservationId} not found`);
    this.name = 'ReservationNotFoundError';
  }
}

export class ReservationStateError extends Error {
  constructor(
    public reservationId: string,
    public currentStatus: string,
    public expectedStatus: string,
  ) {
    super(
      `Reservation ${reservationId} is in state '${currentStatus}', expected '${expectedStatus}'`,
    );
    this.name = 'ReservationStateError';
  }
}

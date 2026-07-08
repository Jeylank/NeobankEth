export interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  phone?: string;
  preferredCurrency: string;
  language: string;
  role: string;
}

export interface Transaction {
  id: number | string;
  userId: number | string;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'remittance' | 'payment';
  amount: string;
  currency: string;
  description: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  recipientName?: string;
  recipientCountry?: string;
  provider?: PayoutProvider;
  providerRef?: string;
  payoutStatus?: PayoutStatus;
  retryCount?: number;
  lastRetryAt?: string;
  createdAt: string;
}

export type PayoutProvider = 'CHAPA' | 'TELEBIRR' | 'BANK';
export type PayoutStatus = 'INITIATED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'RETRYING';

export interface PayoutTransaction {
  id: string;
  userId: string;
  provider: PayoutProvider;
  providerRef: string;
  payoutStatus: PayoutStatus;
  amount: number;
  currency: string;
  recipientAccount: string;
  recipientName: string;
  payoutMethod: 'bank_transfer' | 'mobile_wallet' | 'cash_pickup';
  bankCode?: string;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface AccountValidationResult {
  valid: boolean;
  accountName?: string;
  accountNumber?: string;
  bankName?: string;
  error?: string;
}

export interface SavingsGoal {
  id: number;
  userId: number;
  name: string;
  targetAmount: string;
  currentAmount: string;
  currency: string;
  deadline?: string;
  status: 'active' | 'completed' | 'cancelled';
}

export interface Beneficiary {
  id: number;
  userId: number;
  name: string;
  bankName: string;
  accountNumber: string;
  country: string;
  currency: string;
}

export interface ExchangeRate {
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  updatedAt: string;
}

export interface BalanceResponse {
  balance: number;
}

export interface ApiError {
  message: string;
  status?: number;
}

export interface FamilyMember {
  id: string;
  userId: string;
  name: string;
  relationship: 'mother' | 'father' | 'brother' | 'sister' | 'spouse' | 'other';
  phone: string;
  payoutMethod: 'telebirr' | 'direct_transfer' | 'cash_pickup';
  monthlyAmount: number;
  currency: 'EUR' | 'USD' | 'GBP';
  status: 'active' | 'paused';
  nextPayoutDate: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyWallet {
  id: string;
  userId: string;
  members: FamilyMember[];
  totalMonthlyBudget: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyAllocation {
  memberId: string;
  memberName: string;
  amount: number;
  currency: string;
  status: 'planned' | 'sent' | 'failed';
  sentAt?: string;
}

export type RequestPurpose = 'school_fees' | 'electricity' | 'medical' | 'family_support' | 'other';

export type RequestStatus = 'pending' | 'approved' | 'processing' | 'completed' | 'failed' | 'declined';

export interface MoneyRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  receiverId: string;
  amount: number;
  currency: string;
  purpose: RequestPurpose;
  message?: string;
  status: RequestStatus;
  transactionId?: string;
  approvedAt?: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semester';
export type ScheduleStatus = 'active' | 'paused' | 'cancelled';

export interface RecurringSchedule {
  id: string;
  userId: string;
  memberId: string;
  memberName: string;
  relationship: string;
  amount: number;
  currency: 'EUR' | 'USD' | 'GBP';
  frequency: ScheduleFrequency;
  payoutMethod: 'telebirr' | 'direct_transfer' | 'cash_pickup';
  nextPayoutDate: string;
  lastPayoutDate?: string;
  lastPayoutStatus?: 'sent' | 'failed';
  totalSent: number;
  totalPayouts: number;
  status: ScheduleStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleExecution {
  id: string;
  scheduleId: string;
  memberId: string;
  memberName: string;
  amount: number;
  currency: string;
  status: 'queued' | 'processing' | 'sent' | 'failed';
  transactionId?: string;
  error?: string;
  executedAt: string;
}

export interface CircleMember {
  id: string;
  name: string;
  location: string;
  amount: number;
  currency: 'EUR' | 'USD' | 'GBP';
  status: 'active' | 'invited' | 'left';
  joinedAt: string;
}

export interface CircleBeneficiary {
  name: string;
  relationship: string;
  payoutMethod: 'telebirr' | 'direct_transfer' | 'cash_pickup';
  phone: string;
}

export interface FamilyCircle {
  id: string;
  userId: string;
  name: string;
  members: CircleMember[];
  beneficiary: CircleBeneficiary;
  totalTarget: number;
  currency: string;
  totalContributed: number;
  frequency: 'monthly' | 'quarterly';
  status: 'active' | 'paused' | 'completed';
  nextPayoutDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface CircleContribution {
  id: string;
  circleId: string;
  memberId: string;
  memberName: string;
  amount: number;
  currency: string;
  status: 'pledged' | 'sent' | 'failed';
  period: string;
  createdAt: string;
}

export type CampaignCategory = 'medical' | 'funeral' | 'education' | 'emergency';
export type CampaignStatus = 'active' | 'completed' | 'cancelled';

export interface SupportCampaign {
  id: string;
  creatorId: string;
  title: string;
  description: string;
  category: CampaignCategory;
  beneficiary: string;
  goalAmount: number;
  raisedAmount: number;
  currency: string;
  contributorCount: number;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignContribution {
  id: string;
  campaignId: string;
  userId: string;
  userName: string;
  amount: number;
  currency: string;
  status: 'pending' | 'sent' | 'failed';
  transactionId?: string;
  createdAt: string;
}

export type WalletCurrency = 'EUR' | 'USD' | 'GBP';
export type LedgerEntryType = 'CREDIT' | 'DEBIT';
export type LedgerCategory = 'TOPUP' | 'REMITTANCE' | 'BILL_PAYMENT' | 'CAMPAIGN' | 'FAMILY_TRANSFER' | 'CONVERSION';
export type LedgerStatus = 'POSTED' | 'RESERVED' | 'CANCELLED';

export interface Wallet {
  userId: string;
  balances: Record<WalletCurrency, number>;
  reservations: Record<WalletCurrency, number>;
  defaultCurrency: WalletCurrency;
  updatedAt: string;
}

export interface LedgerEntry {
  entryId: string;
  type: LedgerEntryType;
  category: LedgerCategory;
  currency: WalletCurrency;
  amount: number;
  status: LedgerStatus;
  provider?: string;
  providerRef?: string;
  txId?: string;
  description?: string;
  createdAt: string;
}

export interface FxConversion {
  id: string;
  userId: string;
  fromCurrency: WalletCurrency;
  toCurrency: WalletCurrency;
  fromAmount: number;
  toAmount: number;
  rate: number;
  fee: number;
  createdAt: string;
}

export interface AdminOverview {
  totalTransactionsToday: number;
  completedPayoutsToday: number;
  failedPayoutsToday: number;
  pendingPayouts: number;
  openFraudAlerts: number;
  openSupportTickets: number;
  openDisputes: number;
  availableLiquidity: number;
  payoutsOverTime: { date: string; count: number }[];
  fraudByDay: { date: string; count: number }[];
  ticketsByStatus: { status: string; count: number }[];
}

export type FraudAlertStatus = 'review_required' | 'approved' | 'blocked' | 'frozen';

export interface AdminPayout {
  txId: string;
  userId: string;
  provider: string;
  providerRef: string;
  amount: number;
  currency: string;
  payoutStatus: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FraudAlert {
  alertId: string;
  txId: string;
  userId: string;
  riskScore: number;
  reason: string;
  status: FraudAlertStatus;
  createdAt: string;
}

export type TicketStatus = 'open' | 'in_review' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface SupportTicket {
  ticketId: string;
  userId: string;
  txId?: string;
  issueType: string;
  message: string;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: string;
}

export type DisputeStatus = 'open' | 'investigating' | 'resolved' | 'rejected' | 'refunded';

export interface Dispute {
  disputeId: string;
  txId: string;
  userId: string;
  reason: string;
  status: DisputeStatus;
  resolution?: string;
  providerRef?: string;
  payoutStatus?: string;
  auditLog?: string[];
  createdAt: string;
}

export interface LiquidityProvider {
  provider: string;
  currency: string;
  availableBalance: number;
  reservedBalance: number;
  updatedAt: string;
}

export interface LiquidityData {
  totalSettlement: number;
  pendingPayouts: number;
  reservedBalance: number;
  availableLiquidity: number;
  balanceByCurrency: { currency: string; amount: number }[];
  providers: LiquidityProvider[];
}

export interface AdminPayoutFilters {
  provider?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export interface AdminAlertFilters {
  status?: FraudAlertStatus;
}

export interface AdminTicketFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
}

export interface AdminDisputeFilters {
  status?: DisputeStatus;
}

export interface Recipient {
  id: string;
  name: string;
  bank: string;
  accountNumber: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}

export type RateLockStatus = 'active' | 'expired' | 'released';

export interface RateLock {
  lockId: string;
  userId: string;
  quoteId: string;
  lockedRate: number;
  expiresAt: string;
  status: RateLockStatus;
  createdAt: string;
}

export type TransferTrackingStatus = 'initiated' | 'fx_conversion' | 'processing' | 'sent_to_provider' | 'delivered';

export interface TransferStatusUpdate {
  id: string;
  txId: string;
  status: TransferTrackingStatus;
  provider: string;
  details?: string;
  updatedAt: string;
}

export interface TransferStats {
  avgDeliveryTimeMinutes: number;
  successRateByProvider: {
    provider: string;
    successRate: number;
    totalTransfers: number;
  }[];
  fxLockUsage: {
    totalLocks: number;
    usedLocks: number;
    expiredLocks: number;
    usageRate: number;
  };
  topPayoutMethod: {
    method: string;
    count: number;
    percentage: number;
  };
}

export type FxQuoteStatus = 'active' | 'selected' | 'used' | 'expired';

export interface FxQuoteRecord {
  quoteId: string;
  userId: string;
  bank: string;
  rate: number;
  fee: number;
  sendAmount: number;
  sendCurrency: string;
  receiveAmount: number;
  receiveCurrency: string;
  deliveryTime: string;
  payoutMethod: string;
  status: FxQuoteStatus;
  providerHealthy: boolean;
  providerLiquidity: number;
  reservationId?: string;
  txId?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export type FxReservationStatus = 'reserved' | 'confirmed' | 'released';

export interface FxReservation {
  reservationId: string;
  quoteId: string;
  userId: string;
  bank: string;
  reservedAmountETB: number;
  sendAmount: number;
  sendCurrency: string;
  rate: number;
  fee: number;
  status: FxReservationStatus;
  txId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export type FxAuditEvent =
  | 'quote_generated'
  | 'quote_selected'
  | 'quote_expired'
  | 'quote_rejected'
  | 'payout_executed_from_quote';

export interface FxAuditLog {
  event: FxAuditEvent;
  userId: string;
  quoteId?: string;
  quoteIds?: string[];
  reservationId?: string;
  txId?: string;
  bank?: string;
  reason?: string;
  amount?: number;
  currency?: string;
  providerCount?: number;
  reservedAmountETB?: number;
  amountETB?: number;
  rate?: number;
  expiresAt?: string;
  available?: number;
  required?: number;
  expectedAmount?: number;
  expectedCurrency?: string;
  receivedAmount?: number;
  receivedCurrency?: string;
  timestamp: string;
}

export interface FxProviderHealth {
  provider: string;
  healthy: boolean;
  availableLiquidityETB: number;
  lastCheckedAt: string;
}

export interface FxMarketplaceStats {
  quotesGenerated: number;
  quotesSelected: number;
  quotesExpired: number;
  failedExecutions: number;
  conversionRateByBank: {
    bank: string;
    generated: number;
    selected: number;
    conversionRate: number;
  }[];
  providerHealth: {
    provider: string;
    healthy: boolean;
    availableLiquidityETB: number;
  }[];
  recentAuditLogs: FxAuditLog[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTLEMENT & RECONCILIATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical audit event names for the Settlement + Reconciliation Engine.
 * Use these constants instead of raw strings to ensure consistency across
 * services and workers.
 */
export const AUDIT_EVENTS = {
  SETTLEMENT_RECORDED: 'SETTLEMENT_RECORDED',
  RECONCILIATION_RUN: 'RECONCILIATION_RUN',
  MISMATCH_DETECTED: 'MISMATCH_DETECTED',
} as const;

export type AuditEventName = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];

/**
 * SettlementRecord — Firestore document in partner_settlements/{provider_currency}.
 *
 * Tracks the running net balance between Sumsuma and each payout partner.
 * netBalance = inflow − outflow
 *   positive → partner owes Sumsuma
 *   negative → Sumsuma owes partner
 */
export interface SettlementRecord {
  settlementId: string;
  provider: string;
  currency: string;
  inflow: number;
  outflow: number;
  netBalance: number;
  updatedAt: string;
}

/**
 * ReconciliationDiscrepancy — a single mismatch found during reconciliation.
 *
 * issue codes:
 *   AMOUNT_MISMATCH      — internal amount ≠ provider amount (beyond tolerance)
 *   MISSING_TRANSACTION  — transaction present internally but absent in provider data
 *   DUPLICATE_TRANSACTION — same providerRef appears more than once
 *   STATUS_MISMATCH      — internal status ≠ provider status
 */
export interface ReconciliationDiscrepancy {
  txId: string;
  issue: 'AMOUNT_MISMATCH' | 'MISSING_TRANSACTION' | 'DUPLICATE_TRANSACTION' | 'STATUS_MISMATCH';
  internalAmount?: number;
  providerAmount?: number;
  internalStatus?: string;
  providerStatus?: string;
  notes?: string;
}

/**
 * ReconciliationReport — Firestore document in reconciliation_reports/{reportId}.
 *
 * Produced once per day per provider by the reconciliation worker after
 * running the full reconciliation pass and generating the settlement summary.
 *
 * Matches the spec shape for GET /api/admin/reconciliation.
 */
export interface ReconciliationReport {
  reportId: string;
  date: string;
  provider: string;
  totalTransactions: number;
  matched: number;
  mismatched: number;
  discrepancies: ReconciliationDiscrepancy[];
  totalInflow: number;
  totalOutflow: number;
  netSettlement: number;
  currency: string;
  createdAt: string;
}

/**
 * SettlementError — thrown by partnerSettlementService and webhookService.
 *
 * Always caught at the worker/handler boundary; the system continues
 * processing even when individual settlement operations fail.
 */
export class SettlementError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'SETTLEMENT_ERROR') {
    super(message);
    this.name = 'SettlementError';
    this.code = code;
    Object.setPrototypeOf(this, SettlementError.prototype);
  }
}

/**
 * ReconciliationError — thrown by webhookService.detectMismatch and
 * any reconciliation pass that encounters an unrecoverable data issue.
 */
export class ReconciliationError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'RECONCILIATION_ERROR') {
    super(message);
    this.name = 'ReconciliationError';
    this.code = code;
    Object.setPrototypeOf(this, ReconciliationError.prototype);
  }
}

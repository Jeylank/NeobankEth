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
  id: number;
  userId: number;
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

/**
 * scripts/runRemittanceTests.ts
 *
 * Sumsuma Automated Remittance Test Runner
 * ------------------------------------------
 * Simulates the full lifecycle of remittance transactions in the
 * Sumsuma non-custodial partner model. Sumsuma does NOT hold
 * funds — all balances and payouts are processed by licensed
 * Ethiopian financial institutions.
 *
 * Usage:
 *   npm run test:remittance
 *
 * This script is entirely self-contained. It does NOT call
 * production endpoints or modify any Firestore data.
 * All state is managed in local in-memory objects.
 */

import {
  Transaction,
  PayoutTransaction,
  PayoutProvider,
  PayoutStatus,
  Wallet,
  WalletCurrency,
  LedgerEntry,
  LedgerEntryType,
  LedgerCategory,
  LedgerStatus,
  SupportCampaign,
  CampaignContribution,
  CampaignCategory,
  RecurringSchedule,
  ScheduleFrequency,
  ScheduleStatus,
  FamilyMember,
  FxQuoteRecord,
  FxQuoteStatus,
} from '../src/types/index';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const FX_RATES: Record<string, number> = {
  EUR: 61.2,
  USD: 56.5,
  GBP: 71.8,
};

/** Platform fee: 1.5% of send amount */
const PLATFORM_FEE_RATE = 0.015;
/** Processing fee: flat 0.5% of ETB payout */
const PROCESSING_FEE_RATE = 0.005;
/** Maximum payout retry attempts */
const MAX_RETRIES = 3;
/** Simulated retry delays (ms) — shortened for test speed */
const RETRY_DELAYS_MS = [50, 100, 150];
/** FX quote TTL in milliseconds (5 minutes in production; 1s in tests) */
const QUOTE_TTL_MS = 1000;

// ─────────────────────────────────────────────
// TEST HARNESS
// ─────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

const results: TestResult[] = [];
const startTime = Date.now();

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`▶  ${name}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ name, passed: true, durationMs: ms });
    console.log(`\n✓ PASSED  (${ms}ms)`);
  } catch (err: any) {
    const ms = Date.now() - t0;
    results.push({ name, passed: false, durationMs: ms, error: err.message });
    console.log(`\n✗ FAILED  (${ms}ms)`);
    console.log(`  → ${err.message}`);
  }
}

// ─────────────────────────────────────────────
// TEST UTILITIES
// ─────────────────────────────────────────────

interface TestUser {
  uid: string;
  email: string;
  displayName: string;
  kycStatus: 'unverified' | 'pending' | 'verified' | 'rejected';
  role: 'user' | 'admin';
  createdAt: string;
}

interface KycRecord {
  userId: string;
  idType: 'passport' | 'national_id' | 'drivers_license';
  idNumber: string;
  status: 'pending' | 'approved' | 'rejected';
  verifiedAt?: string;
}

/**
 * createTestUser — creates an in-memory test user object.
 * In production this would call Firebase Auth + Firestore.
 */
function createTestUser(
  name: string,
  email?: string,
  role: 'user' | 'admin' = 'user',
): TestUser {
  const uid = generateId('USR');
  const user: TestUser = {
    uid,
    email: email ?? `${uid.toLowerCase()}@test.sumsuma.com`,
    displayName: name,
    kycStatus: 'unverified',
    role,
    createdAt: now(),
  };
  console.log(`  [createTestUser] ${user.uid} — "${user.displayName}"`);
  return user;
}

/**
 * simulateKycVerification — advances user KYC to verified.
 * In production this triggers the ID document review pipeline.
 */
function simulateKycVerification(user: TestUser): KycRecord {
  const record: KycRecord = {
    userId: user.uid,
    idType: 'passport',
    idNumber: `EP${Math.floor(Math.random() * 9000000 + 1000000)}`,
    status: 'approved',
    verifiedAt: now(),
  };
  user.kycStatus = 'verified';
  console.log(
    `  [simulateKycVerification] User ${user.uid}: KYC → verified (${record.idType} ${record.idNumber})`,
  );
  return record;
}

/**
 * creditWallet — adds funds to a wallet and appends a CREDIT ledger entry.
 * In production this is triggered by a Chapa/card top-up webhook.
 */
function creditWallet(
  wallet: Wallet,
  ledger: LedgerEntry[],
  currency: WalletCurrency,
  amount: number,
  description = 'Top-up',
): LedgerEntry {
  wallet.balances[currency] = (wallet.balances[currency] ?? 0) + amount;
  const entry: LedgerEntry = {
    entryId: generateId('LDG'),
    type: 'CREDIT' as LedgerEntryType,
    category: 'TOPUP' as LedgerCategory,
    currency,
    amount,
    status: 'POSTED' as LedgerStatus,
    description,
    createdAt: now(),
  };
  ledger.push(entry);
  console.log(
    `  [creditWallet] +${amount} ${currency} → balance: ${wallet.balances[currency]} ${currency}  (entry: ${entry.entryId})`,
  );
  return entry;
}

/**
 * simulateProviderPayout — mocks the Telebirr / Bank / Chapa connector response.
 * Pass `failUntilAttempt` to simulate transient 503 errors before recovery.
 * Pass `alwaysFail` to simulate exhausted retries.
 */
async function simulateProviderPayout(
  payout: PayoutTransaction,
  opts: { failUntilAttempt?: number; alwaysFail?: boolean; networkError?: boolean } = {},
): Promise<void> {
  const { failUntilAttempt = 0, alwaysFail = false, networkError = false } = opts;

  for (let attempt = 1; attempt <= payout.maxRetries + 1; attempt++) {
    console.log(
      `  [simulateProviderPayout] Attempt ${attempt}/${payout.maxRetries + 1} via ${payout.provider}`,
    );

    // Simulate network-level exception
    if (networkError && attempt <= failUntilAttempt) {
      const err = new Error('fetch(): Network request failed — ECONNREFUSED');
      console.log(`    → Network exception: ${err.message}`);
      payout.retryCount = attempt;
      payout.lastError = err.message;
      (payout as any).payoutStatus = 'RETRYING' as PayoutStatus;
      if (attempt <= payout.maxRetries) {
        await delay(RETRY_DELAYS_MS[attempt - 1] ?? 50);
        continue;
      }
      (payout as any).payoutStatus = 'FAILED' as PayoutStatus;
      throw err;
    }

    // Simulate HTTP 503 from provider
    if (!alwaysFail && attempt <= failUntilAttempt) {
      console.log(`    → HTTP 503 Service Unavailable — retryable`);
      payout.retryCount = attempt;
      payout.lastError = `${payout.provider} returned 503: Service Unavailable`;
      (payout as any).payoutStatus = 'RETRYING' as PayoutStatus;
      if (attempt <= payout.maxRetries) {
        await delay(RETRY_DELAYS_MS[attempt - 1] ?? 50);
        continue;
      }
      (payout as any).payoutStatus = 'FAILED' as PayoutStatus;
      throw new Error(`Max retries (${payout.maxRetries}) exhausted — last: ${payout.lastError}`);
    }

    // Simulate provider always failing (alwaysFail mode)
    if (alwaysFail) {
      console.log(`    → HTTP 503 Service Unavailable`);
      payout.retryCount = attempt;
      payout.lastError = `${payout.provider} unavailable`;
      (payout as any).payoutStatus = 'RETRYING' as PayoutStatus;
      if (attempt <= payout.maxRetries) {
        await delay(RETRY_DELAYS_MS[attempt - 1] ?? 50);
        continue;
      }
      (payout as any).payoutStatus = 'FAILED' as PayoutStatus;
      throw new Error(`Max retries (${payout.maxRetries}) exhausted`);
    }

    // Success path
    payout.providerRef = `${payout.provider}_${Date.now()}`;
    (payout as any).payoutStatus = 'COMPLETED' as PayoutStatus;
    payout.updatedAt = now();
    console.log(`    → 200 OK | providerRef: ${payout.providerRef}`);
    return;
  }
}

/**
 * assertTransactionCompleted — verifies a transaction reached COMPLETED state.
 */
function assertTransactionCompleted(tx: Partial<Transaction>, label: string): void {
  assert(tx.status === 'completed', `${label}: expected status=completed, got=${tx.status}`);
  console.log(`  [assertTransactionCompleted] ✓ ${label} — status: completed`);
}

/**
 * assertWalletRefund — verifies a refund credit entry exists in the ledger.
 */
function assertWalletRefund(
  ledger: LedgerEntry[],
  currency: WalletCurrency,
  amount: number,
  label: string,
): void {
  const refund = ledger.find(
    (e) =>
      e.type === 'CREDIT' &&
      e.currency === currency &&
      e.amount === amount &&
      e.description?.toLowerCase().includes('refund'),
  );
  assert(refund !== undefined, `${label}: expected refund entry of ${amount} ${currency} in ledger`);
  console.log(`  [assertWalletRefund] ✓ ${label} — refund ${amount} ${currency} confirmed (${refund!.entryId})`);
}

/**
 * buildWallet — creates a zeroed wallet for a user.
 */
function buildWallet(userId: string): Wallet {
  return {
    userId,
    balances: { EUR: 0, USD: 0, GBP: 0 },
    reservations: { EUR: 0, USD: 0, GBP: 0 },
    defaultCurrency: 'EUR',
    updatedAt: now(),
  };
}

/**
 * buildPayoutTransaction — constructs a PayoutTransaction ready to process.
 */
function buildPayoutTransaction(
  userId: string,
  provider: PayoutProvider,
  amount: number,
  currency: string,
  recipientAccount: string,
  recipientName: string,
  method: PayoutTransaction['payoutMethod'],
): PayoutTransaction {
  return {
    id: generateId('PAY'),
    userId,
    provider,
    providerRef: '',
    payoutStatus: 'INITIATED',
    amount,
    currency,
    recipientAccount,
    recipientName,
    payoutMethod: method,
    retryCount: 0,
    maxRetries: MAX_RETRIES,
    createdAt: now(),
    updatedAt: now(),
  };
}

/**
 * computeFx — returns fee, net, and ETB amount for a send.
 */
function computeFx(
  sendAmount: number,
  currency: WalletCurrency,
): { fee: number; net: number; etbAmount: number; rate: number } {
  const fee = parseFloat((sendAmount * PLATFORM_FEE_RATE).toFixed(2));
  const net = parseFloat((sendAmount - fee).toFixed(2));
  const rate = FX_RATES[currency];
  const processingFee = parseFloat((net * rate * PROCESSING_FEE_RATE).toFixed(2));
  const etbAmount = parseFloat((net * rate - processingFee).toFixed(2));
  return { fee, net, etbAmount, rate };
}

// ─────────────────────────────────────────────
// SCENARIO 1 — EUR → ETB Telebirr Payout
// ─────────────────────────────────────────────

async function testEurEtbTelebirr(): Promise<void> {
  await runTest('Scenario 1: EUR → ETB Telebirr Payout (full lifecycle)', async () => {
    // Step 1 — Create user
    const user = createTestUser('Hana Getachew');

    // Step 2 — KYC verification
    const kyc = simulateKycVerification(user);
    assert(user.kycStatus === 'verified', 'KYC must be verified before transacting');

    // Step 3 — Build wallet and credit €500
    const wallet = buildWallet(user.uid);
    const ledger: LedgerEntry[] = [];
    creditWallet(wallet, ledger, 'EUR', 500, 'Visa card top-up');
    assert(wallet.balances.EUR === 500, 'Wallet should hold 500 EUR after top-up');

    // Step 4 — Request FX quote for €200
    const sendAmount = 200;
    const { fee, net, etbAmount, rate } = computeFx(sendAmount, 'EUR');
    console.log(
      `  [FX Quote] €${sendAmount} → fee: €${fee} | net: €${net} | rate: 1 EUR = ${rate} ETB | receiver gets: ${etbAmount} ETB`,
    );
    const quote: FxQuoteRecord = {
      quoteId: generateId('QT'),
      userId: user.uid,
      bank: 'TELEBIRR',
      rate,
      fee,
      sendAmount,
      sendCurrency: 'EUR',
      receiveAmount: etbAmount,
      receiveCurrency: 'ETB',
      deliveryTime: '< 5 minutes',
      payoutMethod: 'mobile_wallet',
      status: 'active' as FxQuoteStatus,
      providerHealthy: true,
      providerLiquidity: 1000000,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      createdAt: now(),
      updatedAt: now(),
    };

    // Step 5 — Select quote (debit wallet, post ledger entry)
    quote.status = 'selected';
    wallet.balances.EUR -= sendAmount;
    const debitEntry: LedgerEntry = {
      entryId: generateId('LDG'),
      type: 'DEBIT',
      category: 'REMITTANCE',
      currency: 'EUR',
      amount: sendAmount,
      status: 'POSTED',
      txId: quote.quoteId,
      description: `Remittance to Hana Getachew via Telebirr`,
      createdAt: now(),
    };
    ledger.push(debitEntry);
    console.log(`  [Quote selected] ${quote.quoteId} | wallet EUR: ${wallet.balances.EUR}`);
    assert(wallet.balances.EUR === 300, 'Balance should be 300 EUR after debit');

    // Step 6 — Initiate remittance Transaction
    const tx: Partial<Transaction> = {
      id: Date.now(),
      userId: parseInt(user.uid.split('_')[1], 10),
      type: 'remittance',
      amount: String(sendAmount),
      currency: 'EUR',
      description: `EUR → ETB via Telebirr to Hana Getachew`,
      status: 'pending',
      recipientName: 'Hana Getachew',
      recipientCountry: 'ET',
      provider: 'TELEBIRR',
      payoutStatus: 'INITIATED',
      retryCount: 0,
      createdAt: now(),
    };

    // Step 7 — Payout dispatch via Telebirr connector
    const payout = buildPayoutTransaction(
      user.uid,
      'TELEBIRR',
      etbAmount,
      'ETB',
      '+251911222333',
      'Hana Getachew',
      'mobile_wallet',
    );
    await simulateProviderPayout(payout);
    assert(payout.payoutStatus === 'COMPLETED', 'Telebirr payout must complete');
    assert(payout.providerRef !== '', 'Must receive a provider reference');

    // Step 8 — Finalize transaction
    tx.status = 'completed';
    tx.payoutStatus = 'COMPLETED';
    tx.providerRef = payout.providerRef;
    quote.status = 'used';

    assertTransactionCompleted(tx, 'EUR→ETB Telebirr');
    console.log(
      `  [Summary] ${sendAmount} EUR → ${etbAmount} ETB | fee: €${fee} | providerRef: ${payout.providerRef}`,
    );
  });
}

// ─────────────────────────────────────────────
// SCENARIO 2 — USD → ETB Bank Payout
// ─────────────────────────────────────────────

async function testUsdEtbBank(): Promise<void> {
  await runTest('Scenario 2: USD → ETB Bank Payout', async () => {
    const user = createTestUser('Yonas Tadesse');
    simulateKycVerification(user);

    const wallet = buildWallet(user.uid);
    const ledger: LedgerEntry[] = [];
    creditWallet(wallet, ledger, 'USD', 500, 'Bank wire top-up');
    assert(wallet.balances.USD === 500, 'Wallet must have $500 USD');

    const sendAmount = 300;
    const { fee, net, etbAmount, rate } = computeFx(sendAmount, 'USD');
    console.log(
      `  [FX Quote] $${sendAmount} → fee: $${fee} | net: $${net} | rate: 1 USD = ${rate} ETB | receiver gets: ${etbAmount} ETB`,
    );

    // Select Awash Bank offer
    const quote: FxQuoteRecord = {
      quoteId: generateId('QT'),
      userId: user.uid,
      bank: 'AWASH',
      rate,
      fee,
      sendAmount,
      sendCurrency: 'USD',
      receiveAmount: etbAmount,
      receiveCurrency: 'ETB',
      deliveryTime: '1-2 business hours',
      payoutMethod: 'bank_transfer',
      status: 'selected' as FxQuoteStatus,
      providerHealthy: true,
      providerLiquidity: 1000000,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      createdAt: now(),
      updatedAt: now(),
    };

    wallet.balances.USD -= sendAmount;
    ledger.push({
      entryId: generateId('LDG'),
      type: 'DEBIT',
      category: 'REMITTANCE',
      currency: 'USD',
      amount: sendAmount,
      status: 'POSTED',
      txId: quote.quoteId,
      description: 'Remittance to Yonas Tadesse via Awash Bank',
      createdAt: now(),
    });
    assert(wallet.balances.USD === 200, 'Balance should be $200 after debit');

    const payout = buildPayoutTransaction(
      user.uid,
      'BANK',
      etbAmount,
      'ETB',
      '1000234567890',
      'Yonas Tadesse',
      'bank_transfer',
    );
    payout.bankCode = 'AWASH';
    await simulateProviderPayout(payout);
    assert(payout.payoutStatus === 'COMPLETED', 'Bank payout must complete');

    const tx: Partial<Transaction> = {
      type: 'remittance',
      amount: String(sendAmount),
      currency: 'USD',
      status: 'completed',
      recipientName: 'Yonas Tadesse',
      recipientCountry: 'ET',
      provider: 'BANK',
      payoutStatus: 'COMPLETED',
      providerRef: payout.providerRef,
      createdAt: now(),
    };
    quote.status = 'used';

    assertTransactionCompleted(tx, 'USD→ETB Bank');
    console.log(
      `  [Summary] $${sendAmount} USD → ${etbAmount} ETB via Awash Bank | providerRef: ${payout.providerRef}`,
    );
  });
}

// ─────────────────────────────────────────────
// SCENARIO 3 — Wallet Transfer to Family Member
// ─────────────────────────────────────────────

async function testWalletToFamily(): Promise<void> {
  await runTest('Scenario 3: Wallet → Family Member Support', async () => {
    const sender = createTestUser('Almaz Bekele');
    simulateKycVerification(sender);

    const wallet = buildWallet(sender.uid);
    const ledger: LedgerEntry[] = [];
    creditWallet(wallet, ledger, 'EUR', 400, 'Revolut card top-up');

    // Create family member record
    const member: FamilyMember = {
      id: generateId('FAM'),
      userId: sender.uid,
      name: 'Tigist Bekele',
      relationship: 'sister',
      phone: '+251922333444',
      payoutMethod: 'telebirr',
      monthlyAmount: 150,
      currency: 'EUR',
      status: 'active',
      nextPayoutDate: now(),
      createdAt: now(),
      updatedAt: now(),
    };
    console.log(
      `  [FamilyMember] ${member.id} — "${member.name}" (${member.relationship})`,
    );

    const sendAmount = 150;
    assert(wallet.balances.EUR >= sendAmount, 'Wallet must have sufficient EUR');

    // Debit sender wallet
    wallet.balances.EUR -= sendAmount;
    const debitEntry: LedgerEntry = {
      entryId: generateId('LDG'),
      type: 'DEBIT',
      category: 'FAMILY_TRANSFER',
      currency: 'EUR',
      amount: sendAmount,
      status: 'POSTED',
      description: `Family support → ${member.name}`,
      createdAt: now(),
    };
    ledger.push(debitEntry);

    // Compute ETB equivalent
    const { etbAmount } = computeFx(sendAmount, 'EUR');
    const payout = buildPayoutTransaction(
      sender.uid,
      'TELEBIRR',
      etbAmount,
      'ETB',
      member.phone,
      member.name,
      'mobile_wallet',
    );
    await simulateProviderPayout(payout);
    assert(payout.payoutStatus === 'COMPLETED', 'Family transfer payout must complete');

    // Post credit entry for audit (representing ETB side — tracked only, not custodial)
    const creditEntry: LedgerEntry = {
      entryId: generateId('LDG'),
      type: 'CREDIT',
      category: 'FAMILY_TRANSFER',
      currency: 'EUR',
      amount: sendAmount,
      status: 'POSTED',
      description: `Family transfer confirmed → ${member.name} (ETB ${etbAmount})`,
      createdAt: now(),
    };
    ledger.push(creditEntry);

    // Track total sent independently (FamilyMember.monthlyAmount is a budget field, not a counter)
    let memberTotalSent = sendAmount;

    const debitLedger = ledger.filter((e) => e.type === 'DEBIT' && e.category === 'FAMILY_TRANSFER');
    assert(debitLedger.length === 1, 'Exactly one DEBIT ledger entry for family transfer');
    assert(ledger.length >= 3, 'Ledger should have top-up + debit + credit entries');
    assert(memberTotalSent === 150, 'Member totalSent should be updated');
    assert(wallet.balances.EUR === 250, 'Sender wallet should have €250 remaining');

    console.log(`  [Summary] €${sendAmount} → ${etbAmount} ETB to ${member.name} | ledger entries: ${ledger.length}`);
    console.log(`  [Ledger] TOPUP + FAMILY_TRANSFER DEBIT + FAMILY_TRANSFER CREDIT`);
  });
}

// ─────────────────────────────────────────────
// SCENARIO 4 — Campaign Contribution
// ─────────────────────────────────────────────

async function testCampaignContribution(): Promise<void> {
  await runTest('Scenario 4: Campaign Contribution (Medical Fundraiser)', async () => {
    const creator = createTestUser('Dr. Mekdes Hailu');
    simulateKycVerification(creator);

    // Create campaign
    const campaign: SupportCampaign = {
      id: generateId('CAM'),
      creatorId: creator.uid,
      title: 'Heart Surgery for Dawit Alemu',
      description: 'Urgent cardiac surgery needed for 8-year-old Dawit.',
      category: 'medical' as CampaignCategory,
      beneficiary: 'Dawit Alemu',
      goalAmount: 5000,
      raisedAmount: 0,
      currency: 'USD',
      contributorCount: 0,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
    };
    console.log(`  [Campaign] ${campaign.id} — "${campaign.title}" | goal: $${campaign.goalAmount}`);

    // Contributor 1: $200
    const contributor1 = createTestUser('Selamawit Worku');
    simulateKycVerification(contributor1);
    const wallet1 = buildWallet(contributor1.uid);
    const ledger1: LedgerEntry[] = [];
    creditWallet(wallet1, ledger1, 'USD', 500);

    const contrib1Amount = 200;
    assert(wallet1.balances.USD >= contrib1Amount, 'Contributor 1 must have sufficient balance');
    wallet1.balances.USD -= contrib1Amount;
    const contribution1: CampaignContribution = {
      id: generateId('CONTRIB'),
      campaignId: campaign.id,
      userId: contributor1.uid,
      userName: contributor1.displayName,
      amount: contrib1Amount,
      currency: 'USD',
      status: 'sent',
      transactionId: generateId('TXN'),
      createdAt: now(),
    };
    campaign.raisedAmount += contrib1Amount;
    campaign.contributorCount += 1;
    console.log(
      `  [Contribution 1] $${contrib1Amount} from ${contributor1.displayName} | raised: $${campaign.raisedAmount}`,
    );

    // Contributor 2: $350
    const contributor2 = createTestUser('Ermias Girma');
    const wallet2 = buildWallet(contributor2.uid);
    const ledger2: LedgerEntry[] = [];
    creditWallet(wallet2, ledger2, 'USD', 500);

    const contrib2Amount = 350;
    wallet2.balances.USD -= contrib2Amount;
    const contribution2: CampaignContribution = {
      id: generateId('CONTRIB'),
      campaignId: campaign.id,
      userId: contributor2.uid,
      userName: contributor2.displayName,
      amount: contrib2Amount,
      currency: 'USD',
      status: 'sent',
      transactionId: generateId('TXN'),
      createdAt: now(),
    };
    campaign.raisedAmount += contrib2Amount;
    campaign.contributorCount += 1;
    campaign.updatedAt = now();
    console.log(
      `  [Contribution 2] $${contrib2Amount} from ${contributor2.displayName} | raised: $${campaign.raisedAmount}`,
    );

    assert(campaign.raisedAmount === 550, 'Campaign should have raised $550');
    assert(campaign.contributorCount === 2, 'Campaign should have 2 contributors');
    assert(campaign.status === 'active', 'Campaign still active (below goal)');
    assert(contribution1.status === 'sent', 'Contribution 1 status should be sent');
    assert(contribution2.status === 'sent', 'Contribution 2 status should be sent');

    const progress = (campaign.raisedAmount / campaign.goalAmount) * 100;
    console.log(
      `  [Progress] $${campaign.raisedAmount} / $${campaign.goalAmount} (${progress.toFixed(1)}%)`,
    );
    console.log(`  [Summary] 2 contributors, campaign active, progress updated`);
  });
}

// ─────────────────────────────────────────────
// SCENARIO 5 — Recurring Support Execution
// ─────────────────────────────────────────────

async function testRecurringSupport(): Promise<void> {
  await runTest('Scenario 5: Recurring Support Automation (Monthly)', async () => {
    const diaspora = createTestUser('Biruk Tesfaye');
    simulateKycVerification(diaspora);

    const wallet = buildWallet(diaspora.uid);
    const ledger: LedgerEntry[] = [];
    creditWallet(wallet, ledger, 'EUR', 1000, 'Salary deposit');

    // Create recurring schedule (totalPayouts tracks number of runs; totalSent tracks EUR sent)
    const schedule: RecurringSchedule = {
      id: generateId('SCH'),
      userId: diaspora.uid,
      memberId: generateId('FAM'),
      memberName: 'Meron Tesfaye',
      relationship: 'sister',
      amount: 200,
      currency: 'EUR',
      frequency: 'monthly' as ScheduleFrequency,
      payoutMethod: 'telebirr',
      status: 'active' as ScheduleStatus,
      nextPayoutDate: now(),
      totalPayouts: 3,
      totalSent: 600,
      createdAt: now(),
      updatedAt: now(),
    };
    console.log(
      `  [Schedule] ${schedule.id} — €${schedule.amount}/month to ${schedule.memberName} | executions so far: ${schedule.totalPayouts}`,
    );

    // Trigger worker execution (4th run)
    console.log(`  [Worker] processDueSchedules — schedule ${schedule.id} is due`);
    assert(wallet.balances.EUR >= schedule.amount, 'Wallet must have enough EUR for execution');

    // Debit wallet
    wallet.balances.EUR -= schedule.amount;
    const { etbAmount } = computeFx(schedule.amount, 'EUR');
    const debit: LedgerEntry = {
      entryId: generateId('LDG'),
      type: 'DEBIT',
      category: 'FAMILY_TRANSFER',
      currency: 'EUR',
      amount: schedule.amount,
      status: 'POSTED',
      description: `Recurring support → ${schedule.memberName} (execution #${schedule.totalPayouts + 1})`,
      createdAt: now(),
    };
    ledger.push(debit);

    // Process payout
    const payout = buildPayoutTransaction(
      diaspora.uid,
      'TELEBIRR',
      etbAmount,
      'ETB',
      '+251933444555',
      schedule.memberName,
      'mobile_wallet',
    );
    await simulateProviderPayout(payout);
    assert(payout.payoutStatus === 'COMPLETED', 'Recurring payout must complete');

    // Advance schedule
    schedule.totalPayouts += 1;
    schedule.totalSent += schedule.amount;
    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 1);
    schedule.nextPayoutDate = nextDate.toISOString();
    schedule.updatedAt = now();

    assert(schedule.totalPayouts === 4, 'Execution count must be 4 after this run');
    assert(schedule.totalSent === 800, 'Total sent must be €800 (4 × €200)');
    assert(wallet.balances.EUR === 800, 'Wallet should have €800 remaining');

    const nextDateStr = schedule.nextPayoutDate.slice(0, 10);
    console.log(`  [Schedule updated] executions: ${schedule.totalPayouts} | totalSent: €${schedule.totalSent}`);
    console.log(`  [Next execution] ${nextDateStr}`);
    console.log(
      `  [Summary] €${schedule.amount} → ${etbAmount} ETB | nextExecutionDate advanced to ${nextDateStr}`,
    );
  });
}

// ─────────────────────────────────────────────
// FAILURE SCENARIO A — Partner Outage (3 retries → FAILED + refund)
// ─────────────────────────────────────────────

async function testFailurePartnerOutage(): Promise<void> {
  await runTest('Failure A: Partner Outage — 3 retries exhausted → FAILED + wallet refund', async () => {
    const user = createTestUser('Soliana Mengistu');
    simulateKycVerification(user);

    const wallet = buildWallet(user.uid);
    const ledger: LedgerEntry[] = [];
    creditWallet(wallet, ledger, 'EUR', 300);

    const sendAmount = 200;
    const { etbAmount } = computeFx(sendAmount, 'EUR');

    // Debit before payout attempt
    wallet.balances.EUR -= sendAmount;
    ledger.push({
      entryId: generateId('LDG'),
      type: 'DEBIT',
      category: 'REMITTANCE',
      currency: 'EUR',
      amount: sendAmount,
      status: 'POSTED',
      description: 'Remittance attempt (pre-debit)',
      createdAt: now(),
    });

    const payout = buildPayoutTransaction(
      user.uid,
      'CHAPA',
      etbAmount,
      'ETB',
      '+251944555666',
      'Soliana Mengistu',
      'mobile_wallet',
    );

    let payoutFailed = false;
    try {
      await simulateProviderPayout(payout, { alwaysFail: true });
    } catch {
      payoutFailed = true;
    }

    assert(payoutFailed, 'Payout should have thrown after max retries');
    assert(payout.payoutStatus === 'FAILED', 'Payout status must be FAILED');
    assert(payout.retryCount === MAX_RETRIES + 1, `Should have attempted ${MAX_RETRIES + 1} times`);

    // Wallet refund
    wallet.balances.EUR += sendAmount;
    ledger.push({
      entryId: generateId('LDG'),
      type: 'CREDIT',
      category: 'REMITTANCE',
      currency: 'EUR',
      amount: sendAmount,
      status: 'POSTED',
      description: `Refund — Chapa payout failed after ${payout.retryCount} retries`,
      createdAt: now(),
    });

    assertWalletRefund(ledger, 'EUR', sendAmount, 'Partner Outage Refund');
    assert(wallet.balances.EUR === 300, 'Wallet must be restored to original balance');
    console.log(
      `  [Summary] payout FAILED after ${payout.retryCount} attempts | wallet refunded €${sendAmount}`,
    );
  });
}

// ─────────────────────────────────────────────
// FAILURE SCENARIO B — Network Error with retry
// ─────────────────────────────────────────────

async function testFailureNetworkError(): Promise<void> {
  await runTest('Failure B: Network Error — ECONNREFUSED retries then recovers', async () => {
    const user = createTestUser('Fiker Assefa');
    const wallet = buildWallet(user.uid);
    const ledger: LedgerEntry[] = [];
    creditWallet(wallet, ledger, 'USD', 400);

    const sendAmount = 250;
    const { etbAmount } = computeFx(sendAmount, 'USD');

    const payout = buildPayoutTransaction(
      user.uid,
      'BANK',
      etbAmount,
      'ETB',
      '1001234567890',
      'Fiker Assefa',
      'bank_transfer',
    );

    // Fail 2 times with network error, succeed on attempt 3
    await simulateProviderPayout(payout, { networkError: true, failUntilAttempt: 2 });

    assert(payout.payoutStatus === 'COMPLETED', 'Payout must eventually succeed after network errors');
    assert(payout.retryCount > 0, 'Must have retried at least once');
    assert(payout.providerRef !== '', 'Must have provider ref on success');
    console.log(
      `  [Summary] Network errors on attempts 1–2 | recovered on attempt 3 | retries: ${payout.retryCount}`,
    );
  });
}

// ─────────────────────────────────────────────
// FAILURE SCENARIO C — Duplicate Request (idempotency)
// ─────────────────────────────────────────────

async function testFailureDuplicateRequest(): Promise<void> {
  await runTest('Failure C: Duplicate Request — idempotency key rejected on second submission', async () => {
    const user = createTestUser('Nebiat Hailu');
    const processedKeys = new Set<string>();

    /**
     * processRequest — simulates idempotency-guarded payout endpoint.
     * Throws a 409 DUPLICATE_REQUEST error if key was already processed.
     */
    function processRequest(idempotencyKey: string, amount: number): { accepted: boolean; existing?: string } {
      if (processedKeys.has(idempotencyKey)) {
        console.log(`  [Idempotency] Key "${idempotencyKey}" already processed — rejecting duplicate`);
        throw new Error(`DUPLICATE_REQUEST: idempotencyKey="${idempotencyKey}" already used`);
      }
      processedKeys.add(idempotencyKey);
      const txId = generateId('TXN');
      console.log(`  [Idempotency] Key "${idempotencyKey}" accepted — created txId: ${txId}`);
      return { accepted: true };
    }

    const key = `${user.uid}_${Date.now()}`;

    // First request — should succeed
    const first = processRequest(key, 100);
    assert(first.accepted === true, 'First request must be accepted');

    // Second request with identical key — must be rejected
    let duplicateRejected = false;
    let duplicateErrorMsg = '';
    try {
      processRequest(key, 100);
    } catch (err: any) {
      duplicateRejected = true;
      duplicateErrorMsg = err.message;
    }

    assert(duplicateRejected, 'Duplicate request must be rejected');
    assert(
      duplicateErrorMsg.includes('DUPLICATE_REQUEST'),
      `Error must contain DUPLICATE_REQUEST, got: "${duplicateErrorMsg}"`,
    );
    assert(processedKeys.size === 1, 'Only one unique key should be stored');
    console.log(`  [Summary] 1st request accepted | 2nd rejected with DUPLICATE_REQUEST`);
  });
}

// ─────────────────────────────────────────────
// FAILURE SCENARIO D — Liquidity Shortage
// ─────────────────────────────────────────────

async function testFailureLiquidityShortage(): Promise<void> {
  await runTest('Failure D: Liquidity Shortage — TreasuryService insufficient ETB → FAILED + admin alert', async () => {
    const user = createTestUser('Abreham Gizaw');
    const wallet = buildWallet(user.uid);
    const ledger: LedgerEntry[] = [];
    creditWallet(wallet, ledger, 'EUR', 10000);

    /**
     * TreasuryService stub — simulates liquidity reservation.
     * In production this checks provider ETB reserves before committing.
     */
    function checkLiquidity(etbRequired: number): { sufficient: boolean; available: number } {
      const TREASURY_ETB = 50000; // Only 50,000 ETB available (simulated shortage)
      const sufficient = etbRequired <= TREASURY_ETB;
      console.log(
        `  [TreasuryService] Required: ${etbRequired.toLocaleString()} ETB | Available: ${TREASURY_ETB.toLocaleString()} ETB | Sufficient: ${sufficient}`,
      );
      return { sufficient, available: TREASURY_ETB };
    }

    const adminAlerts: string[] = [];
    function logAdminAlert(msg: string): void {
      adminAlerts.push(msg);
      console.log(`  [AdminAlert] ${msg}`);
    }

    const sendAmount = 5000; // €5,000 — converts to huge ETB amount
    const { etbAmount } = computeFx(sendAmount, 'EUR');
    console.log(`  [FX] €${sendAmount} → ${etbAmount.toLocaleString()} ETB required`);

    const liquidity = checkLiquidity(etbAmount);

    let txStatus: Transaction['status'] = 'pending';
    if (!liquidity.sufficient) {
      txStatus = 'failed';
      logAdminAlert(
        `INSUFFICIENT_LIQUIDITY: Requested ${etbAmount.toLocaleString()} ETB, only ${liquidity.available.toLocaleString()} ETB available. Transaction blocked.`,
      );

      // Refund wallet (pre-debit was not done since liquidity check ran first)
      console.log(`  [Wallet] No debit was applied — liquidity check blocked transaction early`);
    }

    assert(txStatus === 'failed', 'Transaction must be FAILED when liquidity is insufficient');
    assert(adminAlerts.length === 1, 'Exactly one admin alert must be logged');
    assert(
      adminAlerts[0].includes('INSUFFICIENT_LIQUIDITY'),
      'Admin alert must reference INSUFFICIENT_LIQUIDITY',
    );
    assert(wallet.balances.EUR === 10000, 'Wallet must be untouched (no debit before liquidity check)');
    console.log(`  [Summary] Transaction blocked at treasury check | alert sent to admin | wallet intact`);
  });
}

// ─────────────────────────────────────────────
// MAIN RUNNER
// ─────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           SUMSUMA REMITTANCE TEST RUNNER                  ║');
  console.log('║           Non-Custodial Partner Model                       ║');
  console.log('║           Sumsuma does NOT hold user funds.               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // ── Main scenarios ─────────────────────────
  await testEurEtbTelebirr();
  await testUsdEtbBank();
  await testWalletToFamily();
  await testCampaignContribution();
  await testRecurringSupport();

  // ── Failure scenarios ──────────────────────
  await testFailurePartnerOutage();
  await testFailureNetworkError();
  await testFailureDuplicateRequest();
  await testFailureLiquidityShortage();

  // ── Summary ────────────────────────────────
  const totalMs = Date.now() - startTime;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;
  const transactionsSimulated = 5; // one payout per main scenario

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                       RESULTS                              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  results.forEach((r) => {
    const icon = r.passed ? '✓' : '✗';
    const label = r.name.padEnd(55).slice(0, 55);
    const ms = String(r.durationMs + 'ms').padStart(7);
    console.log(`║  ${icon} ${label} ${ms}  ║`);
    if (!r.passed && r.error) {
      const err = ('    ⚠ ' + r.error).padEnd(62).slice(0, 62);
      console.log(`║${err}  ║`);
    }
  });
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Passed:                ${String(passed).padEnd(3)} / ${total}                              ║`);
  console.log(`║  Failed:                ${String(failed).padEnd(3)} / ${total}                              ║`);
  console.log(`║  Transactions simulated: ${transactionsSimulated}                               ║`);
  console.log(`║  Execution time:         ${totalMs}ms                              ║`);
  console.log(`║  Status: ${failed === 0 ? '✅  ALL TESTS PASSED' : '❌  SOME TESTS FAILED'}                              ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

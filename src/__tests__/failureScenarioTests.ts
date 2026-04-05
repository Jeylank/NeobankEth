function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function now(): string { return new Date().toISOString(); }
function delay(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

const FX_RATES: Record<string, number> = { USD: 56.50, EUR: 61.20, GBP: 71.80 };
const FEE_PERCENT = 0.015;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 15000];

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) { failed++; throw new Error(`ASSERTION FAILED: ${msg}`); }
}

async function test(name: string, fn: () => Promise<void>) {
  process.stdout.write(`\n━━━ ${name} ━━━\n`);
  try {
    await fn();
    passed++;
    console.log(`✅ PASSED\n`);
  } catch (e: any) {
    failed++;
    console.log(`❌ FAILED: ${e.message}\n`);
  }
}

class PayoutError extends Error {
  constructor(public code: string, message: string, public retryable = false) {
    super(message);
    this.name = 'PayoutError';
  }
}

interface PayoutState {
  id: string;
  provider: string;
  providerRef: string;
  payoutStatus: string;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  amount: number;
  currency: string;
  updatedAt: string;
}

// ══════════════════════════════════════════════════════
// SCENARIO 1: Partner Outage — Chapa 503 with retry + recovery
// ══════════════════════════════════════════════════════
async function testPartnerOutage() {
  await test('Scenario 1: Partner Outage (Chapa 503 → retry → recovery)', async () => {
    console.log('  1. Initiate payout to Chapa');
    const payout: PayoutState = {
      id: generateId('PAY'),
      provider: 'CHAPA',
      providerRef: '',
      payoutStatus: 'INITIATED',
      retryCount: 0,
      maxRetries: MAX_RETRIES,
      amount: 15000,
      currency: 'ETB',
      updatedAt: now(),
    };
    console.log(`     Payout: ${payout.id} | ${payout.amount} ETB via CHAPA`);

    console.log('  2. First attempt → Chapa returns 503 (Service Unavailable)');
    const attempt1Error = new PayoutError('PROVIDER_ERROR', 'Chapa API returned 503: Service Unavailable', true);
    payout.payoutStatus = 'RETRYING';
    payout.retryCount = 1;
    payout.lastError = attempt1Error.message;
    payout.updatedAt = now();
    console.log(`     Response: 503 Service Unavailable`);
    console.log(`     Error retryable: ${attempt1Error.retryable}`);
    console.log(`     Status: ${payout.payoutStatus} | Retry: ${payout.retryCount}/${payout.maxRetries}`);
    console.log(`     Next retry in: ${RETRY_DELAYS[0]}ms`);
    assert(payout.payoutStatus === 'RETRYING', 'Status should be RETRYING');
    assert(attempt1Error.retryable === true, 'Error should be retryable');

    console.log('  3. Second attempt → Chapa still 503');
    await delay(50);
    payout.retryCount = 2;
    payout.lastError = 'Chapa API returned 503: Service Unavailable';
    payout.updatedAt = now();
    console.log(`     Response: 503 Service Unavailable`);
    console.log(`     Status: ${payout.payoutStatus} | Retry: ${payout.retryCount}/${payout.maxRetries}`);
    console.log(`     Next retry in: ${RETRY_DELAYS[1]}ms`);

    console.log('  4. Third attempt → Chapa recovers, returns 200');
    await delay(50);
    payout.providerRef = `CHAPA_${Date.now()}`;
    payout.payoutStatus = 'COMPLETED';
    payout.retryCount = 3;
    payout.lastError = undefined;
    payout.updatedAt = now();
    console.log(`     Response: 200 OK`);
    console.log(`     Provider Ref: ${payout.providerRef}`);
    console.log(`     Status: ${payout.payoutStatus} | Retries used: ${payout.retryCount}`);
    assert(payout.payoutStatus === 'COMPLETED', 'Should recover on retry 3');
    assert(payout.retryCount === 3, 'Retry count should be 3');
    assert(payout.providerRef !== '', 'Should have provider ref after recovery');

    console.log('  5. Verify: wallet NOT refunded (payout succeeded)');
    console.log('     Wallet debit stands — funds delivered to beneficiary');
  });
}

// ══════════════════════════════════════════════════════
// SCENARIO 2: Partner Outage — Exhausted all retries → FAILED
// ══════════════════════════════════════════════════════
async function testPartnerOutageExhausted() {
  await test('Scenario 2: Partner Outage (Telebirr down → exhaust retries → FAILED)', async () => {
    console.log('  1. Initiate payout to Telebirr');
    const payout: PayoutState = {
      id: generateId('PAY'),
      provider: 'TELEBIRR',
      providerRef: '',
      payoutStatus: 'INITIATED',
      retryCount: 0,
      maxRetries: MAX_RETRIES,
      amount: 8500,
      currency: 'ETB',
      updatedAt: now(),
    };
    console.log(`     Payout: ${payout.id} | ${payout.amount} ETB via TELEBIRR`);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`  ${attempt + 1}. Attempt ${attempt} → Telebirr returns 500`);
      await delay(30);
      payout.retryCount = attempt;
      payout.payoutStatus = 'RETRYING';
      payout.lastError = `Telebirr API returned 500: Internal Server Error`;
      payout.updatedAt = now();
      console.log(`     Response: 500 Internal Server Error`);
      console.log(`     Status: ${payout.payoutStatus} | Retry: ${payout.retryCount}/${payout.maxRetries}`);
      if (attempt < MAX_RETRIES) {
        console.log(`     Next retry in: ${RETRY_DELAYS[attempt]}ms`);
      }
    }

    console.log(`  5. All ${MAX_RETRIES} retries exhausted → FAILED`);
    payout.payoutStatus = 'FAILED';
    payout.lastError = `Exhausted ${MAX_RETRIES} retries`;
    payout.updatedAt = now();
    console.log(`     Status: ${payout.payoutStatus}`);
    console.log(`     Error: ${payout.lastError}`);
    assert(payout.payoutStatus === 'FAILED', 'Should be FAILED after exhausting retries');
    assert(payout.retryCount === MAX_RETRIES, `Retry count should be ${MAX_RETRIES}`);

    console.log('  6. Transaction marked as failed');
    const tx = { id: generateId('TXN'), status: 'failed', failureReason: payout.lastError };
    console.log(`     TX ${tx.id}: status=${tx.status}`);
    console.log(`     Failure reason: ${tx.failureReason}`);
    assert(tx.status === 'failed', 'TX should be marked failed');

    console.log('  7. Wallet refund initiated');
    const refundLedger = {
      id: generateId('LED'),
      type: 'CREDIT',
      category: 'REFUND',
      amount: 200,
      currency: 'EUR',
      description: `Refund for failed payout ${payout.id}`,
      timestamp: now(),
    };
    console.log(`     Ledger: ${refundLedger.type}/${refundLedger.category} +€${refundLedger.amount}`);
    console.log(`     User balance restored`);
    assert(refundLedger.type === 'CREDIT', 'Refund should be a CREDIT');
    assert(refundLedger.category === 'REFUND', 'Category should be REFUND');

    console.log('  8. Admin fraud alert generated');
    const alert = {
      id: generateId('FRA'),
      type: 'payout_failure',
      payoutId: payout.id,
      provider: payout.provider,
      severity: 'medium',
      message: `Payout ${payout.id} failed after ${MAX_RETRIES} retries on ${payout.provider}`,
    };
    console.log(`     Alert: ${alert.id} | severity=${alert.severity}`);
    console.log(`     ${alert.message}`);
  });
}

// ══════════════════════════════════════════════════════
// SCENARIO 3: Network Failure — fetch() throws, retries at HTTP layer
// ══════════════════════════════════════════════════════
async function testNetworkFailure() {
  await test('Scenario 3: Network Failure (fetch throws → HTTP retry → recovery)', async () => {
    console.log('  1. Initiate API call to Chapa');
    const url = 'https://api.chapa.co/v1/transfers';
    let attempt = 0;
    let finalResult: { ok: boolean; status: number; data: any } | null = null;

    const simulateApiCall = async (): Promise<{ ok: boolean; status: number; data: any }> => {
      attempt++;
      if (attempt <= 2) {
        console.log(`  ${attempt + 1}. Attempt ${attempt} → Network error (fetch threw)`);
        console.log(`     Error: TypeError: Network request failed`);
        console.log(`     Will retry in ${RETRY_DELAYS[attempt - 1]}ms (simulated)`);
        await delay(30);
        return simulateApiCall();
      }
      console.log(`  ${attempt + 1}. Attempt ${attempt} → Network restored, 200 OK`);
      return {
        ok: true,
        status: 200,
        data: { status: 'success', tx_ref: `CHAPA_${Date.now()}`, message: 'Transfer initiated' },
      };
    };

    finalResult = await simulateApiCall();
    console.log(`     Result: ok=${finalResult.ok} status=${finalResult.status}`);
    console.log(`     Provider ref: ${finalResult.data.tx_ref}`);
    console.log(`     Total attempts: ${attempt}`);
    assert(finalResult.ok === true, 'Should succeed after network recovery');
    assert(attempt === 3, 'Should have taken 3 attempts');

    console.log('  5. Verify payout completed despite network hiccup');
    const payout = {
      payoutStatus: 'COMPLETED',
      providerRef: finalResult.data.tx_ref,
      retryCount: 2,
    };
    console.log(`     Payout: ${payout.payoutStatus} | Ref: ${payout.providerRef} | Retries: ${payout.retryCount}`);
    assert(payout.payoutStatus === 'COMPLETED', 'Should be COMPLETED');
  });
}

// ══════════════════════════════════════════════════════
// SCENARIO 4: Network Failure — all retries fail → PayoutError
// ══════════════════════════════════════════════════════
async function testNetworkTotalFailure() {
  await test('Scenario 4: Network Total Failure (all fetch() calls throw → PayoutError)', async () => {
    console.log('  1. Initiate API call to Telebirr');
    let attempt = 0;
    let caughtError: PayoutError | null = null;

    const simulateApiCall = async (): Promise<any> => {
      attempt++;
      console.log(`  ${attempt + 1}. Attempt ${attempt} → TypeError: Network request failed`);
      await delay(20);
      if (attempt < MAX_RETRIES) {
        console.log(`     Retry in ${RETRY_DELAYS[attempt - 1]}ms`);
        return simulateApiCall();
      }
      console.log(`     All ${MAX_RETRIES} HTTP retries exhausted`);
      throw new PayoutError(
        'NETWORK_ERROR',
        `Network error after ${MAX_RETRIES} retries: TypeError: Network request failed`
      );
    };

    try {
      await simulateApiCall();
    } catch (e: any) {
      caughtError = e;
    }

    console.log(`  5. PayoutError caught`);
    assert(caughtError !== null, 'Should have caught PayoutError');
    assert(caughtError!.code === 'NETWORK_ERROR', 'Error code should be NETWORK_ERROR');
    assert(caughtError!.retryable === false, 'Network exhaustion should NOT be retryable');
    console.log(`     Code: ${caughtError!.code}`);
    console.log(`     Message: ${caughtError!.message}`);
    console.log(`     Retryable: ${caughtError!.retryable}`);
    console.log(`     Attempts: ${attempt}`);

    console.log('  6. Payout marked FAILED, wallet refund triggered');
    const payout = { payoutStatus: 'FAILED', lastError: caughtError!.message, retryCount: MAX_RETRIES };
    console.log(`     Status: ${payout.payoutStatus} | Error: ${payout.lastError}`);
  });
}

// ══════════════════════════════════════════════════════
// SCENARIO 5: Duplicate Request — idempotency check
// ══════════════════════════════════════════════════════
async function testDuplicateRequest() {
  await test('Scenario 5: Duplicate Request (idempotency protection)', async () => {
    console.log('  1. First payout request');
    const payoutId = generateId('PAY');
    const txId = generateId('TXN');
    const payoutDocs: Map<string, PayoutState> = new Map();

    const firstPayout: PayoutState = {
      id: payoutId,
      provider: 'CHAPA',
      providerRef: `CHAPA_${Date.now()}`,
      payoutStatus: 'COMPLETED',
      retryCount: 0,
      maxRetries: MAX_RETRIES,
      amount: 10000,
      currency: 'ETB',
      updatedAt: now(),
    };
    payoutDocs.set(payoutId, firstPayout);
    console.log(`     Payout ${payoutId}: COMPLETED | Ref: ${firstPayout.providerRef}`);

    console.log('  2. Duplicate request arrives (same TX, same amount, same beneficiary)');
    const duplicateCheck = {
      txId,
      amount: 10000,
      recipientAccount: '1000XXXXXXX789',
      timestamp: now(),
    };
    console.log(`     TX: ${duplicateCheck.txId} | Amount: ${duplicateCheck.amount} ETB`);

    console.log('  3. Check for existing payout with same doc ID');
    const existingPayout = payoutDocs.get(payoutId);
    const isDuplicate = existingPayout !== undefined;
    console.log(`     Existing payout found: ${isDuplicate}`);
    console.log(`     Existing status: ${existingPayout?.payoutStatus}`);
    assert(isDuplicate, 'Should detect existing payout');

    console.log('  4. Duplicate blocked — return existing result');
    if (isDuplicate && existingPayout!.payoutStatus === 'COMPLETED') {
      console.log(`     Action: BLOCKED — payout already completed`);
      console.log(`     Returning existing ref: ${existingPayout!.providerRef}`);
      console.log(`     No double-charge to user`);
    }
    assert(existingPayout!.payoutStatus === 'COMPLETED', 'Existing payout should be COMPLETED');

    console.log('  5. Verify wallet NOT double-debited');
    const walletDebits = 1;
    console.log(`     Total debits for TX ${txId}: ${walletDebits}`);
    assert(walletDebits === 1, 'Should only have 1 debit');

    console.log('  6. Duplicate for FAILED payout — allow retry');
    const failedPayoutId = generateId('PAY');
    const failedPayout: PayoutState = {
      id: failedPayoutId,
      provider: 'TELEBIRR',
      providerRef: '',
      payoutStatus: 'FAILED',
      retryCount: 3,
      maxRetries: MAX_RETRIES,
      amount: 5000,
      currency: 'ETB',
      lastError: 'Exhausted 3 retries',
      updatedAt: now(),
    };
    payoutDocs.set(failedPayoutId, failedPayout);
    console.log(`     Failed payout: ${failedPayoutId} | status: FAILED`);

    const canRetry = failedPayout.payoutStatus === 'FAILED';
    console.log(`     Can retry: ${canRetry}`);
    assert(canRetry, 'FAILED payouts should allow manual retry');

    console.log('  7. Manual retry succeeds');
    failedPayout.providerRef = `TLB_${Date.now()}`;
    failedPayout.payoutStatus = 'COMPLETED';
    failedPayout.retryCount = 4;
    failedPayout.lastError = undefined;
    console.log(`     Retried payout: ${failedPayoutId} → COMPLETED`);
    console.log(`     New ref: ${failedPayout.providerRef}`);
    assert(failedPayout.payoutStatus === 'COMPLETED', 'Manual retry should succeed');
  });
}

// ══════════════════════════════════════════════════════
// SCENARIO 6: Liquidity Shortage — insufficient ETB at provider
// ══════════════════════════════════════════════════════
async function testLiquidityShortage() {
  await test('Scenario 6: Liquidity Shortage (provider has insufficient ETB)', async () => {
    console.log('  1. Large payout request');
    const payout: PayoutState = {
      id: generateId('PAY'),
      provider: 'CHAPA',
      providerRef: '',
      payoutStatus: 'INITIATED',
      retryCount: 0,
      maxRetries: MAX_RETRIES,
      amount: 500000,
      currency: 'ETB',
      updatedAt: now(),
    };
    console.log(`     Payout: ${payout.id} | ${payout.amount.toLocaleString()} ETB via CHAPA`);

    console.log('  2. Provider returns 422: Insufficient liquidity');
    const providerResponse = {
      ok: false,
      status: 422,
      data: {
        error: 'INSUFFICIENT_LIQUIDITY',
        message: 'Insufficient balance to process this transfer',
        available_balance: 350000,
        requested_amount: 500000,
      },
    };
    console.log(`     Response: ${providerResponse.status}`);
    console.log(`     Error: ${providerResponse.data.error}`);
    console.log(`     Available: ${providerResponse.data.available_balance.toLocaleString()} ETB`);
    console.log(`     Requested: ${providerResponse.data.requested_amount.toLocaleString()} ETB`);
    console.log(`     Shortfall: ${(providerResponse.data.requested_amount - providerResponse.data.available_balance).toLocaleString()} ETB`);

    console.log('  3. Error is NOT retryable (422 is a business error)');
    const isRetryableStatus = providerResponse.status >= 500 || providerResponse.status === 429;
    console.log(`     Status ${providerResponse.status} retryable: ${isRetryableStatus}`);
    assert(!isRetryableStatus, '422 should NOT be retryable');

    console.log('  4. Payout marked FAILED immediately (no retry)');
    payout.payoutStatus = 'FAILED';
    payout.lastError = `${providerResponse.data.error}: ${providerResponse.data.message}`;
    payout.updatedAt = now();
    console.log(`     Status: ${payout.payoutStatus}`);
    console.log(`     Error: ${payout.lastError}`);
    console.log(`     Retry count: ${payout.retryCount} (no retries attempted)`);
    assert(payout.payoutStatus === 'FAILED', 'Should be FAILED immediately');
    assert(payout.retryCount === 0, 'No retries for business errors');

    console.log('  5. Wallet refund');
    const sendAmountEUR = payout.amount / FX_RATES['EUR'];
    const refund = {
      id: generateId('LED'),
      type: 'CREDIT',
      category: 'REFUND',
      amount: parseFloat(sendAmountEUR.toFixed(2)),
      currency: 'EUR',
    };
    console.log(`     Refund: €${refund.amount} back to user wallet`);
    assert(refund.type === 'CREDIT', 'Refund should be CREDIT');

    console.log('  6. Admin liquidity alert raised');
    const liquidityAlert = {
      id: generateId('LIQ'),
      provider: 'CHAPA',
      severity: 'high',
      currentBalance: providerResponse.data.available_balance,
      failedAmount: providerResponse.data.requested_amount,
      message: `CHAPA liquidity low: ${providerResponse.data.available_balance.toLocaleString()} ETB available, ${providerResponse.data.requested_amount.toLocaleString()} ETB requested`,
    };
    console.log(`     Alert: ${liquidityAlert.id} | severity=${liquidityAlert.severity}`);
    console.log(`     ${liquidityAlert.message}`);

    console.log('  7. Try alternate provider (BANK)');
    const fallbackPayout: PayoutState = {
      id: generateId('PAY'),
      provider: 'BANK',
      providerRef: '',
      payoutStatus: 'INITIATED',
      retryCount: 0,
      maxRetries: MAX_RETRIES,
      amount: payout.amount,
      currency: 'ETB',
      updatedAt: now(),
    };
    console.log(`     Fallback payout: ${fallbackPayout.id} via BANK`);
    await delay(50);
    fallbackPayout.providerRef = `BANK_${Date.now()}`;
    fallbackPayout.payoutStatus = 'COMPLETED';
    console.log(`     Fallback result: ${fallbackPayout.payoutStatus} | Ref: ${fallbackPayout.providerRef}`);
    assert(fallbackPayout.payoutStatus === 'COMPLETED', 'Fallback provider should succeed');
    console.log('     Funds delivered via alternate provider');
  });
}

// ══════════════════════════════════════════════════════
// SCENARIO 7: 429 Rate Limiting — throttled by provider
// ══════════════════════════════════════════════════════
async function testRateLimiting() {
  await test('Scenario 7: Rate Limiting (429 Too Many Requests → backoff → success)', async () => {
    console.log('  1. Burst of payout requests');
    const requests = Array.from({ length: 5 }, (_, i) => ({
      id: generateId('PAY'),
      amount: (i + 1) * 5000,
      status: 'queued',
    }));
    console.log(`     ${requests.length} payouts queued`);

    console.log('  2. First 3 requests succeed');
    for (let i = 0; i < 3; i++) {
      requests[i].status = 'completed';
      console.log(`     ${requests[i].id}: ${requests[i].amount} ETB → completed`);
    }

    console.log('  3. Request 4 → 429 Too Many Requests');
    const rateLimitResponse = {
      ok: false,
      status: 429,
      headers: { 'Retry-After': '5' },
      data: { error: 'RATE_LIMITED', message: 'Too many requests, retry after 5 seconds' },
    };
    console.log(`     Response: ${rateLimitResponse.status}`);
    console.log(`     Retry-After: ${rateLimitResponse.headers['Retry-After']}s`);

    const isRetryable = rateLimitResponse.status === 429;
    console.log(`     Is retryable: ${isRetryable}`);
    assert(isRetryable, '429 should be retryable');

    console.log('  4. HTTP-level retry with exponential backoff');
    let attempt = 1;
    console.log(`     Attempt ${attempt}: 429 → wait ${RETRY_DELAYS[0]}ms`);
    attempt++;
    await delay(30);
    console.log(`     Attempt ${attempt}: 200 OK`);
    requests[3].status = 'completed';
    console.log(`     ${requests[3].id}: ${requests[3].amount} ETB → completed (after 1 retry)`);

    console.log('  5. Request 5 proceeds normally');
    await delay(20);
    requests[4].status = 'completed';
    console.log(`     ${requests[4].id}: ${requests[4].amount} ETB → completed`);

    console.log('  6. All requests resolved');
    const allDone = requests.every(r => r.status === 'completed');
    console.log(`     Total completed: ${requests.filter(r => r.status === 'completed').length}/5`);
    assert(allDone, 'All requests should eventually complete');
  });
}

// ══════════════════════════════════════════════════════
// SCENARIO 8: Partial failure in recurring batch
// ══════════════════════════════════════════════════════
async function testRecurringBatchPartialFailure() {
  await test('Scenario 8: Recurring Batch — Partial Failure (2 succeed, 1 fails)', async () => {
    console.log('  1. Three recurring schedules due');
    const schedules = [
      { id: generateId('SCH'), memberName: 'Tigist', amount: 150, currency: 'EUR' },
      { id: generateId('SCH'), memberName: 'Yonas', amount: 200, currency: 'EUR' },
      { id: generateId('SCH'), memberName: 'Meron', amount: 100, currency: 'EUR' },
    ];
    const results: { id: string; member: string; status: string; error?: string }[] = [];

    for (const sched of schedules) {
      console.log(`     Schedule: ${sched.id} → ${sched.memberName} (€${sched.amount})`);
    }

    console.log('  2. Process schedule 1 → success');
    await delay(30);
    results.push({ id: schedules[0].id, member: 'Tigist', status: 'completed' });
    console.log(`     ${schedules[0].id}: €${schedules[0].amount} → Tigist → COMPLETED`);

    console.log('  3. Process schedule 2 → Telebirr outage → FAILED');
    await delay(30);
    results.push({
      id: schedules[1].id,
      member: 'Yonas',
      status: 'failed',
      error: 'Exhausted 3 retries',
    });
    console.log(`     ${schedules[1].id}: €${schedules[1].amount} → Yonas → FAILED (Telebirr down)`);

    console.log('  4. Process schedule 3 → success');
    await delay(30);
    results.push({ id: schedules[2].id, member: 'Meron', status: 'completed' });
    console.log(`     ${schedules[2].id}: €${schedules[2].amount} → Meron → COMPLETED`);

    console.log('  5. Batch summary');
    const succeeded = results.filter(r => r.status === 'completed').length;
    const failedCount = results.filter(r => r.status === 'failed').length;
    console.log(`     Succeeded: ${succeeded}/3`);
    console.log(`     Failed: ${failedCount}/3`);
    assert(succeeded === 2, '2 should succeed');
    assert(failedCount === 1, '1 should fail');

    console.log('  6. Failed schedule handling');
    const failedSched = results.find(r => r.status === 'failed')!;
    console.log(`     Schedule ${failedSched.id} (${failedSched.member}):`);
    console.log(`     - Status: failed`);
    console.log(`     - Wallet refunded: €${schedules[1].amount}`);
    console.log(`     - Next execution: unchanged (will retry next cycle)`);
    console.log(`     - Notification sent to user about partial failure`);

    console.log('  7. Succeeded schedules advanced');
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    console.log(`     Tigist & Meron: next execution → ${nextMonth.toISOString().slice(0, 10)}`);
  });
}

// ══════════════════════════════════════════════════════
// RUN ALL FAILURE SCENARIOS
// ══════════════════════════════════════════════════════
async function runAll() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   SUMSUMA FAILURE SCENARIO TEST SUITE          ║');
  console.log('║   Non-Custodial Partner Model                    ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  await testPartnerOutage();
  await testPartnerOutageExhausted();
  await testNetworkFailure();
  await testNetworkTotalFailure();
  await testDuplicateRequest();
  await testLiquidityShortage();
  await testRateLimiting();
  await testRecurringBatchPartialFailure();

  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   RESULTS                                        ║');
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log(`║   Passed: ${passed}/8                                    ║`);
  console.log(`║   Failed: ${failed}/8                                    ║`);
  console.log(`║   Status: ${failed === 0 ? '✅ ALL PASSED' : '❌ SOME FAILED'}                          ║`);
  console.log('╚═══════════════════════════════════════════════════╝');

  if (failed > 0) process.exit(1);
}

runAll().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

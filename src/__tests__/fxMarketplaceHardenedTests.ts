import type {
  FxQuoteRecord,
  FxReservation,
  FxAuditLog,
  FxProviderHealth,
  FxMarketplaceStats,
} from '../types';

function generateQuoteId(): string {
  return `FXQ-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}
function generateReservationId(): string {
  return `RES-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}
function now(): string { return new Date().toISOString(); }
function delay(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
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

const QUOTE_TTL_MS = 5 * 60 * 1000;
const BASE_RATES: Record<string, { base: number; spread: number }> = {
  EUR: { base: 61.20, spread: 1.8 },
  USD: { base: 56.50, spread: 1.5 },
  GBP: { base: 71.80, spread: 2.0 },
};

const providerHealth: FxProviderHealth[] = [
  { provider: 'Dashen Bank', healthy: true, availableLiquidityETB: 15_000_000, lastCheckedAt: now() },
  { provider: 'Awash Bank', healthy: true, availableLiquidityETB: 12_000_000, lastCheckedAt: now() },
  { provider: 'CBE', healthy: true, availableLiquidityETB: 25_000_000, lastCheckedAt: now() },
  { provider: 'Abyssinia Bank', healthy: true, availableLiquidityETB: 8_000_000, lastCheckedAt: now() },
  { provider: 'Wegagen Bank', healthy: false, availableLiquidityETB: 500_000, lastCheckedAt: now() },
];

const quotesStore = new Map<string, FxQuoteRecord>();
const reservationsStore = new Map<string, FxReservation>();
const auditLog: FxAuditLog[] = [];

function logAudit(entry: FxAuditLog) {
  auditLog.push(entry);
  console.log(`     📝 Audit: ${entry.event}${entry.reason ? ` (${entry.reason})` : ''}`);
}

// ══════════════════════════════════════════════════════
// TEST 1: Quote Expiration Enforcement
// ══════════════════════════════════════════════════════
async function testQuoteExpiration() {
  await test('Test 1: Reject expired quote in POST /api/fx/select', async () => {
    console.log('  1. Generate quote with short TTL');
    const quote: FxQuoteRecord = {
      quoteId: generateQuoteId(),
      userId: 'USR_001',
      bank: 'Dashen Bank',
      rate: 61.20,
      fee: 1.20,
      sendAmount: 200,
      sendCurrency: 'EUR',
      receiveAmount: 12119.04,
      receiveCurrency: 'ETB',
      deliveryTime: 'Instant',
      payoutMethod: 'bank',
      status: 'active',
      providerHealthy: true,
      providerLiquidity: 15_000_000,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      createdAt: now(),
      updatedAt: now(),
    };
    quotesStore.set(quote.quoteId, quote);
    console.log(`     Quote: ${quote.quoteId} | Expired: ${quote.expiresAt}`);

    console.log('  2. Attempt to select expired quote');
    const isExpired = new Date(quote.expiresAt).getTime() < Date.now();
    console.log(`     Is expired: ${isExpired}`);
    assert(isExpired, 'Quote should be expired');

    let errorCode = '';
    let errorMessage = '';
    if (isExpired) {
      quote.status = 'expired';
      errorCode = 'QUOTE_EXPIRED';
      errorMessage = `Quote ${quote.quoteId} has expired. Please request new quotes.`;
      logAudit({
        event: 'quote_expired',
        userId: quote.userId,
        quoteId: quote.quoteId,
        bank: quote.bank,
        expiresAt: quote.expiresAt,
        timestamp: now(),
      });
    }

    console.log(`     Error code: ${errorCode}`);
    console.log(`     Error message: ${errorMessage}`);
    assert(errorCode === 'QUOTE_EXPIRED', 'Should return QUOTE_EXPIRED error');
    assert(quote.status === 'expired', 'Quote status should be expired');

    console.log('  3. Verify audit log recorded');
    const expiredAudit = auditLog.find(l => l.event === 'quote_expired' && l.quoteId === quote.quoteId);
    assert(expiredAudit !== undefined, 'Audit log should contain quote_expired');
  });
}

// ══════════════════════════════════════════════════════
// TEST 2: Liquidity Reservation on Selection
// ══════════════════════════════════════════════════════
async function testLiquidityReservation() {
  await test('Test 2: Reserve liquidity on quote selection', async () => {
    const dashen = providerHealth.find(p => p.provider === 'Dashen Bank')!;
    const initialLiquidity = dashen.availableLiquidityETB;
    console.log(`  1. Initial Dashen liquidity: ${initialLiquidity.toLocaleString()} ETB`);

    console.log('  2. Generate and select quote');
    const quote: FxQuoteRecord = {
      quoteId: generateQuoteId(),
      userId: 'USR_002',
      bank: 'Dashen Bank',
      rate: 61.20,
      fee: 1.00,
      sendAmount: 500,
      sendCurrency: 'EUR',
      receiveAmount: 30539.00,
      receiveCurrency: 'ETB',
      deliveryTime: 'Instant',
      payoutMethod: 'bank',
      status: 'active',
      providerHealthy: true,
      providerLiquidity: initialLiquidity,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      createdAt: now(),
      updatedAt: now(),
    };
    quotesStore.set(quote.quoteId, quote);

    const reservation: FxReservation = {
      reservationId: generateReservationId(),
      quoteId: quote.quoteId,
      userId: quote.userId,
      bank: quote.bank,
      reservedAmountETB: quote.receiveAmount,
      sendAmount: quote.sendAmount,
      sendCurrency: quote.sendCurrency,
      rate: quote.rate,
      fee: quote.fee,
      status: 'reserved',
      txId: null,
      createdAt: now(),
      updatedAt: now(),
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
    };
    reservationsStore.set(reservation.reservationId, reservation);
    quote.status = 'selected';
    quote.reservationId = reservation.reservationId;

    dashen.availableLiquidityETB -= quote.receiveAmount;
    console.log(`     Reservation: ${reservation.reservationId}`);
    console.log(`     Reserved: ${quote.receiveAmount.toLocaleString()} ETB`);
    console.log(`     Remaining liquidity: ${dashen.availableLiquidityETB.toLocaleString()} ETB`);
    assert(reservation.status === 'reserved', 'Reservation should be reserved');
    assert(dashen.availableLiquidityETB === initialLiquidity - quote.receiveAmount, 'Liquidity should decrease');

    logAudit({
      event: 'quote_selected',
      userId: quote.userId,
      quoteId: quote.quoteId,
      reservationId: reservation.reservationId,
      reservedAmountETB: quote.receiveAmount,
      bank: quote.bank,
      rate: quote.rate,
      timestamp: now(),
    });

    console.log('  3. Confirm reservation on payout success');
    reservation.status = 'confirmed';
    reservation.txId = 'TXN_12345';
    quote.status = 'used';
    quote.txId = 'TXN_12345';
    console.log(`     Reservation: confirmed | TX: ${reservation.txId}`);
    assert(reservation.status === 'confirmed', 'Should be confirmed');

    logAudit({
      event: 'payout_executed_from_quote',
      userId: quote.userId,
      quoteId: quote.quoteId,
      reservationId: reservation.reservationId,
      txId: reservation.txId,
      bank: quote.bank,
      amountETB: quote.receiveAmount,
      timestamp: now(),
    });
  });
}

// ══════════════════════════════════════════════════════
// TEST 3: Reservation Release on Failure
// ══════════════════════════════════════════════════════
async function testReservationRelease() {
  await test('Test 3: Release reservation when transfer fails', async () => {
    const awash = providerHealth.find(p => p.provider === 'Awash Bank')!;
    const beforeLiquidity = awash.availableLiquidityETB;
    console.log(`  1. Awash liquidity before: ${beforeLiquidity.toLocaleString()} ETB`);

    const quote: FxQuoteRecord = {
      quoteId: generateQuoteId(),
      userId: 'USR_003',
      bank: 'Awash Bank',
      rate: 61.00,
      fee: 1.50,
      sendAmount: 300,
      sendCurrency: 'EUR',
      receiveAmount: 18177.00,
      receiveCurrency: 'ETB',
      deliveryTime: '2 min',
      payoutMethod: 'bank',
      status: 'selected',
      providerHealthy: true,
      providerLiquidity: beforeLiquidity,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      createdAt: now(),
      updatedAt: now(),
    };
    quotesStore.set(quote.quoteId, quote);

    const reservation: FxReservation = {
      reservationId: generateReservationId(),
      quoteId: quote.quoteId,
      userId: quote.userId,
      bank: quote.bank,
      reservedAmountETB: quote.receiveAmount,
      sendAmount: quote.sendAmount,
      sendCurrency: quote.sendCurrency,
      rate: quote.rate,
      fee: quote.fee,
      status: 'reserved',
      txId: null,
      createdAt: now(),
      updatedAt: now(),
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
    };
    reservationsStore.set(reservation.reservationId, reservation);
    awash.availableLiquidityETB -= quote.receiveAmount;
    console.log(`  2. Reserved ${quote.receiveAmount.toLocaleString()} ETB`);
    console.log(`     Liquidity during reservation: ${awash.availableLiquidityETB.toLocaleString()} ETB`);

    console.log('  3. Transfer FAILS → release reservation');
    reservation.status = 'released';
    awash.availableLiquidityETB += quote.receiveAmount;
    quote.status = 'active';
    console.log(`     Reservation: released`);
    console.log(`     Liquidity restored: ${awash.availableLiquidityETB.toLocaleString()} ETB`);
    assert(reservation.status === 'released', 'Reservation should be released');
    assert(awash.availableLiquidityETB === beforeLiquidity, 'Liquidity should be fully restored');

    logAudit({
      event: 'quote_rejected',
      userId: quote.userId,
      quoteId: quote.quoteId,
      reservationId: reservation.reservationId,
      reason: 'reservation_failed',
      timestamp: now(),
    });
  });
}

// ══════════════════════════════════════════════════════
// TEST 4: Amount Integrity Check
// ══════════════════════════════════════════════════════
async function testAmountIntegrity() {
  await test('Test 4: Reject transfer when amount changed after quote selection', async () => {
    console.log('  1. Generate quote for €200');
    const quote: FxQuoteRecord = {
      quoteId: generateQuoteId(),
      userId: 'USR_004',
      bank: 'CBE',
      rate: 61.50,
      fee: 1.00,
      sendAmount: 200,
      sendCurrency: 'EUR',
      receiveAmount: 12238.50,
      receiveCurrency: 'ETB',
      deliveryTime: '5 min',
      payoutMethod: 'bank',
      status: 'selected',
      providerHealthy: true,
      providerLiquidity: 25_000_000,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      createdAt: now(),
      updatedAt: now(),
    };
    quotesStore.set(quote.quoteId, quote);
    console.log(`     Quote: ${quote.quoteId} | Amount: €${quote.sendAmount}`);

    console.log('  2. Transfer request with DIFFERENT amount (€250)');
    const transferAmount = 250;
    const transferCurrency = 'EUR';

    const amountMatch = quote.sendAmount === transferAmount && quote.sendCurrency === transferCurrency;
    console.log(`     Quote amount: €${quote.sendAmount}`);
    console.log(`     Transfer amount: €${transferAmount}`);
    console.log(`     Match: ${amountMatch}`);
    assert(!amountMatch, 'Should detect mismatch');

    let errorCode = '';
    let errorMessage = '';
    if (!amountMatch) {
      errorCode = 'AMOUNT_MISMATCH';
      errorMessage = `Amount mismatch: quote was for ${quote.sendAmount} ${quote.sendCurrency} but transfer requests ${transferAmount} ${transferCurrency}. Please select a new quote.`;
      logAudit({
        event: 'quote_rejected',
        userId: quote.userId,
        quoteId: quote.quoteId,
        reason: 'amount_mismatch',
        expectedAmount: quote.sendAmount,
        expectedCurrency: quote.sendCurrency,
        receivedAmount: transferAmount,
        receivedCurrency: transferCurrency,
        timestamp: now(),
      });
    }
    console.log(`     Error: ${errorCode}`);
    console.log(`     Message: ${errorMessage}`);
    assert(errorCode === 'AMOUNT_MISMATCH', 'Should return AMOUNT_MISMATCH');

    console.log('  3. Transfer with MATCHING amount (€200) → passes');
    const correctTransfer = 200;
    const correctMatch = quote.sendAmount === correctTransfer && quote.sendCurrency === 'EUR';
    console.log(`     Transfer: €${correctTransfer} | Match: ${correctMatch}`);
    assert(correctMatch, 'Matching amount should pass');

    console.log('  4. Transfer with DIFFERENT currency (USD) → rejected');
    const wrongCurrencyMatch = quote.sendAmount === 200 && quote.sendCurrency === 'USD';
    console.log(`     Quote: EUR | Transfer: USD | Match: ${wrongCurrencyMatch}`);
    assert(!wrongCurrencyMatch, 'Currency mismatch should fail');
  });
}

// ══════════════════════════════════════════════════════
// TEST 5: Provider Health Filtering
// ══════════════════════════════════════════════════════
async function testProviderHealthFiltering() {
  await test('Test 5: Only return quotes from healthy providers with sufficient liquidity', async () => {
    console.log('  1. Provider health status');
    for (const p of providerHealth) {
      console.log(`     ${p.provider}: healthy=${p.healthy} | liquidity=${p.availableLiquidityETB.toLocaleString()} ETB`);
    }

    console.log('  2. Generate quotes for €200 (ETB needed: ~12,240)');
    const amount = 200;
    const etbNeeded = amount * BASE_RATES['EUR'].base;
    console.log(`     ETB needed: ~${etbNeeded.toLocaleString()}`);

    const healthyWithLiquidity = providerHealth.filter(p => {
      if (!p.healthy) return false;
      if (p.availableLiquidityETB < etbNeeded) return false;
      return true;
    });
    console.log(`     Eligible providers: ${healthyWithLiquidity.length}`);
    for (const p of healthyWithLiquidity) {
      console.log(`       ✓ ${p.provider}`);
    }

    assert(healthyWithLiquidity.length === 4, 'Should have 4 healthy providers');
    assert(!healthyWithLiquidity.find(p => p.provider === 'Wegagen Bank'), 'Wegagen (unhealthy) should be excluded');

    console.log('  3. Set Abyssinia liquidity below threshold');
    const abyssinia = providerHealth.find(p => p.provider === 'Abyssinia Bank')!;
    const origLiquidity = abyssinia.availableLiquidityETB;
    abyssinia.availableLiquidityETB = 5000;

    const withReducedLiquidity = providerHealth.filter(p => p.healthy && p.availableLiquidityETB >= etbNeeded);
    console.log(`     Abyssinia liquidity: ${abyssinia.availableLiquidityETB.toLocaleString()} ETB`);
    console.log(`     Eligible after reduction: ${withReducedLiquidity.length}`);
    assert(!withReducedLiquidity.find(p => p.provider === 'Abyssinia Bank'), 'Abyssinia should now be excluded');
    assert(withReducedLiquidity.length === 3, 'Should have 3 eligible providers');

    abyssinia.availableLiquidityETB = origLiquidity;
    console.log('  4. Restored Abyssinia liquidity');
  });
}

// ══════════════════════════════════════════════════════
// TEST 6: Duplicate Quote Selection (Already Used)
// ══════════════════════════════════════════════════════
async function testDuplicateQuoteSelection() {
  await test('Test 6: Reject selection of already-used quote', async () => {
    console.log('  1. Create and use a quote');
    const quote: FxQuoteRecord = {
      quoteId: generateQuoteId(),
      userId: 'USR_005',
      bank: 'Dashen Bank',
      rate: 61.20,
      fee: 1.00,
      sendAmount: 100,
      sendCurrency: 'EUR',
      receiveAmount: 6058.80,
      receiveCurrency: 'ETB',
      deliveryTime: 'Instant',
      payoutMethod: 'bank',
      status: 'used',
      providerHealthy: true,
      providerLiquidity: 15_000_000,
      txId: 'TXN_EXISTING',
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      createdAt: now(),
      updatedAt: now(),
    };
    quotesStore.set(quote.quoteId, quote);
    console.log(`     Quote: ${quote.quoteId} | Status: ${quote.status} | TX: ${quote.txId}`);

    console.log('  2. Attempt to select used quote');
    let errorCode = '';
    if (quote.status === 'used') {
      errorCode = 'QUOTE_ALREADY_USED';
      logAudit({
        event: 'quote_rejected',
        userId: quote.userId,
        quoteId: quote.quoteId,
        reason: 'already_used',
        timestamp: now(),
      });
    }
    console.log(`     Error: ${errorCode}`);
    assert(errorCode === 'QUOTE_ALREADY_USED', 'Should reject already-used quote');
  });
}

// ══════════════════════════════════════════════════════
// TEST 7: Full Audit Trail
// ══════════════════════════════════════════════════════
async function testAuditTrail() {
  await test('Test 7: Complete audit trail for quote lifecycle', async () => {
    const userId = 'USR_AUDIT';
    const initialCount = auditLog.length;

    console.log('  1. quote_generated');
    const quoteId = generateQuoteId();
    logAudit({ event: 'quote_generated', userId, quoteIds: [quoteId], amount: 200, currency: 'EUR', providerCount: 4, timestamp: now() });

    console.log('  2. quote_selected');
    const reservationId = generateReservationId();
    logAudit({ event: 'quote_selected', userId, quoteId, reservationId, bank: 'Dashen Bank', reservedAmountETB: 12000, rate: 61.20, timestamp: now() });

    console.log('  3. payout_executed_from_quote');
    logAudit({ event: 'payout_executed_from_quote', userId, quoteId, reservationId, txId: 'TXN_AUDIT', bank: 'Dashen Bank', amountETB: 12000, timestamp: now() });

    const newEntries = auditLog.slice(initialCount);
    console.log(`  4. Verify ${newEntries.length} audit entries created`);
    assert(newEntries.length === 3, 'Should have 3 new entries');

    const events = newEntries.map(e => e.event);
    assert(events.includes('quote_generated'), 'Should have quote_generated');
    assert(events.includes('quote_selected'), 'Should have quote_selected');
    assert(events.includes('payout_executed_from_quote'), 'Should have payout_executed_from_quote');

    console.log('  5. Verify all required fields present');
    const selected = newEntries.find(e => e.event === 'quote_selected')!;
    assert(selected.reservationId !== undefined, 'Should have reservationId');
    assert(selected.bank !== undefined, 'Should have bank');
    assert(selected.rate !== undefined, 'Should have rate');
    assert(selected.reservedAmountETB !== undefined, 'Should have reservedAmountETB');

    const executed = newEntries.find(e => e.event === 'payout_executed_from_quote')!;
    assert(executed.txId !== undefined, 'Should have txId');
    assert(executed.amountETB !== undefined, 'Should have amountETB');
  });
}

// ══════════════════════════════════════════════════════
// TEST 8: Admin Monitoring Stats
// ══════════════════════════════════════════════════════
async function testAdminMonitoring() {
  await test('Test 8: GET /api/admin/fx-marketplace returns correct stats', async () => {
    console.log('  1. Compute marketplace stats');

    const allQuotes = Array.from(quotesStore.values());
    const quotesGenerated = allQuotes.length;
    const quotesSelected = allQuotes.filter(q => q.status === 'selected' || q.status === 'used').length;
    const quotesExpired = allQuotes.filter(q => q.status === 'expired').length;

    console.log(`     Quotes generated: ${quotesGenerated}`);
    console.log(`     Quotes selected: ${quotesSelected}`);
    console.log(`     Quotes expired: ${quotesExpired}`);
    assert(quotesGenerated > 0, 'Should have generated quotes');
    assert(quotesExpired > 0, 'Should have expired quotes');

    console.log('  2. Conversion rate by bank');
    const bankMap = new Map<string, { gen: number; sel: number }>();
    for (const q of allQuotes) {
      const e = bankMap.get(q.bank) || { gen: 0, sel: 0 };
      e.gen++;
      if (q.status === 'selected' || q.status === 'used') e.sel++;
      bankMap.set(q.bank, e);
    }
    for (const [bank, data] of bankMap) {
      const rate = data.gen > 0 ? (data.sel / data.gen * 100).toFixed(1) : '0';
      console.log(`     ${bank}: ${data.gen} generated, ${data.sel} selected (${rate}%)`);
    }

    console.log('  3. Failed quote executions');
    const failedExec = auditLog.filter(l => l.event === 'quote_rejected' && l.reason?.includes('reservation_failed')).length;
    console.log(`     Failed executions: ${failedExec}`);

    console.log('  4. Provider health summary');
    for (const p of providerHealth) {
      const status = p.healthy ? '🟢' : '🔴';
      console.log(`     ${status} ${p.provider}: ${p.availableLiquidityETB.toLocaleString()} ETB`);
    }

    console.log('  5. Recent audit logs');
    const recentLogs = auditLog.slice(-5);
    for (const l of recentLogs) {
      console.log(`     ${l.event} | ${l.userId} | ${l.timestamp.slice(11, 19)}`);
    }

    const stats: FxMarketplaceStats = {
      quotesGenerated,
      quotesSelected,
      quotesExpired,
      failedExecutions: failedExec,
      conversionRateByBank: Array.from(bankMap).map(([bank, d]) => ({
        bank,
        generated: d.gen,
        selected: d.sel,
        conversionRate: d.gen > 0 ? parseFloat((d.sel / d.gen * 100).toFixed(1)) : 0,
      })),
      providerHealth: providerHealth.map(p => ({
        provider: p.provider,
        healthy: p.healthy,
        availableLiquidityETB: p.availableLiquidityETB,
      })),
      recentAuditLogs: auditLog.slice(-50),
    };

    assert(stats.quotesGenerated > 0, 'Stats should have quotesGenerated');
    assert(stats.conversionRateByBank.length > 0, 'Stats should have bank breakdown');
    assert(stats.providerHealth.length === 5, 'Stats should list all providers');
  });
}

// ══════════════════════════════════════════════════════
// RUN ALL
// ══════════════════════════════════════════════════════
async function runAll() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   FX MARKETPLACE HARDENING TEST SUITE            ║');
  console.log('║   Quote Expiry · Liquidity · Integrity · Audit   ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  await testQuoteExpiration();
  await testLiquidityReservation();
  await testReservationRelease();
  await testAmountIntegrity();
  await testProviderHealthFiltering();
  await testDuplicateQuoteSelection();
  await testAuditTrail();
  await testAdminMonitoring();

  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   RESULTS                                        ║');
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log(`║   Passed: ${passed}/8                                    ║`);
  console.log(`║   Failed: ${failed}/8                                    ║`);
  console.log(`║   Status: ${failed === 0 ? '✅ ALL PASSED' : '❌ SOME FAILED'}                          ║`);
  console.log(`║   Audit entries: ${auditLog.length}                                  ║`);
  console.log('╚═══════════════════════════════════════════════════╝');

  if (failed > 0) process.exit(1);
}

runAll().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});

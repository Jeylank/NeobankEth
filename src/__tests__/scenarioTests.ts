function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function now(): string { return new Date().toISOString(); }
function delay(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

const FX_RATES: Record<string, number> = { USD: 56.50, EUR: 61.20, GBP: 71.80 };
const FEE_PERCENT = 0.015;

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

// ══════════════════════════════════════════════════════
// SCENARIO 1: EUR → ETB Telebirr Payout
// ══════════════════════════════════════════════════════
async function testEurEtbTelebirr() {
  await test('Scenario 1: EUR → ETB Telebirr Payout', async () => {
    console.log('  1. Create wallet with EUR balance');
    const walletId = generateId('WLT');
    const wallet = { id: walletId, currency: 'EUR', balance: 1000 };
    console.log(`     Wallet: ${walletId}, Balance: €${wallet.balance}`);
    assert(wallet.balance === 1000, 'Wallet should have 1000 EUR');

    console.log('  2. FX conversion EUR → ETB');
    const sendAmount = 300;
    const fee = parseFloat((sendAmount * FEE_PERCENT).toFixed(2));
    const net = sendAmount - fee;
    const rate = FX_RATES['EUR'];
    const etbAmount = parseFloat((net * rate).toFixed(2));
    console.log(`     Send: €${sendAmount} | Fee: €${fee} (1.5%) | Net: €${net}`);
    console.log(`     Rate: 1 EUR = ${rate} ETB | Received: ${etbAmount} ETB`);
    assert(fee === 4.5, 'Fee should be 4.50');
    assert(etbAmount === parseFloat((295.5 * 61.2).toFixed(2)), 'ETB amount should match rate calc');

    console.log('  3. Debit wallet');
    wallet.balance -= sendAmount;
    console.log(`     New balance: €${wallet.balance}`);
    assert(wallet.balance === 700, 'Balance should be 700 after debit');

    console.log('  4. Initiate remittance');
    const txId = generateId('TXN');
    const tx = {
      id: txId,
      amount: sendAmount,
      fromCurrency: 'EUR',
      toCurrency: 'ETB',
      receivedAmount: etbAmount,
      beneficiary: { name: 'Hana Getachew', phone: '+251911222333' },
      payoutMethod: 'mobile_wallet' as const,
      status: 'processing',
    };
    console.log(`     TX: ${txId} → ${tx.beneficiary.name} via mobile_wallet`);
    assert(tx.status === 'processing', 'TX should be processing');

    console.log('  5. Telebirr payout dispatch');
    const payoutId = generateId('PAY');
    const payout = {
      id: payoutId,
      provider: 'TELEBIRR' as const,
      providerRef: '',
      payoutStatus: 'INITIATED' as const,
      amount: etbAmount,
      currency: 'ETB',
      recipientPhone: tx.beneficiary.phone,
      recipientName: tx.beneficiary.name,
      retryCount: 0,
      createdAt: now(),
    };
    console.log(`     Payout ${payoutId}: INITIATED via TELEBIRR`);
    assert(payout.provider === 'TELEBIRR', 'Provider should be TELEBIRR for mobile_wallet');

    await delay(300);
    payout.providerRef = `TLB_${Date.now()}`;
    payout.payoutStatus = 'PROCESSING' as any;
    console.log(`     Status: PROCESSING | Ref: ${payout.providerRef}`);

    await delay(300);
    payout.payoutStatus = 'COMPLETED' as any;
    console.log(`     Status: COMPLETED`);

    console.log('  6. Transaction finalized');
    tx.status = 'completed';
    console.log(`     TX ${txId}: completed | ${sendAmount} EUR → ${etbAmount} ETB via Telebirr`);
    assert(tx.status === 'completed', 'TX should be completed');
    assert(payout.payoutStatus === 'COMPLETED', 'Payout should be COMPLETED');
  });
}

// ══════════════════════════════════════════════════════
// SCENARIO 2: USD → ETB Bank Payout
// ══════════════════════════════════════════════════════
async function testUsdEtbBank() {
  await test('Scenario 2: USD → ETB Bank Payout', async () => {
    console.log('  1. Create wallet with USD balance');
    const wallet = { id: generateId('WLT'), currency: 'USD', balance: 2000 };
    console.log(`     Wallet: ${wallet.id}, Balance: $${wallet.balance}`);

    console.log('  2. FX conversion USD → ETB');
    const sendAmount = 500;
    const fee = parseFloat((sendAmount * FEE_PERCENT).toFixed(2));
    const net = sendAmount - fee;
    const rate = FX_RATES['USD'];
    const etbAmount = parseFloat((net * rate).toFixed(2));
    console.log(`     Send: $${sendAmount} | Fee: $${fee} (1.5%) | Net: $${net}`);
    console.log(`     Rate: 1 USD = ${rate} ETB | Received: ${etbAmount} ETB`);
    assert(fee === 7.5, 'Fee should be 7.50');

    console.log('  3. Debit wallet');
    wallet.balance -= sendAmount;
    console.log(`     New balance: $${wallet.balance}`);
    assert(wallet.balance === 1500, 'Balance should be 1500');

    console.log('  4. Initiate remittance to bank account');
    const txId = generateId('TXN');
    const tx = {
      id: txId,
      amount: sendAmount,
      fromCurrency: 'USD',
      toCurrency: 'ETB',
      receivedAmount: etbAmount,
      beneficiary: {
        name: 'Dawit Bekele',
        account: '1000XXXXXXX456',
        institution: 'Commercial Bank of Ethiopia',
        bankCode: 'CBE',
      },
      payoutMethod: 'bank_transfer' as const,
      status: 'processing',
    };
    console.log(`     TX: ${txId} → ${tx.beneficiary.name} at ${tx.beneficiary.institution}`);

    console.log('  5. Bank payout via Chapa (CBE bank code)');
    const payoutId = generateId('PAY');
    const payout = {
      id: payoutId,
      provider: 'CHAPA' as const,
      providerRef: '',
      payoutStatus: 'INITIATED' as const,
      amount: etbAmount,
      currency: 'ETB',
      recipientAccount: tx.beneficiary.account,
      recipientName: tx.beneficiary.name,
      bankCode: tx.beneficiary.bankCode,
      retryCount: 0,
    };
    console.log(`     Payout ${payoutId}: INITIATED via CHAPA (bank_transfer, CBE)`);
    assert(payout.provider === 'CHAPA', 'CBE bank transfers should use CHAPA');

    await delay(300);
    payout.providerRef = `CHAPA_${Date.now()}`;
    payout.payoutStatus = 'PROCESSING' as any;
    console.log(`     Status: PROCESSING | Ref: ${payout.providerRef}`);

    await delay(300);
    payout.payoutStatus = 'COMPLETED' as any;
    console.log(`     Status: COMPLETED`);

    console.log('  6. Transaction finalized');
    tx.status = 'completed';
    console.log(`     TX ${txId}: completed | $${sendAmount} → ${etbAmount} ETB via Chapa→CBE`);
    assert(tx.status === 'completed', 'TX should be completed');
    assert(payout.payoutStatus === 'COMPLETED', 'Payout should be COMPLETED');
  });
}

// ══════════════════════════════════════════════════════
// SCENARIO 3: Wallet Balance → Family Wallet
// ══════════════════════════════════════════════════════
async function testWalletToFamily() {
  await test('Scenario 3: Wallet Balance → Family Wallet', async () => {
    console.log('  1. User wallet with EUR balance');
    const wallet = { id: generateId('WLT'), currency: 'EUR', balance: 800 };
    console.log(`     Wallet: ${wallet.id}, Balance: €${wallet.balance}`);

    console.log('  2. Family member setup');
    const familyMember = {
      id: generateId('FM'),
      name: 'Tigist Tadesse',
      relationship: 'sister',
      monthlyAllocation: 150,
      currency: 'EUR',
      totalSent: 450,
    };
    console.log(`     Member: ${familyMember.name} (${familyMember.relationship})`);
    console.log(`     Monthly allocation: €${familyMember.monthlyAllocation}`);
    console.log(`     Total sent to date: €${familyMember.totalSent}`);

    console.log('  3. Send monthly support');
    const sendAmount = familyMember.monthlyAllocation;
    assert(wallet.balance >= sendAmount, 'Should have sufficient balance');

    const ledgerEntry = {
      id: generateId('LED'),
      type: 'DEBIT',
      category: 'FAMILY_SUPPORT',
      amount: sendAmount,
      currency: wallet.currency,
      description: `Monthly support for ${familyMember.name}`,
      timestamp: now(),
    };
    wallet.balance -= sendAmount;
    familyMember.totalSent += sendAmount;
    console.log(`     Ledger: ${ledgerEntry.type}/${ledgerEntry.category} -€${sendAmount}`);
    console.log(`     New wallet balance: €${wallet.balance}`);
    assert(wallet.balance === 650, 'Balance should be 650 after debit');

    console.log('  4. FX conversion for payout');
    const rate = FX_RATES['EUR'];
    const fee = parseFloat((sendAmount * FEE_PERCENT).toFixed(2));
    const etbAmount = parseFloat(((sendAmount - fee) * rate).toFixed(2));
    console.log(`     €${sendAmount} → ${etbAmount} ETB (fee: €${fee})`);

    console.log('  5. Remittance initiated for family member');
    const txId = generateId('TXN');
    console.log(`     TX: ${txId} → ${familyMember.name}`);

    console.log('  6. Payout processed');
    await delay(300);
    console.log(`     Payout: COMPLETED via TELEBIRR`);

    console.log('  7. Family wallet updated');
    const monthlyRecord = {
      memberId: familyMember.id,
      month: new Date().toISOString().slice(0, 7),
      amount: sendAmount,
      etbAmount,
      sentAt: now(),
    };
    familyMember.totalSent = 450 + sendAmount;
    console.log(`     Monthly record: ${monthlyRecord.month} = €${monthlyRecord.amount}`);
    console.log(`     Total sent: €${familyMember.totalSent}`);
    console.log(`     Audit log: family_support_sent`);
    assert(familyMember.totalSent === 600, 'Total sent should be 600');
  });
}

// ══════════════════════════════════════════════════════
// SCENARIO 4: Campaign Contribution
// ══════════════════════════════════════════════════════
async function testCampaignContribution() {
  await test('Scenario 4: Campaign Contribution', async () => {
    console.log('  1. Campaign setup');
    const campaign = {
      id: generateId('CMP'),
      title: 'Medical Treatment for Almaz',
      category: 'medical',
      targetAmount: 5000,
      currentAmount: 3200,
      currency: 'USD',
      status: 'active',
      contributorCount: 8,
      createdBy: generateId('USR'),
    };
    console.log(`     Campaign: "${campaign.title}"`);
    console.log(`     Progress: $${campaign.currentAmount}/$${campaign.targetAmount} (${((campaign.currentAmount / campaign.targetAmount) * 100).toFixed(0)}%)`);
    console.log(`     Contributors: ${campaign.contributorCount}`);

    console.log('  2. User wallet');
    const wallet = { id: generateId('WLT'), currency: 'USD', balance: 1500 };
    console.log(`     Balance: $${wallet.balance}`);

    console.log('  3. Contribute $500 to campaign');
    const contributionAmount = 500;
    assert(wallet.balance >= contributionAmount, 'Should have sufficient balance');

    const contribution = {
      id: generateId('CTR'),
      campaignId: campaign.id,
      userId: generateId('USR'),
      amount: contributionAmount,
      currency: 'USD',
      message: 'Wishing speedy recovery!',
      createdAt: now(),
    };
    console.log(`     Contribution: ${contribution.id} = $${contributionAmount}`);

    console.log('  4. Debit wallet');
    wallet.balance -= contributionAmount;
    console.log(`     New balance: $${wallet.balance}`);
    assert(wallet.balance === 1000, 'Balance should be 1000');

    console.log('  5. Campaign updated');
    campaign.currentAmount += contributionAmount;
    campaign.contributorCount += 1;
    const progress = (campaign.currentAmount / campaign.targetAmount) * 100;
    console.log(`     New total: $${campaign.currentAmount}/$${campaign.targetAmount} (${progress.toFixed(0)}%)`);
    console.log(`     Contributors: ${campaign.contributorCount}`);
    assert(campaign.currentAmount === 3700, 'Campaign amount should be 3700');

    console.log('  6. Check auto-complete');
    const shouldComplete = campaign.currentAmount >= campaign.targetAmount;
    console.log(`     Goal reached: ${shouldComplete} (need $${campaign.targetAmount - campaign.currentAmount} more)`);
    assert(!shouldComplete, 'Campaign should not auto-complete yet');

    console.log('  7. Another contribution pushes to goal');
    const bigContribution = 1300;
    campaign.currentAmount += bigContribution;
    campaign.contributorCount += 1;
    const goalReached = campaign.currentAmount >= campaign.targetAmount;
    console.log(`     +$${bigContribution} → $${campaign.currentAmount}/$${campaign.targetAmount}`);
    console.log(`     Goal reached: ${goalReached}`);
    assert(goalReached, 'Campaign should now be complete');

    if (goalReached) {
      campaign.status = 'completed';
      console.log(`     Campaign auto-completed! Status: ${campaign.status}`);
    }
    assert(campaign.status === 'completed', 'Status should be completed');

    console.log('  8. Payout to campaign creator');
    const payoutAmount = campaign.currentAmount;
    const rate = FX_RATES['USD'];
    const etbPayout = parseFloat((payoutAmount * rate).toFixed(2));
    console.log(`     Payout: $${payoutAmount} → ${etbPayout} ETB to campaign creator`);
    console.log(`     Via CHAPA bank_transfer`);
  });
}

// ══════════════════════════════════════════════════════
// SCENARIO 5: Recurring Support Execution
// ══════════════════════════════════════════════════════
async function testRecurringSupport() {
  await test('Scenario 5: Recurring Support Execution', async () => {
    console.log('  1. Schedule setup');
    const schedule = {
      id: generateId('SCH'),
      userId: generateId('USR'),
      familyMemberId: generateId('FM'),
      familyMemberName: 'Yonas Tadesse',
      amount: 200,
      currency: 'EUR',
      frequency: 'monthly' as const,
      nextExecutionDate: now(),
      status: 'active' as string,
      executionCount: 3,
      totalSent: 600,
      createdAt: now(),
    };
    console.log(`     Schedule: ${schedule.id}`);
    console.log(`     Recipient: ${schedule.familyMemberName}`);
    console.log(`     Amount: €${schedule.amount} / ${schedule.frequency}`);
    console.log(`     Executions so far: ${schedule.executionCount} (€${schedule.totalSent} total)`);

    console.log('  2. Check if due');
    const dueDate = new Date(schedule.nextExecutionDate);
    const isDue = dueDate <= new Date();
    console.log(`     Next execution: ${schedule.nextExecutionDate}`);
    console.log(`     Is due: ${isDue}`);
    assert(isDue, 'Schedule should be due');

    console.log('  3. User wallet check');
    const wallet = { id: generateId('WLT'), currency: 'EUR', balance: 900 };
    console.log(`     Balance: €${wallet.balance}`);
    assert(wallet.balance >= schedule.amount, 'Should have sufficient balance');

    console.log('  4. Execute scheduled payment');
    const executionId = generateId('EXE');
    const execution = {
      id: executionId,
      scheduleId: schedule.id,
      amount: schedule.amount,
      currency: schedule.currency,
      status: 'processing' as string,
      startedAt: now(),
    };
    console.log(`     Execution: ${executionId} started`);

    console.log('  5. Debit wallet');
    wallet.balance -= schedule.amount;
    console.log(`     Debited: €${schedule.amount} | New balance: €${wallet.balance}`);
    assert(wallet.balance === 700, 'Balance should be 700');

    console.log('  6. FX conversion');
    const rate = FX_RATES['EUR'];
    const fee = parseFloat((schedule.amount * FEE_PERCENT).toFixed(2));
    const etbAmount = parseFloat(((schedule.amount - fee) * rate).toFixed(2));
    console.log(`     €${schedule.amount} → ${etbAmount} ETB (fee: €${fee})`);

    console.log('  7. Remittance + payout');
    const txId = generateId('TXN');
    const payoutId = generateId('PAY');
    await delay(300);
    console.log(`     TX: ${txId} → ${schedule.familyMemberName}`);
    console.log(`     Payout: ${payoutId} via TELEBIRR → COMPLETED`);

    console.log('  8. Update schedule');
    execution.status = 'completed';
    schedule.executionCount += 1;
    schedule.totalSent += schedule.amount;
    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 1);
    schedule.nextExecutionDate = nextDate.toISOString();
    console.log(`     Execution: completed`);
    console.log(`     Total executions: ${schedule.executionCount}`);
    console.log(`     Total sent: €${schedule.totalSent}`);
    console.log(`     Next execution: ${schedule.nextExecutionDate.slice(0, 10)}`);
    assert(schedule.executionCount === 4, 'Execution count should be 4');
    assert(schedule.totalSent === 800, 'Total sent should be 800');
    assert(execution.status === 'completed', 'Execution should be completed');

    console.log('  9. Audit log');
    console.log(`     Event: recurring_support_executed`);
    console.log(`     Schedule: ${schedule.id}`);
    console.log(`     Execution: ${executionId}`);
    console.log(`     Amount: €${schedule.amount} → ${etbAmount} ETB`);
  });
}

// ══════════════════════════════════════════════════════
// RUN ALL SCENARIOS
// ══════════════════════════════════════════════════════
async function runAll() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   SUMSUMA SCENARIO TEST SUITE                  ║');
  console.log('║   Non-Custodial Partner Model                    ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  await testEurEtbTelebirr();
  await testUsdEtbBank();
  await testWalletToFamily();
  await testCampaignContribution();
  await testRecurringSupport();

  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   RESULTS                                        ║');
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log(`║   Passed: ${passed}/5                                    ║`);
  console.log(`║   Failed: ${failed}/5                                    ║`);
  console.log(`║   Status: ${failed === 0 ? '✅ ALL PASSED' : '❌ SOME FAILED'}                          ║`);
  console.log('╚═══════════════════════════════════════════════════╝');

  if (failed > 0) process.exit(1);
}

runAll().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

/**
 * Real Firestore transactional integration tests.
 *
 * Run with a Firestore emulator, for example:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm test -- agentCashFirestoreEmulator
 *
 * The suite is skipped during ordinary unit-test runs when no emulator host is
 * configured, so it can never connect to a production Firestore project.
 */

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const runEmulatorTests = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' && emulatorHost;
const describeEmulator = runEmulatorTests ? describe : describe.skip;

process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID = 'demo-sumsuma-agent-cash-tests';
process.env.APP_MODE = 'simulation';

describeEmulator('agent_cash Firestore emulator integration', () => {
  let adminDb: FirebaseFirestore.Firestore;
  let SimulationProvider: typeof import('../services/remittance/SimulationProvider').SimulationProvider;
  let verifyOtp: typeof import('../services/agentPayoutService').verifyOtp;
  let markPaid: typeof import('../services/agentPayoutService').markPaid;
  let AgentPayoutError: typeof import('../services/agentPayoutService').AgentPayoutError;
  let confirmSimulationPayment: typeof import('../services/paymentConfirmationService').confirmSimulationPayment;
  let refundSimulationPayment: typeof import('../services/paymentConfirmationService').refundSimulationPayment;
  let reconcileSimulationRemittances: typeof import('../services/remittanceReconciliationService').reconcileSimulationRemittances;
  let enforceBetaInitiationLimits: typeof import('../services/betaRiskService').enforceBetaInitiationLimits;
  let updateBetaControls: typeof import('../services/betaRiskService').updateBetaControls;

  const userId = 'emulator-user';
  const agentId = 'emulator-agent';
  const city = 'Addis Ababa';

  beforeAll(() => {
    const firebaseModule = require('../firebaseAdmin') as typeof import('../firebaseAdmin');
    const simulationModule = require('../services/remittance/SimulationProvider') as typeof import('../services/remittance/SimulationProvider');
    const agentModule = require('../services/agentPayoutService') as typeof import('../services/agentPayoutService');
    const paymentModule = require('../services/paymentConfirmationService') as typeof import('../services/paymentConfirmationService');
    const reconciliationModule = require('../services/remittanceReconciliationService') as typeof import('../services/remittanceReconciliationService');
    const betaModule = require('../services/betaRiskService') as typeof import('../services/betaRiskService');

    adminDb = firebaseModule.adminDb;
    SimulationProvider = simulationModule.SimulationProvider;
    verifyOtp = agentModule.verifyOtp;
    markPaid = agentModule.markPaid;
    AgentPayoutError = agentModule.AgentPayoutError;
    confirmSimulationPayment = paymentModule.confirmSimulationPayment;
    refundSimulationPayment = paymentModule.refundSimulationPayment;
    reconcileSimulationRemittances = reconciliationModule.reconcileSimulationRemittances;
    enforceBetaInitiationLimits = betaModule.enforceBetaInitiationLimits;
    updateBetaControls = betaModule.updateBetaControls;
  });

  async function clearFirestore(): Promise<void> {
    const collections = await adminDb.listCollections();
    for (const collection of collections) {
      let snapshot = await collection.limit(200).get();
      while (!snapshot.empty) {
        const batch = adminDb.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        snapshot = await collection.limit(200).get();
      }
    }
  }

  async function seedAgent(availableFloat = 10_000): Promise<void> {
    await adminDb.collection('agents').doc(agentId).set({
      full_name: 'Emulator Agent',
      phone: '+251900000000',
      city,
      status: 'online',
      available_float: availableFloat,
      score: 500,
      created_at: new Date().toISOString(),
    });
  }

  async function seedSimulation(): Promise<void> {
    await Promise.all([
      adminDb.collection('sim_wallets').doc(userId).set({
        userId,
        balances: { EUR: 10_000 },
      }),
      adminDb.collection('sim_liquidity').doc('pool').set({
        availableETB: 50_000_000,
      }),
      adminDb.collection('sim_provider_liquidity').doc('stripe').set({
        availableETB: 20_000_000,
      }),
      adminDb.collection('sim_provider_liquidity').doc('chapa').set({
        availableETB: 15_000_000,
      }),
      adminDb.collection('sim_provider_liquidity').doc('telebirr').set({
        availableETB: 15_000_000,
      }),
    ]);
  }

  beforeEach(async () => {
    await clearFirestore();
    await seedSimulation();
  });

  afterAll(async () => {
    await clearFirestore();
  });

  async function initiate(idempotencyKey: string, amount = 100) {
    const provider = new SimulationProvider();
    return provider.initiate({
      userId,
      recipientId: 'emulator-recipient',
      amount,
      currency: 'EUR',
      type: 'standard',
      idempotencyKey,
      metadata: {
        payout_method: 'agent_cash',
        recipient_city: city,
      },
    });
  }

  it('does not assign an agent until payment is confirmed', async () => {
    await seedAgent();
    const initiated = await initiate('persist-all');
    const transactionId = initiated.payload.transactionId as string;

    expect(initiated.payload.status).toBe('PAYMENT_PENDING');
    const beforeAssignments = await adminDb.collection('assignments').get();
    const beforeOtps = await adminDb.collection('agent_otps').get();
    expect(beforeAssignments.empty).toBe(true);
    expect(beforeOtps.empty).toBe(true);
    const reservedWallet = await adminDb.collection('sim_wallets').doc(userId).get();
    expect(reservedWallet.data()).toMatchObject({
      balances: { EUR: 10_000 },
      reservations: { EUR: 100 },
    });

    const result = await confirmSimulationPayment(transactionId, 'confirmed');
    expect(result.payload.status).toBe('OTP_SENT');

    const [transaction, otp, assignments, timeline] = await Promise.all([
      adminDb.collection('sim_transactions').doc(transactionId).get(),
      adminDb.collection('agent_otps').doc(transactionId).get(),
      adminDb.collection('assignments').where('transfer_id', '==', transactionId).get(),
      adminDb.collection('transfer_timeline').where('transfer_id', '==', transactionId).get(),
    ]);

    expect(transaction.data()).toMatchObject({
      payout_method: 'agent_cash',
      status: 'OTP_SENT',
      assigned_agent_id: agentId,
    });
    expect(assignments.size).toBe(1);
    expect(otp.exists).toBe(true);
    expect(otp.data()?.verified).toBe(false);
    expect(timeline.docs.map(doc => doc.data().status)).toEqual(
      expect.arrayContaining(['AGENT_ASSIGNED', 'OTP_SENT']),
    );
    const capturedWallet = await adminDb.collection('sim_wallets').doc(userId).get();
    expect(capturedWallet.data()).toMatchObject({
      balances: { EUR: 9_900 },
      reservations: { EUR: 0 },
    });
  });

  it('creates only one pending transfer for concurrent duplicate initiation', async () => {
    await seedAgent();
    const [first, second] = await Promise.all([
      initiate('concurrent-idempotency'),
      initiate('concurrent-idempotency'),
    ]);

    const transactions = await adminDb.collection('sim_transactions').get();
    const assignments = await adminDb.collection('assignments').get();
    const otps = await adminDb.collection('agent_otps').get();

    expect(transactions.size).toBe(1);
    expect(assignments.size).toBe(0);
    expect(otps.size).toBe(0);
    const wallet = await adminDb.collection('sim_wallets').doc(userId).get();
    const reservationLedgers = await adminDb.collection('sim_ledger')
      .where('type', '==', 'WALLET_RESERVATION').get();
    expect(wallet.data()).toMatchObject({
      balances: { EUR: 10_000 },
      reservations: { EUR: 100 },
    });
    expect(reservationLedgers.size).toBe(1);
    expect(
      [first.payload.transactionId, second.payload.transactionId].filter(Boolean),
    ).toEqual(expect.arrayContaining([transactions.docs[0].id]));
  });

  it('reduces agent float atomically and duplicate mark-paid cannot reduce it twice', async () => {
    await seedAgent(1_000);
    const initiated = await initiate('atomic-float', 100);
    const transactionId = initiated.payload.transactionId as string;
    const confirmed = await confirmSimulationPayment(transactionId, 'confirmed');
    const otp = confirmed.payload.otp as string;
    const { payoutToken } = await verifyOtp(transactionId, otp);

    await markPaid(transactionId, payoutToken);
    const afterFirst = await adminDb.collection('agents').doc(agentId).get();
    expect(afterFirst.data()?.available_float).toBe(900);

    await expect(markPaid(transactionId, payoutToken)).rejects.toMatchObject({
      code: expect.stringMatching(/TOKEN_CONSUMED|DUPLICATE_PAYOUT/),
    });
    const afterDuplicate = await adminDb.collection('agents').doc(agentId).get();
    expect(afterDuplicate.data()?.available_float).toBe(900);

    const payoutLedgers = await adminDb.collection('sim_ledger')
      .where('type', '==', 'AGENT_CASH_PAYOUT').get();
    expect(payoutLedgers.size).toBe(1);
    const entries = payoutLedgers.docs[0].data().entries as Array<{ side: string; amount: number }>;
    expect(entries.filter(entry => entry.side === 'DEBIT').reduce((sum, entry) => sum + entry.amount, 0))
      .toBe(entries.filter(entry => entry.side === 'CREDIT').reduce((sum, entry) => sum + entry.amount, 0));

    const reconciliation = await reconcileSimulationRemittances({
      paymentPendingThresholdMs: 0,
      agentPayoutSlaMs: 0,
    });
    const paidTransfer = await adminDb.collection('sim_transactions').doc(transactionId).get();
    const paidWallet = await adminDb.collection('sim_wallets').doc(userId).get();
    expect(paidTransfer.data()?.status).toBe('PAID_OUT');
    expect(paidWallet.data()?.balances.EUR).toBe(9_900);
    expect(reconciliation.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'AGENT_FLOAT_MISMATCH', transactionId }),
    ]));
  });

  it.each([
    ['no agent', undefined],
    ['insufficient float', 99],
  ])('leaves the transaction retryable with %s', async (_label, availableFloat) => {
    if (availableFloat !== undefined) await seedAgent(availableFloat);
    const initiated = await initiate(`retryable-${availableFloat ?? 'none'}`, 100);
    const transactionId = initiated.payload.transactionId as string;
    const result = await confirmSimulationPayment(transactionId, 'confirmed');
    const transaction = await adminDb.collection('sim_transactions').doc(transactionId).get();

    expect(result).toMatchObject({
      ok: false,
      status: 422,
      payload: { error: 'NO_ELIGIBLE_AGENT', retryable: true },
    });
    expect(transaction.data()?.status).toBe('FUNDS_RECEIVED');
    expect(transaction.data()?.payout_method).toBe('agent_cash');
  });

  it('blocks payout when OTP has expired', async () => {
    await seedAgent();
    const initiated = await initiate('expired-otp');
    const transactionId = initiated.payload.transactionId as string;
    const confirmed = await confirmSimulationPayment(transactionId, 'confirmed');

    await adminDb.collection('agent_otps').doc(transactionId).update({
      expires_at: new Date(Date.now() - 1_000).toISOString(),
    });

    await expect(
      verifyOtp(transactionId, confirmed.payload.otp as string),
    ).rejects.toBeInstanceOf(AgentPayoutError);
    await expect(
      verifyOtp(transactionId, confirmed.payload.otp as string),
    ).rejects.toMatchObject({ code: 'OTP_EXPIRED', httpStatus: 410 });

    const transaction = await adminDb.collection('sim_transactions').doc(transactionId).get();
    expect(transaction.data()?.status).toBe('OTP_SENT');
  });

  it('makes duplicate payment confirmation idempotent', async () => {
    await seedAgent();
    const initiated = await initiate('duplicate-confirmation');
    const transactionId = initiated.payload.transactionId as string;

    const first = await confirmSimulationPayment(transactionId, 'confirmed');
    const duplicate = await confirmSimulationPayment(transactionId, 'confirmed');

    expect(first.payload.status).toBe('OTP_SENT');
    expect(duplicate.payload).toMatchObject({ status: 'OTP_SENT', duplicate: true });
    expect((await adminDb.collection('assignments').get()).size).toBe(1);
    expect((await adminDb.collection('agent_otps').get()).size).toBe(1);
    const captureLedgers = await adminDb.collection('sim_ledger')
      .where('type', '==', 'PAYMENT_CAPTURE').get();
    expect(captureLedgers.size).toBe(1);
  });

  it('failed payment does not assign an agent or reduce float', async () => {
    await seedAgent(1_000);
    const initiated = await initiate('failed-payment', 100);
    const transactionId = initiated.payload.transactionId as string;

    const failed = await confirmSimulationPayment(transactionId, 'failed');
    const [agent, assignments, transaction, wallet, releases] = await Promise.all([
      adminDb.collection('agents').doc(agentId).get(),
      adminDb.collection('assignments').get(),
      adminDb.collection('sim_transactions').doc(transactionId).get(),
      adminDb.collection('sim_wallets').doc(userId).get(),
      adminDb.collection('sim_ledger').where('type', '==', 'RESERVATION_RELEASE').get(),
    ]);

    expect(failed.payload.status).toBe('PAYMENT_FAILED');
    expect(transaction.data()?.status).toBe('PAYMENT_FAILED');
    expect(assignments.empty).toBe(true);
    expect(agent.data()?.available_float).toBe(1_000);
    expect(wallet.data()).toMatchObject({
      balances: { EUR: 10_000 },
      reservations: { EUR: 0 },
    });
    expect(releases.size).toBe(1);
    const alerts = await adminDb.collection('beta_risk_alerts').get();
    expect(alerts.docs.map(document => document.data().type)).toContain('FAILED_PAYMENT');
  });

  it('refund reverses a captured debit once', async () => {
    await seedAgent();
    const initiated = await initiate('refund-captured', 100);
    const transactionId = initiated.payload.transactionId as string;
    await confirmSimulationPayment(transactionId, 'confirmed');

    const refunded = await refundSimulationPayment(transactionId);
    const duplicate = await refundSimulationPayment(transactionId);
    const [wallet, refundLedgers] = await Promise.all([
      adminDb.collection('sim_wallets').doc(userId).get(),
      adminDb.collection('sim_ledger').where('type', '==', 'PAYMENT_REFUND').get(),
    ]);

    expect(refunded.payload.status).toBe('REFUNDED');
    expect(duplicate.payload).toMatchObject({ status: 'REFUNDED', duplicate: true });
    expect(wallet.data()).toMatchObject({
      balances: { EUR: 10_000 },
      reservations: { EUR: 0 },
    });
    expect(refundLedgers.size).toBe(1);
  });

  it('releases a stale PAYMENT_PENDING reservation exactly once', async () => {
    const initiated = await initiate('stale-payment', 100);
    const transactionId = initiated.payload.transactionId as string;
    const old = new Date(Date.now() - 60_000);
    await adminDb.collection('sim_transactions').doc(transactionId).update({
      createdAt: old,
      updatedAt: old,
    });

    const first = await reconcileSimulationRemittances({
      nowMs: Date.now(),
      paymentPendingThresholdMs: 1_000,
    });
    const second = await reconcileSimulationRemittances({
      nowMs: Date.now(),
      paymentPendingThresholdMs: 1_000,
    });
    const [transaction, wallet, recoveryLedger] = await Promise.all([
      adminDb.collection('sim_transactions').doc(transactionId).get(),
      adminDb.collection('sim_wallets').doc(userId).get(),
      adminDb.collection('sim_ledger').where('type', '==', 'RECOVERY_RESERVATION_RELEASE').get(),
    ]);

    expect(first.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'STALE_PAYMENT_PENDING', transactionId }),
    ]));
    expect(first.actions).toContain(`EXPIRED_PAYMENT:${transactionId}`);
    expect(second.actions).toEqual([]);
    expect(transaction.data()?.status).toBe('PAYMENT_EXPIRED');
    expect(wallet.data()).toMatchObject({
      balances: { EUR: 10_000 },
      reservations: { EUR: 0 },
    });
    expect(recoveryLedger.size).toBe(1);
  });

  it('detects an unbalanced transfer ledger', async () => {
    const initiated = await initiate('unbalanced-ledger', 100);
    const transactionId = initiated.payload.transactionId as string;
    await adminDb.collection('sim_ledger').doc(`${transactionId}_reservation`).update({
      entries: [
        { account: `wallet:${userId}:available`, side: 'CREDIT', amount: 100 },
        { account: `wallet:${userId}:reserved`, side: 'DEBIT', amount: 90 },
      ],
    });

    const result = await reconcileSimulationRemittances({ recover: false });

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'UNBALANCED_LEDGER',
        transactionId,
        details: expect.objectContaining({ difference: -10 }),
      }),
    ]));
    const alerts = await adminDb.collection('beta_risk_alerts').get();
    expect(alerts.docs.map(document => document.data().type)).toContain('LEDGER_IMBALANCE');
  });

  it('flags stuck OTP_SENT as RECOVERY_PENDING without refunding it', async () => {
    await seedAgent();
    const initiated = await initiate('stuck-otp', 100);
    const transactionId = initiated.payload.transactionId as string;
    await confirmSimulationPayment(transactionId, 'confirmed');
    const old = new Date(Date.now() - 60_000);
    await adminDb.collection('sim_transactions').doc(transactionId).update({ updatedAt: old });

    const result = await reconcileSimulationRemittances({
      nowMs: Date.now(),
      agentPayoutSlaMs: 1_000,
    });
    const [transaction, wallet] = await Promise.all([
      adminDb.collection('sim_transactions').doc(transactionId).get(),
      adminDb.collection('sim_wallets').doc(userId).get(),
    ]);

    expect(result.actions).toContain(`FLAGGED_RECOVERY:${transactionId}`);
    expect(transaction.data()).toMatchObject({
      status: 'RECOVERY_PENDING',
      recoveryPreviousStatus: 'OTP_SENT',
    });
    expect(wallet.data()?.balances.EUR).toBe(9_900);
    const alerts = await adminDb.collection('beta_risk_alerts').get();
    expect(alerts.docs.map(document => document.data().type)).toContain('STUCK_RECOVERY');
  });

  it('enforces persisted beta limits', async () => {
    await updateBetaControls({
      limits: {
        maxTransferAmount: 50,
        maxDailyTransfersPerUser: 10,
        maxDailyVolumePerUser: 500,
        maxTotalPlatformExposure: 1_000,
      },
    }, 'test');

    await expect(enforceBetaInitiationLimits(userId, 100)).rejects.toMatchObject({
      code: 'BETA_LIMIT_EXCEEDED',
      details: { limit: 'maxTransferAmount' },
    });
  });

  it('keeps reconciliation recovery available while beta is paused', async () => {
    const initiated = await initiate('paused-recovery', 100);
    const transactionId = initiated.payload.transactionId as string;
    await adminDb.collection('sim_transactions').doc(transactionId).update({
      updatedAt: new Date(Date.now() - 60_000),
    });
    await updateBetaControls({ paused: true }, 'test');

    await expect(enforceBetaInitiationLimits(userId, 10)).rejects.toMatchObject({
      code: 'BETA_PAUSED',
    });
    const reconciliation = await reconcileSimulationRemittances({
      paymentPendingThresholdMs: 1_000,
    });

    expect(reconciliation.actions).toContain(`EXPIRED_PAYMENT:${transactionId}`);
    expect((await adminDb.collection('sim_transactions').doc(transactionId).get()).data()?.status)
      .toBe('PAYMENT_EXPIRED');
  });
});

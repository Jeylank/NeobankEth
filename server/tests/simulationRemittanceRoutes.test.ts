import express from 'express';
import request from 'supertest';

type TestStatus =
  | 'PAYMENT_PENDING'
  | 'PAYMENT_FAILED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'OTP_SENT'
  | 'READY_FOR_PAYOUT'
  | 'PAID_OUT';

interface TestTransaction {
  txId: string;
  userId: string;
  recipientId: string;
  amount: number;
  currency: string;
  destinationCurrency: string;
  destinationAmount: number;
  rateUsed: number;
  type: string;
  quoteFreshness: string;
  metadata: Record<string, unknown>;
  status: TestStatus;
  payoutMethod?: string;
  otp?: string;
  payoutToken?: string;
  createdMs: number;
}

const mockTransactions = new Map<string, TestTransaction>();
let mockNow = 1_000_000;
let mockSequence = 0;

class MockAgentPayoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
  }
}

jest.mock('../middleware/rateLimiter', () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { readLimiter: pass, writeLimiter: pass, destructiveLimiter: pass };
});

jest.mock('../firebaseAdmin', () => ({
  adminDb: { collection: jest.fn() },
}));

jest.mock('../services/fraudEngine', () => ({
  FRAUD_COL: {},
  evaluateFraud: jest.fn().mockResolvedValue({
    decision: 'ALLOW',
    score: 0,
    rulesTriggered: [],
    decisionId: 'fraud-test',
  }),
  resetFraudCollections: jest.fn(),
}));

jest.mock('../services/remittance', () => ({
  getAppMode: jest.fn(() => 'simulation'),
  remittanceProvider: {
    initiate: jest.fn(async (input: {
      userId: string;
      recipientId: string;
      amount: number;
      currency: string;
      type: string;
      metadata: Record<string, unknown>;
    }) => {
      const txId = `tx-route-${++mockSequence}`;
      const tx: TestTransaction = {
        txId,
        userId: input.userId,
        recipientId: input.recipientId,
        amount: input.amount,
        currency: input.currency,
        destinationCurrency: 'ETB',
        destinationAmount: input.amount * 60,
        rateUsed: 60,
        type: input.type,
        quoteFreshness: 'live',
        metadata: input.metadata,
        status: 'PAYMENT_PENDING',
        payoutMethod: input.metadata.payout_method === 'agent_cash' ? 'agent_cash' : undefined,
        createdMs: mockNow,
      };
      mockTransactions.set(txId, tx);
      return {
        ok: true,
        status: 201,
        payload: {
          transactionId: txId,
          status: tx.status,
          ...(tx.payoutMethod ? { payout_method: tx.payoutMethod } : {}),
        },
      };
    }),
  },
}));

jest.mock('../services/paymentConfirmationService', () => ({
  confirmSimulationPayment: jest.fn(async (transactionId: string, outcome: 'confirmed' | 'failed') => {
    const tx = mockTransactions.get(transactionId);
    if (!tx) {
      return { ok: false, status: 404, payload: { error: 'TRANSACTION_NOT_FOUND' } };
    }
    if (tx.status !== 'PAYMENT_PENDING') {
      return { ok: true, status: 200, payload: { transactionId, status: tx.status, duplicate: true } };
    }
    if (outcome === 'failed') {
      tx.status = 'PAYMENT_FAILED';
      return { ok: false, status: 200, payload: { transactionId, status: tx.status } };
    }
    if (tx.payoutMethod === 'agent_cash') {
      tx.status = 'OTP_SENT';
      tx.otp = '123456';
    } else {
      tx.status = 'PROCESSING';
    }
    return {
      ok: true,
      status: 201,
      payload: {
        transactionId,
        status: tx.status,
        ...(tx.otp ? { otp: tx.otp, payout_method: 'agent_cash' } : {}),
      },
    };
  }),
  refundSimulationPayment: jest.fn(async (transactionId: string) => {
    const tx = mockTransactions.get(transactionId);
    if (!tx) return { ok: false, status: 404, payload: { error: 'TRANSACTION_NOT_FOUND' } };
    return { ok: true, status: 200, payload: { transactionId, status: 'REFUNDED' } };
  }),
}));

jest.mock('../services/remittanceReconciliationService', () => ({
  reconcileSimulationRemittances: jest.fn().mockResolvedValue({
    issues: [],
    actions: [],
    checkedTransfers: 3,
  }),
}));

jest.mock('../services/betaRiskService', () => {
  class BetaLimitError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly details: Record<string, unknown> = {},
    ) {
      super(message);
    }
  }
  return {
    BetaLimitError,
    enforceBetaInitiationLimits: jest.fn().mockResolvedValue(undefined),
    createBetaRiskAlert: jest.fn().mockResolvedValue(undefined),
    getBetaRiskSummary: jest.fn().mockResolvedValue({
      paused: false, exposure: 0, activeTransfers: 0, openAlerts: 0,
    }),
    updateBetaControls: jest.fn(),
  };
});

jest.mock('../services/simulationEngine', () => ({
  FX_BASE_RATES: { EUR: { ETB: 60 } },
  jitter: () => 1,
  liveRate: () => 60,
  QUOTE_TTL_MS: 300_000,
  QUOTE_BUFFER_MS: 30_000,
  DEFAULT_LIQUIDITY: 50_000_000,
  REPLENISH_THRESHOLD: 5_000_000,
  REPLENISH_TARGET: 50_000_000,
  providers: {},
  selectProvider: jest.fn(),
  tripProvider: jest.fn(),
  resetAllProviders: jest.fn(),
  extractIdempotencyKey: jest.fn(() => null),
  checkIdempotency: jest.fn().mockResolvedValue(null),
  createQuote: jest.fn(),
  getWalletBalances: jest.fn(),
  getLiquidityETB: jest.fn(),
  stripeTopUp: jest.fn(),
  fullReset: jest.fn(),
  resetLiquidityPool: jest.fn(),
  resumeTransaction: jest.fn(),
  seedSimulation: jest.fn(),
  SEED_USERS: [],
  SEED_BALANCES_PER_CCY: {},
  getOrAgeTx: jest.fn(async (txId: string) => {
    const tx = mockTransactions.get(txId);
    if (!tx) return undefined;
    if (
      tx.status === 'PROCESSING'
      && tx.payoutMethod !== 'agent_cash'
      && mockNow - tx.createdMs > 10_000
    ) {
      tx.status = 'COMPLETED';
    }
    return {
      ...tx,
      createdAt: new Date(tx.createdMs).toISOString(),
      updatedAt: new Date(mockNow).toISOString(),
    };
  }),
}));

jest.mock('../services/agentPayoutService', () => ({
  AgentPayoutError: MockAgentPayoutError,
  AGENT_RESPONSE_TIMEOUT_MS: 300_000,
  MAX_ASSIGNMENT_ATTEMPTS: 3,
  MAX_OTP_ATTEMPTS: 3,
  createAgent: jest.fn(),
  listAgents: jest.fn(),
  getAgent: jest.fn(),
  assignBestAgent: jest.fn(),
  respondToAssignment: jest.fn(),
  checkAndReassignStaleAssignment: jest.fn(),
  scanStaleAssignments: jest.fn(),
  sendOtp: jest.fn(),
  getTimeline: jest.fn(async (transferId: string) => {
    const tx = mockTransactions.get(transferId);
    if (!tx) return [];
    const base = new Date(tx.createdMs).toISOString();
    const events = [
      { status: 'PAYMENT_PENDING', message: 'Transfer initiated.', created_at: base },
    ];
    if (['OTP_SENT', 'READY_FOR_PAYOUT', 'PAID_OUT'].includes(tx.status)) {
      events.push(
        { status: 'FUNDS_RECEIVED', message: 'Payment confirmed.', created_at: base },
        { status: 'AGENT_ASSIGNED', message: 'Eligible agent selected.', created_at: base },
        { status: 'OTP_SENT', message: 'OTP dispatched to recipient.', created_at: base },
      );
    }
    if (['READY_FOR_PAYOUT', 'PAID_OUT'].includes(tx.status)) {
      events.push({ status: 'READY_FOR_PAYOUT', message: 'OTP verified.', created_at: base });
    }
    if (tx.status === 'PAID_OUT') {
      events.push({ status: 'PAID_OUT', message: 'Cash payout completed.', created_at: base });
    }
    return events;
  }),
  verifyOtp: jest.fn(async (transferId: string, otp: string) => {
    const tx = mockTransactions.get(transferId);
    if (!tx || tx.otp !== otp) {
      throw new MockAgentPayoutError('INVALID_OTP', 'Incorrect OTP.', 422);
    }
    tx.status = 'READY_FOR_PAYOUT';
    tx.payoutToken = 'a'.repeat(64);
    return { payoutToken: tx.payoutToken };
  }),
  markPaid: jest.fn(async (transferId: string, payoutToken: string) => {
    const tx = mockTransactions.get(transferId);
    if (!tx) throw new MockAgentPayoutError('TRANSFER_NOT_FOUND', 'Not found.', 404);
    if (tx.status === 'PAID_OUT' || tx.status === 'COMPLETED') {
      throw new MockAgentPayoutError('DUPLICATE_PAYOUT', 'Duplicate payout blocked.', 409);
    }
    if (tx.status !== 'READY_FOR_PAYOUT' || tx.payoutToken !== payoutToken) {
      throw new MockAgentPayoutError('OTP_NOT_VERIFIED', 'OTP verification required.', 422);
    }
    tx.status = 'PAID_OUT';
    return {
      transfer: tx,
      agent: {
        id: 'agent-1',
        full_name: 'Route Agent',
        phone: '+251900000000',
        city: 'Addis Ababa',
        status: 'online',
        available_float: 9_000,
        score: 100,
        created_at: new Date(0).toISOString(),
      },
    };
  }),
}));

import simulationRouter from '../routes/simulation';
import agentPayoutRouter from '../routes/agentPayout';
import {
  BetaLimitError,
  enforceBetaInitiationLimits,
} from '../services/betaRiskService';
import { remittanceProvider } from '../services/remittance';

const app = express();
app.use(express.json());
app.use('/api/v1', simulationRouter);
app.use('/api/v1', agentPayoutRouter);

describe('simulation remittance HTTP flow', () => {
  beforeAll(() => {
    process.env.SIMULATION_API_KEY = 'route-test-key';
  });

  beforeEach(() => {
    mockTransactions.clear();
    mockNow = 1_000_000;
    mockSequence = 0;
    (enforceBetaInitiationLimits as jest.Mock).mockResolvedValue(undefined);
  });

  const auth = { 'X-API-Key': 'route-test-key' };

  async function initiateAgentCash() {
    return request(app)
      .post('/api/v1/remittance/initiate')
      .set(auth)
      .send({
        userId: 'user-route',
        recipientId: 'recipient-route',
        amount: 100,
        currency: 'EUR',
        payout_method: 'agent_cash',
        recipient_city: 'Addis Ababa',
      });
  }

  it('initiates agent_cash as payment pending without assigning an agent', async () => {
    const response = await initiateAgentCash();

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('PAYMENT_PENDING');
    expect(response.body.payout_method).toBe('agent_cash');
    expect(response.body.otp).toBeUndefined();
  });

  it('does not auto-complete agent_cash when polled after 10 seconds', async () => {
    const initiated = await initiateAgentCash();
    await request(app)
      .post('/api/v1/remittance/confirm-payment')
      .set(auth)
      .send({ transactionId: initiated.body.transactionId, outcome: 'confirmed' });
    mockNow += 11_000;

    const polled = await request(app)
      .get(`/api/v1/remittance/${initiated.body.transactionId}`)
      .set(auth);

    expect(polled.status).toBe(200);
    expect(polled.body.status).toBe('OTP_SENT');
    expect(polled.body.status).not.toBe('COMPLETED');
  });

  it('loads transfer status and timeline by transfer ID for tracking', async () => {
    const initiated = await initiateAgentCash();
    const transactionId = initiated.body.transactionId;

    const confirmed = await request(app)
      .post('/api/v1/remittance/confirm-payment')
      .set(auth)
      .send({ transactionId, outcome: 'confirmed' });
    expect(confirmed.body.status).toBe('OTP_SENT');

    const tracked = await request(app)
      .get(`/api/v1/remittance/${transactionId}`)
      .set(auth);
    expect(tracked.status).toBe(200);
    expect(tracked.body).toMatchObject({
      txId: transactionId,
      status: 'OTP_SENT',
      payoutMethod: 'agent_cash',
    });

    const timeline = await request(app)
      .get(`/api/v1/transfers/${transactionId}/timeline`)
      .set(auth);
    expect(timeline.status).toBe(200);
    expect(timeline.body).toMatchObject({
      transfer_id: transactionId,
      count: 4,
    });
    expect(timeline.body.events.map((event: { status: string }) => event.status)).toEqual([
      'PAYMENT_PENDING',
      'FUNDS_RECEIVED',
      'AGENT_ASSIGNED',
      'OTP_SENT',
    ]);
  });

  it('verifies OTP, marks paid, and rejects duplicate mark-paid', async () => {
    const initiated = await initiateAgentCash();
    const transactionId = initiated.body.transactionId;
    const confirmed = await request(app)
      .post('/api/v1/remittance/confirm-payment')
      .set(auth)
      .send({ transactionId, outcome: 'confirmed' });

    const verified = await request(app)
      .post('/api/v1/payouts/verify-otp')
      .set(auth)
      .send({ transfer_id: transactionId, otp: confirmed.body.otp });
    expect(verified.status).toBe(200);

    const paid = await request(app)
      .post('/api/v1/payouts/mark-paid')
      .set(auth)
      .send({ transfer_id: transactionId, payout_token: verified.body.payout_token });
    expect(paid.status).toBe(200);
    expect(['PAID_OUT', 'COMPLETED']).toContain(paid.body.transfer.status);

    const duplicate = await request(app)
      .post('/api/v1/payouts/mark-paid')
      .set(auth)
      .send({ transfer_id: transactionId, payout_token: verified.body.payout_token });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe('DUPLICATE_PAYOUT');
  });

  it('starts standard payout only after payment confirmation', async () => {
    const initiated = await request(app)
      .post('/api/v1/remittance/initiate')
      .set(auth)
      .send({
        userId: 'user-route',
        recipientId: 'recipient-route',
        amount: 100,
        currency: 'EUR',
      });
    expect(initiated.body.status).toBe('PAYMENT_PENDING');

    const confirmed = await request(app)
      .post('/api/v1/remittance/confirm-payment')
      .set(auth)
      .send({ transactionId: initiated.body.transactionId, outcome: 'confirmed' });
    expect(confirmed.body.status).toBe('PROCESSING');

    mockNow += 11_000;
    const polled = await request(app)
      .get(`/api/v1/remittance/${initiated.body.transactionId}`)
      .set(auth);

    expect(polled.status).toBe(200);
    expect(polled.body.status).toBe('COMPLETED');
  });

  it('is idempotent for duplicate confirmation', async () => {
    const initiated = await initiateAgentCash();
    const body = { transactionId: initiated.body.transactionId, outcome: 'confirmed' };

    const first = await request(app).post('/api/v1/remittance/confirm-payment').set(auth).send(body);
    const duplicate = await request(app).post('/api/v1/remittance/confirm-payment').set(auth).send(body);

    expect(first.body.status).toBe('OTP_SENT');
    expect(duplicate.body).toMatchObject({ status: 'OTP_SENT', duplicate: true });
  });

  it('does not start payout when payment fails', async () => {
    const initiated = await initiateAgentCash();
    const failed = await request(app)
      .post('/api/v1/remittance/confirm-payment')
      .set(auth)
      .send({ transactionId: initiated.body.transactionId, outcome: 'failed' });

    expect(failed.body.status).toBe('PAYMENT_FAILED');
    expect(mockTransactions.get(initiated.body.transactionId)?.otp).toBeUndefined();
  });

  it('exposes simulation reconciliation through the admin/debug route', async () => {
    const response = await request(app)
      .post('/api/v1/remittance/reconcile')
      .set(auth)
      .send({ recover: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ issues: [], actions: [], checkedTransfers: 3 });
  });

  it('blocks initiation when a closed-beta limit is exceeded', async () => {
    (enforceBetaInitiationLimits as jest.Mock).mockRejectedValueOnce(
      new BetaLimitError('BETA_LIMIT_EXCEEDED', 'Transfer amount exceeds beta maximum.', {
        limit: 'maxTransferAmount',
      }),
    );
    const response = await initiateAgentCash();

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: 'BETA_LIMIT_EXCEEDED',
      limit: 'maxTransferAmount',
    });
  });

  it('blocks new initiation during pause while reconciliation remains available', async () => {
    (enforceBetaInitiationLimits as jest.Mock).mockRejectedValueOnce(
      new BetaLimitError('BETA_PAUSED', 'Closed beta is paused.'),
    );

    const initiation = await initiateAgentCash();
    const reconciliation = await request(app)
      .post('/api/v1/remittance/reconcile')
      .set(auth)
      .send({ recover: true });

    expect(initiation.status).toBe(503);
    expect(initiation.body.error).toBe('BETA_PAUSED');
    expect(reconciliation.status).toBe(200);
  });

  it('returns structured JSON when initiation throws unexpectedly', async () => {
    (remittanceProvider.initiate as jest.Mock).mockRejectedValueOnce(
      new Error('Could not load the default credentials.'),
    );

    const response = await initiateAgentCash();

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({
      error: 'FIRESTORE_UNAVAILABLE',
      message: 'The transfer service could not reach Firestore. Please try again shortly.',
      causeCategory: 'firestore_auth',
      retryable: true,
    });
    expect(typeof response.body.requestId).toBe('string');
  });

  it('returns the closed-beta risk dashboard summary', async () => {
    const response = await request(app)
      .get('/api/v1/admin/beta-risk-summary')
      .set(auth);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      paused: false,
      exposure: 0,
      activeTransfers: 0,
      openAlerts: 0,
    });
  });
});

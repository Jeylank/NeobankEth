import express from 'express';
import request from 'supertest';

type MockDoc = {
  id: string;
  data: () => Record<string, unknown>;
};

const collectionDocs = new Map<string, MockDoc[]>();
const get = jest.fn(async (collectionName: string, field: string, value: string) => ({
  docs: (collectionDocs.get(collectionName) ?? []).filter(doc => doc.data()[field] === value),
}));
const where = jest.fn((collectionName: string, field: string, _op: string, value: string) => ({
  get: () => get(collectionName, field, value),
}));
const collection = jest.fn((collectionName: string) => ({
  where: (field: string, op: string, value: string) => where(collectionName, field, op, value),
}));

jest.mock('../firebaseAdmin', () => ({
  adminDb: { collection },
}));

jest.mock('../middleware/verifyUser', () => ({
  verifyUser: (req: any, _res: unknown, next: () => void) => {
    req.userId = 'user-1';
    req.userEmail = 'user@example.com';
    next();
  },
}));

import transactionsRouter from '../routes/transactions';
import {
  getTransactionHistoryState,
} from '../../src/services/transactionHistory';

const app = express();
app.use('/api', transactionsRouter);

describe('transaction history alignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    collectionDocs.clear();
  });

  function setCollectionDocs(collectionName: string, docs: MockDoc[]) {
    collectionDocs.set(collectionName, docs);
  }

  it('returns a successfully initiated remittance in transaction history', async () => {
    setCollectionDocs('sim_transactions', [{
        id: 'tx-success',
        data: () => ({
          userId: 'user-1',
          recipientId: 'recipient-7',
          amount: 100,
          currency: 'EUR',
          status: 'OTP_SENT',
          createdAt: { toDate: () => new Date('2026-07-06T12:00:00.000Z') },
        }),
      }]);

    const response = await request(app).get('/api/transactions');

    expect(response.status).toBe(200);
    expect(collection).toHaveBeenCalledWith('sim_transactions');
    expect(where).toHaveBeenCalledWith('sim_transactions', 'userId', '==', 'user-1');
    expect(response.body.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-success',
        type: 'remittance',
        amount: '100',
        status: 'pending',
      }),
    ]);
  });

  it('returns remittance history persisted with senderId', async () => {
    setCollectionDocs('sim_transactions', [{
      id: 'tx-sender',
      data: () => ({
        senderId: 'user-1',
        recipientId: 'recipient-10',
        amount: 200,
        currency: 'EUR',
        status: 'PAYMENT_PENDING',
        createdAt: { toDate: () => new Date('2026-07-06T12:02:00.000Z') },
      }),
    }]);

    const response = await request(app).get('/api/transactions');

    expect(response.status).toBe(200);
    expect(response.body.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-sender',
        userId: 'user-1',
        status: 'pending',
      }),
    ]);
  });

  it('returns remittance history from legacy remittances collection', async () => {
    setCollectionDocs('remittances', [{
      id: 'tx-remittance',
      data: () => ({
        uid: 'user-1',
        recipientId: 'recipient-11',
        amount: 250,
        currency: 'EUR',
        status: 'PAID_OUT',
        createdAt: { toDate: () => new Date('2026-07-06T12:03:00.000Z') },
      }),
    }]);

    const response = await request(app).get('/api/transactions');

    expect(response.status).toBe(200);
    expect(response.body.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-remittance',
        userId: 'user-1',
        status: 'completed',
      }),
    ]);
  });

  it('does not report a failed transfer as successful in transaction history', async () => {
    setCollectionDocs('sim_transactions', [{
        id: 'tx-failed',
        data: () => ({
          userId: 'user-1',
          recipientId: 'recipient-8',
          amount: 75,
          currency: 'EUR',
          status: 'PAYMENT_FAILED',
          createdAt: { toDate: () => new Date('2026-07-06T12:05:00.000Z') },
        }),
      }]);

    const response = await request(app).get('/api/transactions');

    expect(response.status).toBe(200);
    expect(response.body.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-failed',
        type: 'remittance',
        amount: '75',
        status: 'failed',
      }),
    ]);
    expect(response.body.transactions[0].status).not.toBe('completed');
  });

  it('reports processing transfer history as pending, not successful', async () => {
    setCollectionDocs('sim_transactions', [{
        id: 'tx-processing',
        data: () => ({
          userId: 'user-1',
          recipientId: 'recipient-9',
          amount: 125,
          currency: 'EUR',
          status: 'PROCESSING',
          createdAt: { toDate: () => new Date('2026-07-06T12:10:00.000Z') },
        }),
      }]);

    const response = await request(app).get('/api/transactions');

    expect(response.status).toBe(200);
    expect(response.body.transactions[0]).toMatchObject({
      id: 'tx-processing',
      status: 'pending',
    });
    expect(response.body.transactions[0].status).not.toBe('completed');
  });

  it('shows an error state rather than an empty state when the backend fails', async () => {
    get.mockImplementationOnce(async () => {
      throw new Error('backend unavailable');
    });

    const response = await request(app).get('/api/transactions');

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('TRANSACTION_HISTORY_UNAVAILABLE');
    expect(getTransactionHistoryState(false, true, 0)).toBe('error');
  });
});

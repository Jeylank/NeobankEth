import express from 'express';
import request from 'supertest';

const get = jest.fn();
const where = jest.fn(() => ({ get }));
const collection = jest.fn(() => ({ where }));

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
  });

  it('returns a successfully initiated remittance in transaction history', async () => {
    get.mockResolvedValue({
      docs: [{
        id: 'tx-success',
        data: () => ({
          userId: 'user-1',
          recipientId: 'recipient-7',
          amount: 100,
          currency: 'EUR',
          status: 'OTP_SENT',
          createdAt: { toDate: () => new Date('2026-07-06T12:00:00.000Z') },
        }),
      }],
    });

    const response = await request(app).get('/api/transactions');

    expect(response.status).toBe(200);
    expect(where).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(response.body.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-success',
        type: 'remittance',
        amount: '100',
        status: 'pending',
      }),
    ]);
  });

  it('shows an error state rather than an empty state when the backend fails', async () => {
    get.mockRejectedValue(new Error('backend unavailable'));

    const response = await request(app).get('/api/transactions');

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('TRANSACTION_HISTORY_UNAVAILABLE');
    expect(getTransactionHistoryState(false, true, 0)).toBe('error');
  });
});

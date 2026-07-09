const mockAdd = jest.fn().mockResolvedValue({ id: 'notif-1' });
const mockCollection = jest.fn((name: string) => ({ add: mockAdd }));

jest.mock('../firebaseAdmin', () => ({
  adminDb: { collection: (name: string) => mockCollection(name) },
}));

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}));

import { notifyRemittanceEvent } from '../services/notificationService';

describe('notifyRemittanceEvent', () => {
  beforeEach(() => {
    mockAdd.mockClear();
    mockCollection.mockClear();
  });

  it('writes an in-app notification document with type "remittance"', async () => {
    await notifyRemittanceEvent({
      userId: 'user-1',
      event: 'TRANSFER_CREATED',
      txId: 'tx-1',
      amount: 100,
      currency: 'EUR',
    });

    expect(mockCollection).toHaveBeenCalledWith('notifications');
    expect(mockAdd).toHaveBeenCalledTimes(1);
    const payload = mockAdd.mock.calls[0][0];
    expect(payload).toMatchObject({
      userId: 'user-1',
      type: 'remittance',
      read: false,
      data: { event: 'TRANSFER_CREATED', txId: 'tx-1', amount: 100, currency: 'EUR' },
    });
    expect(payload.title).toBeTruthy();
    expect(payload.message).toContain('100');
    expect(payload.message).toContain('EUR');
  });

  it.each([
    'TRANSFER_CREATED', 'PAYMENT_CONFIRMED', 'AGENT_ASSIGNED', 'OTP_SENT',
    'PAYOUT_COMPLETED', 'RECOVERY_PENDING', 'TRANSFER_FAILED', 'TRANSFER_REFUNDED',
  ] as const)('produces a non-empty title/message for %s', async (event) => {
    await notifyRemittanceEvent({ userId: 'user-2', event, txId: 'tx-2' });
    const payload = mockAdd.mock.calls[0][0];
    expect(payload.title.length).toBeGreaterThan(0);
    expect(payload.message.length).toBeGreaterThan(0);
    expect(payload.data.event).toBe(event);
  });

  it('includes agentName in data when provided (AGENT_ASSIGNED)', async () => {
    await notifyRemittanceEvent({
      userId: 'user-3', event: 'AGENT_ASSIGNED', txId: 'tx-3', agentName: 'Dawit Zerihun',
    });
    const payload = mockAdd.mock.calls[0][0];
    expect(payload.message).toContain('Dawit Zerihun');
  });

  it('does not write a notification and does not throw when userId is missing', async () => {
    await expect(notifyRemittanceEvent({ userId: '', event: 'TRANSFER_CREATED' })).resolves.toBeUndefined();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('swallows Firestore errors instead of throwing (fire-and-forget safety)', async () => {
    mockAdd.mockRejectedValueOnce(new Error('firestore down'));
    await expect(
      notifyRemittanceEvent({ userId: 'user-4', event: 'PAYOUT_COMPLETED', txId: 'tx-4' }),
    ).resolves.toBeUndefined();
  });
});

import {
  AgentPayoutError,
  hasSufficientAgentFloat,
  requireUnpaidTransfer,
  requireVerifiedOtp,
} from '../services/agentPayoutService';
import { startAgentCashPayout } from '../services/agentCashRemittanceService';
import type { RemittanceRequest } from '../services/remittance';
import { shouldAutoCompleteTransaction } from '../services/simulationEngine';

const request: RemittanceRequest = {
  userId: 'user-1',
  recipientId: 'recipient-1',
  amount: 100,
  currency: 'EUR',
  type: 'standard',
  metadata: { payout_method: 'agent_cash', recipient_city: 'Addis Ababa' },
};

const created = {
  ok: true,
  status: 201,
  payload: { transactionId: 'tx-1', status: 'PROCESSING' },
};

describe('agent cash remittance flow', () => {
  it('moves agent_cash to OTP_SENT instead of an auto-completable state', async () => {
    const prepareTransaction = jest.fn().mockResolvedValue(undefined);
    const result = await startAgentCashPayout(request, created, {
      prepareTransaction,
      assignAgent: jest.fn().mockResolvedValue({
        assignment: { id: 'assignment-1' },
        agent: { id: 'agent-1', full_name: 'Agent One' },
      }),
      generateOtp: jest.fn().mockResolvedValue({
        otp: '123456',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    });

    expect(prepareTransaction).toHaveBeenCalledWith('tx-1', 'Addis Ababa');
    expect(result.payload.status).toBe('OTP_SENT');
    expect(result.payload.status).not.toBe('PROCESSING');
    expect(result.payload.status).not.toBe('COMPLETED');
    expect(shouldAutoCompleteTransaction('PROCESSING', 'agent_cash', 0, 11_000)).toBe(false);
  });

  it('returns a safe retryable failure when no agent is available', async () => {
    const result = await startAgentCashPayout(request, created, {
      prepareTransaction: jest.fn().mockResolvedValue(undefined),
      assignAgent: jest.fn().mockRejectedValue(
        new AgentPayoutError('NO_ELIGIBLE_AGENT', 'No eligible agent.', 422),
      ),
      generateOtp: jest.fn(),
    });

    expect(result).toMatchObject({
      ok: false,
      status: 422,
      payload: {
        error: 'NO_ELIGIBLE_AGENT',
        transactionId: 'tx-1',
        status: 'FUNDS_RECEIVED',
        retryable: true,
      },
    });
  });

  it('blocks assignment when agent float is insufficient', () => {
    expect(hasSufficientAgentFloat({ available_float: 99 }, 100)).toBe(false);
    expect(hasSufficientAgentFloat({ available_float: 100 }, 100)).toBe(true);
  });

  it('requires OTP verification before mark-paid', () => {
    expect(() => requireVerifiedOtp({ verified: false })).toThrow(
      expect.objectContaining({ code: 'OTP_NOT_VERIFIED', httpStatus: 422 }),
    );
  });

  it('rejects duplicate mark-paid', () => {
    expect(() => requireUnpaidTransfer('PAID_OUT')).toThrow(
      expect.objectContaining({ code: 'DUPLICATE_PAYOUT', httpStatus: 409 }),
    );
  });

  it('leaves non-agent_cash remittances unchanged', async () => {
    const nonCash = { ...request, metadata: { payout_method: 'bank' } };
    const prepareTransaction = jest.fn();
    const result = await startAgentCashPayout(nonCash, created, {
      prepareTransaction,
      assignAgent: jest.fn(),
      generateOtp: jest.fn(),
    });

    expect(result).toBe(created);
    expect(prepareTransaction).not.toHaveBeenCalled();
  });
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('axios', () => {
  const client = {
    post: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return {
    __esModule: true,
    default: { create: jest.fn(() => client) },
  };
});

import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildFullRequestUrl,
  getApiErrorMessage,
  normalizeApiBaseUrl,
  remittanceApi,
} from '../../src/services/api';
import { executeRemittanceFlow, type MobileRemittanceRequest } from '../../src/services/mobileRemittanceFlow';
import { initiateTransferFirestore } from '../../src/services/remittanceFirestoreService';

const request: MobileRemittanceRequest = {
  userId: 'mobile-user',
  recipientId: 'recipient-7',
  amount: 100,
  currency: 'EUR',
  quoteId: 'quote-1',
  payout_method: 'agent_cash',
};

const axiosClient = (axios.create as jest.Mock).mock.results[0].value as {
  post: jest.Mock;
  interceptors: {
    request: { use: jest.Mock };
  };
};
const requestInterceptor = axiosClient.interceptors.request.use.mock.calls[0][0] as (config: any) => Promise<any>;

describe('mobile remittance backend contract', () => {
  beforeEach(() => {
    axiosClient.post.mockReset();
    jest.clearAllMocks();
  });

  it('uses the v1 initiate schema and confirm-payment endpoint', async () => {
    axiosClient.post
      .mockResolvedValueOnce({
        data: { transactionId: 'tx-mobile', status: 'PAYMENT_PENDING' },
      })
      .mockResolvedValueOnce({
        data: { transactionId: 'tx-mobile', status: 'OTP_SENT', payout_method: 'agent_cash', otp: '123456' },
      });

    const initiated = await remittanceApi.initiateTransfer(request);
    const confirmed = await remittanceApi.confirmPayment(initiated.transactionId);

    expect(axiosClient.post).toHaveBeenNthCalledWith(1, '/api/v1/remittance/initiate', request);
    expect(axiosClient.post).toHaveBeenNthCalledWith(2, '/api/v1/remittance/confirm-payment', {
      transactionId: 'tx-mobile',
      outcome: 'confirmed',
    });
    expect(confirmed.status).toBe('OTP_SENT');
  });

  it.each([
    ['https://example.replit.app', 'https://example.replit.app'],
    ['https://example.replit.app/api', 'https://example.replit.app'],
    ['https://example.replit.app/api/v1', 'https://example.replit.app'],
    ['https://example.replit.app/api/v1/', 'https://example.replit.app'],
  ])('normalizes API base URL %s', (rawUrl, expectedUrl) => {
    expect(normalizeApiBaseUrl(rawUrl)).toBe(expectedUrl);
  });

  it.each([
    'https://08a9245b-5f48-44e1-8f97-7868b3994725-00-2rcx47a59k92i.spock.replit.dev',
    'https://08a9245b-5f48-44e1-8f97-7868b3994725-00-2rcx47a59k92i.spock.replit.dev/api/v1',
  ])('builds the exact native remittance initiation URL from %s', (baseUrl) => {
    expect(buildFullRequestUrl(baseUrl, '/api/v1/remittance/initiate')).toBe(
      'https://08a9245b-5f48-44e1-8f97-7868b3994725-00-2rcx47a59k92i.spock.replit.dev/api/v1/remittance/initiate',
    );
  });

  it('keeps Send Money API errors safe for the user-facing error box', () => {
    const details = getApiErrorMessage({
      config: {
        method: 'post',
        baseURL: 'https://08a9245b-5f48-44e1-8f97-7868b3994725-00-2rcx47a59k92i.spock.replit.dev/api/v1',
        url: '/api/v1/remittance/initiate',
      },
      response: {
        status: 404,
        data: {
          error: 'Endpoint not found',
          apiKey: 'secret-api-key',
        },
      },
    });

    expect(details).toBe('The transfer service is unavailable in this build. Please update the app or try again shortly.');
    expect(details).not.toContain('Final URL');
    expect(details).not.toContain('https://');
    expect(details).not.toContain('Response body');
    expect(details).not.toContain('secret-api-key');
  });

  it('uses the current Firebase user token when SecureStore has not caught up yet', async () => {
    const config = await requestInterceptor({ headers: {} });

    expect(config.headers.Authorization).toBe('Bearer firebase-current-user-token');
  });

  it('cannot turn initiation failure into fake success', async () => {
    const client = {
      initiateTransfer: jest.fn().mockRejectedValue(new Error('backend unavailable')),
      confirmPayment: jest.fn(),
    };

    await expect(executeRemittanceFlow(client, request)).rejects.toThrow('backend unavailable');
    expect(client.confirmPayment).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('cannot turn confirmation failure into fake success', async () => {
    const client = {
      initiateTransfer: jest.fn().mockResolvedValue({
        transactionId: 'tx-mobile',
        status: 'PAYMENT_PENDING',
      }),
      confirmPayment: jest.fn().mockRejectedValue(new Error('payment confirmation failed')),
    };

    await expect(executeRemittanceFlow(client, request)).rejects.toThrow('payment confirmation failed');
  });

  it('treats PROCESSING initiation as successful without payment confirmation', async () => {
    const client = {
      initiateTransfer: jest.fn().mockResolvedValue({
        transactionId: 'tx-processing',
        status: 'PROCESSING',
      }),
      confirmPayment: jest.fn(),
    };

    await expect(executeRemittanceFlow(client, request)).resolves.toMatchObject({
      transactionId: 'tx-processing',
      status: 'PROCESSING',
    });
    expect(client.confirmPayment).not.toHaveBeenCalled();
  });

  it.each([
    'OTP_SENT',
    'COMPLETED',
    'PENDING_REVIEW',
    'PENDING_LIQUIDITY',
  ])('handles %s initiation without throwing', async (status) => {
    const client = {
      initiateTransfer: jest.fn().mockResolvedValue({
        transactionId: `tx-${status}`,
        status,
      }),
      confirmPayment: jest.fn(),
    };

    await expect(executeRemittanceFlow(client, request)).resolves.toMatchObject({ status });
    expect(client.confirmPayment).not.toHaveBeenCalled();
  });

  it('keeps the legacy Firestore/AsyncStorage initiation fallback disabled', async () => {
    await expect(initiateTransferFirestore({
      amount: 100,
      fromCurrency: 'EUR',
      toCurrency: 'ETB',
      beneficiaryId: 7,
    })).rejects.toThrow('Local remittance creation is disabled');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

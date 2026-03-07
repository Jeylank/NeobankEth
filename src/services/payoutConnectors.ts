import {
  db,
  collection,
  doc,
  updateDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
} from './firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  PayoutProvider,
  PayoutStatus,
  PayoutTransaction,
  AccountValidationResult,
} from '../types';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://api.habeshare.com';
const IS_DEV = __DEV__;
const LOCAL_PAYOUTS_KEY = 'payout_transactions';

const PROVIDER_ENDPOINTS: Record<PayoutProvider, { base: string; version: string }> = {
  CHAPA: { base: 'https://api.chapa.co', version: 'v1' },
  TELEBIRR: { base: 'https://api.ethiotelecom.et/telebirr', version: 'v1' },
  BANK: { base: `${API_BASE}/api/payout`, version: 'v1' },
};

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 15000];

interface PayoutRequest {
  userId: string;
  amount: number;
  currency: string;
  recipientAccount: string;
  recipientName: string;
  recipientPhone?: string;
  payoutMethod: 'bank_transfer' | 'mobile_wallet' | 'cash_pickup';
  bankCode?: string;
  description?: string;
  metadata?: Record<string, string>;
}

interface ProviderPayoutResponse {
  success: boolean;
  providerRef: string;
  status: PayoutStatus;
  message?: string;
  estimatedDelivery?: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  let token: string | null = null;
  try {
    const SecureStore = await import('expo-secure-store');
    token = await SecureStore.getItemAsync('authToken');
  } catch {
    token = await AsyncStorage.getItem('authToken');
  }
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiCall(
  url: string,
  method: 'POST' | 'GET',
  body?: Record<string, unknown>,
  attempt = 1
): Promise<{ ok: boolean; status: number; data: any }> {
  const headers = await getAuthHeaders();
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));

    const retryableStatus = response.status >= 500 || response.status === 429;
    if (!response.ok && retryableStatus && attempt <= MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      await new Promise(resolve => setTimeout(resolve, delay));
      return apiCall(url, method, body, attempt + 1);
    }

    return { ok: response.ok, status: response.status, data };
  } catch (error: any) {
    if (attempt <= MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      await new Promise(resolve => setTimeout(resolve, delay));
      return apiCall(url, method, body, attempt + 1);
    }
    throw new PayoutError(
      'NETWORK_ERROR',
      `Network error after ${MAX_RETRIES} retries: ${error.message}`
    );
  }
}

class PayoutError extends Error {
  constructor(public code: string, message: string, public retryable = false) {
    super(message);
    this.name = 'PayoutError';
  }
}

function generateReference(provider: PayoutProvider): string {
  const prefix = provider === 'CHAPA' ? 'HS-CH' : provider === 'TELEBIRR' ? 'HS-TB' : 'HS-BK';
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

async function sendChapaPayoutAPI(request: PayoutRequest): Promise<ProviderPayoutResponse> {
  const { base, version } = PROVIDER_ENDPOINTS.CHAPA;
  const reference = generateReference('CHAPA');

  const result = await apiCall(`${base}/${version}/transfers`, 'POST', {
    account_name: request.recipientName,
    account_number: request.recipientAccount,
    amount: request.amount,
    currency: request.currency === 'ETB' ? 'ETB' : 'ETB',
    reference,
    bank_code: request.bankCode || 'telebirr',
  });

  if (!result.ok) {
    const retryable = result.status >= 500 || result.status === 429;
    throw new PayoutError(
      `CHAPA_${result.status}`,
      result.data?.message || `Chapa API error: ${result.status}`,
      retryable
    );
  }

  return {
    success: true,
    providerRef: result.data?.data?.id || result.data?.transfer_id || reference,
    status: 'PROCESSING',
    message: result.data?.message || 'Payout initiated via Chapa',
    estimatedDelivery: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function sendTelebirrPayoutAPI(request: PayoutRequest): Promise<ProviderPayoutResponse> {
  const { base, version } = PROVIDER_ENDPOINTS.TELEBIRR;
  const reference = generateReference('TELEBIRR');

  const result = await apiCall(`${base}/${version}/payment/transfer`, 'POST', {
    msisdn: request.recipientPhone || request.recipientAccount,
    amount: request.amount,
    currency: 'ETB',
    reference_id: reference,
    remark: request.description || 'Habeshare payout',
  });

  if (!result.ok) {
    const retryable = result.status >= 500 || result.status === 429;
    throw new PayoutError(
      `TELEBIRR_${result.status}`,
      result.data?.message || `Telebirr API error: ${result.status}`,
      retryable
    );
  }

  return {
    success: true,
    providerRef: result.data?.transaction_id || result.data?.referenceId || reference,
    status: 'PROCESSING',
    message: result.data?.message || 'Payout initiated via Telebirr',
    estimatedDelivery: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(),
  };
}

async function sendBankPayoutAPI(request: PayoutRequest): Promise<ProviderPayoutResponse> {
  const { base, version } = PROVIDER_ENDPOINTS.BANK;
  const reference = generateReference('BANK');

  const result = await apiCall(`${base}/${version}/bank-transfer`, 'POST', {
    bank_code: request.bankCode,
    account_number: request.recipientAccount,
    account_name: request.recipientName,
    amount: request.amount,
    currency: request.currency,
    reference,
    narration: request.description || 'Habeshare bank payout',
  });

  if (!result.ok) {
    const retryable = result.status >= 500 || result.status === 429;
    throw new PayoutError(
      `BANK_${result.status}`,
      result.data?.message || `Bank payout API error: ${result.status}`,
      retryable
    );
  }

  return {
    success: true,
    providerRef: result.data?.transaction_id || result.data?.reference || reference,
    status: 'PROCESSING',
    message: result.data?.message || 'Bank payout initiated',
    estimatedDelivery: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function persistPayoutDoc(payout: PayoutTransaction): Promise<string> {
  if (IS_DEV) {
    try {
      const stored = await AsyncStorage.getItem(LOCAL_PAYOUTS_KEY);
      const list: PayoutTransaction[] = stored ? JSON.parse(stored) : [];
      list.unshift(payout);
      await AsyncStorage.setItem(LOCAL_PAYOUTS_KEY, JSON.stringify(list.slice(0, 200)));
    } catch (e) {
      console.error('Failed to persist payout locally:', e);
    }
    return payout.id;
  }

  try {
    const docRef = doc(db, 'payout_transactions', payout.id);
    await setDoc(docRef, payout);
    return payout.id;
  } catch (e) {
    console.error('Firestore persist failed, falling back to local:', e);
    const stored = await AsyncStorage.getItem(LOCAL_PAYOUTS_KEY);
    const list: PayoutTransaction[] = stored ? JSON.parse(stored) : [];
    list.unshift(payout);
    await AsyncStorage.setItem(LOCAL_PAYOUTS_KEY, JSON.stringify(list.slice(0, 200)));
    return payout.id;
  }
}

async function updatePayoutDoc(
  payoutId: string,
  updates: Partial<PayoutTransaction>
): Promise<void> {
  const updateData = { ...updates, updatedAt: new Date().toISOString() };

  if (IS_DEV) {
    try {
      const stored = await AsyncStorage.getItem(LOCAL_PAYOUTS_KEY);
      const list: PayoutTransaction[] = stored ? JSON.parse(stored) : [];
      const idx = list.findIndex(p => p.id === payoutId);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...updateData };
        await AsyncStorage.setItem(LOCAL_PAYOUTS_KEY, JSON.stringify(list));
      }
    } catch (e) {
      console.error('Failed to update payout locally:', e);
    }
    return;
  }

  try {
    const docRef = doc(db, 'payout_transactions', payoutId);
    await updateDoc(docRef, updateData);
  } catch (e) {
    console.error('Firestore update failed:', e);
  }
}

function selectProvider(
  payoutMethod: PayoutRequest['payoutMethod'],
  bankCode?: string
): PayoutProvider {
  if (payoutMethod === 'mobile_wallet') {
    return 'TELEBIRR';
  }
  if (payoutMethod === 'bank_transfer') {
    if (bankCode === 'CBE' || !bankCode) {
      return 'CHAPA';
    }
    return 'BANK';
  }
  return 'CHAPA';
}

export const payoutConnectors = {
  async sendPayout(request: PayoutRequest): Promise<PayoutTransaction> {
    const provider = selectProvider(request.payoutMethod, request.bankCode);

    const payoutId = generateReference(provider);
    const payout: PayoutTransaction = {
      id: payoutId,
      userId: request.userId,
      provider,
      providerRef: '',
      payoutStatus: 'INITIATED',
      amount: request.amount,
      currency: request.currency,
      recipientAccount: request.recipientAccount,
      recipientName: request.recipientName,
      payoutMethod: request.payoutMethod,
      bankCode: request.bankCode,
      retryCount: 0,
      maxRetries: MAX_RETRIES,
      metadata: request.metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await persistPayoutDoc(payout);

    try {
      const result = await dispatchToProvider(provider, request);

      payout.providerRef = result.providerRef;
      payout.payoutStatus = result.status;
      await updatePayoutDoc(payoutId, {
        providerRef: result.providerRef,
        payoutStatus: result.status,
      });

      return { ...payout, providerRef: result.providerRef, payoutStatus: result.status };
    } catch (error: any) {
      if (error instanceof PayoutError && error.retryable) {
        return this.retryPayout(payout, request, 1);
      }

      await updatePayoutDoc(payoutId, {
        payoutStatus: 'FAILED',
        lastError: error.message,
      });

      return { ...payout, payoutStatus: 'FAILED', lastError: error.message };
    }
  },

  async retryPayout(
    payout: PayoutTransaction,
    request: PayoutRequest,
    attempt: number
  ): Promise<PayoutTransaction> {
    if (attempt > MAX_RETRIES) {
      await updatePayoutDoc(payout.id, {
        payoutStatus: 'FAILED',
        retryCount: attempt - 1,
        lastError: `Exhausted ${MAX_RETRIES} retries`,
      });
      return {
        ...payout,
        payoutStatus: 'FAILED',
        retryCount: attempt - 1,
        lastError: `Exhausted ${MAX_RETRIES} retries`,
      };
    }

    await updatePayoutDoc(payout.id, {
      payoutStatus: 'RETRYING',
      retryCount: attempt,
    });

    const delay = RETRY_DELAYS[attempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      const result = await dispatchToProvider(payout.provider, request);

      await updatePayoutDoc(payout.id, {
        providerRef: result.providerRef,
        payoutStatus: result.status,
        retryCount: attempt,
      });

      return {
        ...payout,
        providerRef: result.providerRef,
        payoutStatus: result.status,
        retryCount: attempt,
      };
    } catch (error: any) {
      if (error instanceof PayoutError && error.retryable) {
        return this.retryPayout(payout, request, attempt + 1);
      }

      await updatePayoutDoc(payout.id, {
        payoutStatus: 'FAILED',
        retryCount: attempt,
        lastError: error.message,
      });

      return {
        ...payout,
        payoutStatus: 'FAILED',
        retryCount: attempt,
        lastError: error.message,
      };
    }
  },

  async checkPayoutStatus(
    provider: PayoutProvider,
    providerRef: string
  ): Promise<{ payoutStatus: PayoutStatus; providerRef: string; message?: string }> {
    try {
      let url: string;
      switch (provider) {
        case 'CHAPA': {
          const { base, version } = PROVIDER_ENDPOINTS.CHAPA;
          url = `${base}/${version}/transfers/verify/${providerRef}`;
          break;
        }
        case 'TELEBIRR': {
          const { base, version } = PROVIDER_ENDPOINTS.TELEBIRR;
          url = `${base}/${version}/payment/query/${providerRef}`;
          break;
        }
        case 'BANK': {
          const { base, version } = PROVIDER_ENDPOINTS.BANK;
          url = `${base}/${version}/status/${providerRef}`;
          break;
        }
      }

      const result = await apiCall(url, 'GET');

      if (!result.ok) {
        return {
          payoutStatus: 'PROCESSING',
          providerRef,
          message: `Status check returned ${result.status}`,
        };
      }

      const rawStatus = (
        result.data?.status ||
        result.data?.data?.status ||
        result.data?.transfer_status ||
        ''
      ).toLowerCase();

      let payoutStatus: PayoutStatus;
      if (['success', 'completed', 'paid', 'delivered'].includes(rawStatus)) {
        payoutStatus = 'COMPLETED';
      } else if (['failed', 'rejected', 'cancelled', 'reversed'].includes(rawStatus)) {
        payoutStatus = 'FAILED';
      } else {
        payoutStatus = 'PROCESSING';
      }

      return {
        payoutStatus,
        providerRef,
        message: result.data?.message || result.data?.data?.message,
      };
    } catch (error: any) {
      return {
        payoutStatus: 'PROCESSING',
        providerRef,
        message: `Status check failed: ${error.message}`,
      };
    }
  },

  async validateAccount(
    provider: PayoutProvider,
    accountNumber: string,
    bankCode?: string
  ): Promise<AccountValidationResult> {
    try {
      let url: string;
      let body: Record<string, unknown>;

      switch (provider) {
        case 'CHAPA': {
          const { base, version } = PROVIDER_ENDPOINTS.CHAPA;
          url = `${base}/${version}/transfers/verify-account`;
          body = { account_number: accountNumber, bank_code: bankCode || 'telebirr' };
          break;
        }
        case 'TELEBIRR': {
          const { base, version } = PROVIDER_ENDPOINTS.TELEBIRR;
          url = `${base}/${version}/payment/validate`;
          body = { msisdn: accountNumber };
          break;
        }
        case 'BANK': {
          const { base, version } = PROVIDER_ENDPOINTS.BANK;
          url = `${base}/${version}/validate-account`;
          body = { account_number: accountNumber, bank_code: bankCode };
          break;
        }
      }

      const result = await apiCall(url, 'POST', body);

      if (!result.ok) {
        return {
          valid: false,
          error: result.data?.message || `Account validation failed (${result.status})`,
        };
      }

      return {
        valid: true,
        accountName: result.data?.account_name || result.data?.data?.account_name,
        accountNumber: result.data?.account_number || accountNumber,
        bankName: result.data?.bank_name || result.data?.data?.bank_name,
      };
    } catch (error: any) {
      return {
        valid: false,
        error: `Validation error: ${error.message}`,
      };
    }
  },

  async getPayoutHistory(
    userId: string,
    limitCount = 20
  ): Promise<PayoutTransaction[]> {
    if (IS_DEV) {
      try {
        const stored = await AsyncStorage.getItem(LOCAL_PAYOUTS_KEY);
        const list: PayoutTransaction[] = stored ? JSON.parse(stored) : [];
        return list.filter(p => p.userId === userId).slice(0, limitCount);
      } catch {
        return [];
      }
    }

    try {
      const q = query(
        collection(db, 'payout_transactions'),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        firestoreLimit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => d.data() as PayoutTransaction);
    } catch {
      return [];
    }
  },

  async pollPayoutUntilComplete(
    provider: PayoutProvider,
    providerRef: string,
    payoutId: string,
    maxPolls = 10,
    intervalMs = 5000
  ): Promise<PayoutStatus> {
    for (let i = 0; i < maxPolls; i++) {
      const result = await this.checkPayoutStatus(provider, providerRef);

      if (result.payoutStatus === 'COMPLETED' || result.payoutStatus === 'FAILED') {
        await updatePayoutDoc(payoutId, { payoutStatus: result.payoutStatus });
        return result.payoutStatus;
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return 'PROCESSING';
  },
};

async function dispatchToProvider(
  provider: PayoutProvider,
  request: PayoutRequest
): Promise<ProviderPayoutResponse> {
  switch (provider) {
    case 'CHAPA':
      return sendChapaPayoutAPI(request);
    case 'TELEBIRR':
      return sendTelebirrPayoutAPI(request);
    case 'BANK':
      return sendBankPayoutAPI(request);
  }
}

export type { PayoutRequest, ProviderPayoutResponse, PayoutError };

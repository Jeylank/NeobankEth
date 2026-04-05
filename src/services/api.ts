import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import type { Transaction, SavingsGoal, Beneficiary, BalanceResponse, User } from '../types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.sumsuma.com';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export const authApi = {
  login: async (email: string, password: string) => {
    const response = await api.post('/api/auth/login', { email, password });
    return response.data;
  },
  register: async (data: { email: string; password: string; fullName: string; username: string }) => {
    const response = await api.post('/api/auth/register', data);
    return response.data;
  },
  logout: async () => {
    await api.post('/api/auth/logout');
    await SecureStore.deleteItemAsync('authToken');
  },
  getProfile: async (): Promise<User> => {
    const response = await api.get('/api/user/profile');
    return response.data;
  },
};

export const balanceApi = {
  getBalance: async (): Promise<BalanceResponse> => {
    const response = await api.get('/api/balance');
    return response.data;
  },
  getMultiCurrencyBalance: async (): Promise<{ balances: { currency: string; amount: number; symbol: string }[] }> => {
    const response = await api.get('/api/balance/multi-currency');
    return response.data;
  },
};

export const exchangeRatesApi = {
  getRates: async (): Promise<{ rates: Record<string, number>; baseCurrency: string; lastUpdated: string }> => {
    const response = await api.get('/api/exchange-rates');
    return response.data;
  },
  convert: async (from: string, to: string, amount: number): Promise<{ convertedAmount: number; rate: number }> => {
    const response = await api.get(`/api/exchange-rates/convert?from=${from}&to=${to}&amount=${amount}`);
    return response.data;
  },
};

export const transactionsApi = {
  getAll: async (): Promise<{ transactions: Transaction[] }> => {
    const response = await api.get('/api/transactions');
    return response.data;
  },
  getRecent: async (limit = 5): Promise<{ transactions: Transaction[] }> => {
    const response = await api.get(`/api/transactions?limit=${limit}`);
    return response.data;
  },
  create: async (data: Partial<Transaction>): Promise<Transaction> => {
    const response = await api.post('/api/transactions', data);
    return response.data;
  },
};

export const savingsApi = {
  getGoals: async (): Promise<{ goals: SavingsGoal[] }> => {
    const response = await api.get('/api/savings-goals');
    return response.data;
  },
  createGoal: async (data: Partial<SavingsGoal>): Promise<SavingsGoal> => {
    const response = await api.post('/api/savings-goals', data);
    return response.data;
  },
  updateGoal: async (id: number, data: Partial<SavingsGoal>): Promise<SavingsGoal> => {
    const response = await api.patch(`/api/savings-goals/${id}`, data);
    return response.data;
  },
};

export const beneficiariesApi = {
  getAll: async (): Promise<{ beneficiaries: Beneficiary[] }> => {
    const response = await api.get('/api/beneficiaries');
    return response.data;
  },
  create: async (data: Partial<Beneficiary>): Promise<Beneficiary> => {
    const response = await api.post('/api/beneficiaries', data);
    return response.data;
  },
};

export const remittanceApi = {
  getExchangeRates: async (): Promise<{ rates: Record<string, number> }> => {
    const response = await api.get('/api/exchange-rates');
    return response.data;
  },
  initiateTransfer: async (data: {
    amount: number;
    fromCurrency: string;
    toCurrency: string;
    beneficiaryId: number;
    description?: string;
    paymentMethod?: string;
    payoutMethod?: string;
    quoteId?: string;
  }) => {
    const response = await api.post('/api/remittance/initiate', data);
    return response.data;
  },
  getAll: async () => {
    const response = await api.get('/api/remittances');
    return response.data;
  },
};

export const billsApi = {
  getAll: async () => {
    const response = await api.get('/api/bills');
    return response.data;
  },
  payBill: async (data: { category: string; accountNumber: string; amount: number }) => {
    const response = await api.post('/api/bills/pay', data);
    return response.data;
  },
};

export const bankAccountsApi = {
  getAll: async () => {
    const response = await api.get('/api/bank-accounts');
    return response.data;
  },
  add: async (data: { bankName: string; accountNumber: string; accountName: string }) => {
    const response = await api.post('/api/bank-accounts', data);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/api/bank-accounts/${id}`);
    return response.data;
  },
};

export const paymentsApi = {
  initializeChapa: async (data: {
    amount: number;
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }) => {
    const response = await api.post('/api/payments/chapa/initialize', data);
    return response.data;
  },
  initializeTelebirr: async (data: { amount: number; phone: string }) => {
    const response = await api.post('/api/payments/telebirr/initialize', data);
    return response.data;
  },
};

export const kycApi = {
  getStatus: async () => {
    const response = await api.get('/api/kyc/status');
    return response.data;
  },
  submit: async (data: any) => {
    const response = await api.post('/api/kyc/submit', data);
    return response.data;
  },
};

export const supportApi = {
  submitTicket: async (data: { subject: string; message: string }) => {
    const response = await api.post('/api/support/ticket', data);
    return response.data;
  },
};

export interface FxQuote {
  quoteId: string;
  bank: string;
  rate: number;
  fee: number;
  receiveAmount: number;
  deliveryTime: string;
}

export const fxMarketplaceApi = {
  getQuotes: async (params: {
    amount: number;
    currency: string;
    payoutMethod: string;
  }): Promise<FxQuote[]> => {
    const response = await api.post('/api/fx/quotes', params);
    return response.data;
  },
  selectQuote: async (quoteId: string): Promise<{ success: boolean }> => {
    const response = await api.post('/api/fx/select', { quoteId });
    return response.data;
  },
};

export const referralApi = {
  getInfo: async () => {
    const response = await api.get('/api/referral');
    return response.data;
  },
  invite: async (email: string) => {
    const response = await api.post('/api/referral/invite', { email });
    return response.data;
  },
};

export default api;

export interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  phone?: string;
  preferredCurrency: string;
  language: string;
  role: string;
}

export interface Transaction {
  id: number;
  userId: number;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'remittance' | 'payment';
  amount: string;
  currency: string;
  description: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  recipientName?: string;
  recipientCountry?: string;
  createdAt: string;
}

export interface SavingsGoal {
  id: number;
  userId: number;
  name: string;
  targetAmount: string;
  currentAmount: string;
  currency: string;
  deadline?: string;
  status: 'active' | 'completed' | 'cancelled';
}

export interface Beneficiary {
  id: number;
  userId: number;
  name: string;
  bankName: string;
  accountNumber: string;
  country: string;
  currency: string;
}

export interface ExchangeRate {
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  updatedAt: string;
}

export interface BalanceResponse {
  balance: number;
}

export interface ApiError {
  message: string;
  status?: number;
}

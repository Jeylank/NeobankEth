import AsyncStorage from '@react-native-async-storage/async-storage';
import { payoutConnectors } from './payoutConnectors';
import type { PayoutProvider as ConnectorProvider, PayoutTransaction } from '../types';

type PaymentProvider = 'telebirr' | 'chapa' | 'santimpay';
type PayoutMethod = 'bank_transfer' | 'mobile_wallet' | 'cash_pickup';

interface PaymentConfig {
  provider: PaymentProvider;
  apiBaseUrl: string;
  publicKey?: string;
  merchantId?: string;
  callbackUrl: string;
  isTestMode: boolean;
}

interface PaymentRequest {
  amount: number;
  currency: string;
  reference: string;
  description: string;
  customerEmail?: string;
  customerPhone?: string;
  customerName?: string;
  metadata?: Record<string, string>;
}

interface PaymentResponse {
  success: boolean;
  transactionId?: string;
  paymentUrl?: string;
  checkoutUrl?: string;
  reference: string;
  status: 'pending' | 'completed' | 'failed';
  message?: string;
  provider: PaymentProvider;
}

interface PayoutRequest {
  amount: number;
  currency: string;
  recipientName: string;
  recipientPhone?: string;
  recipientEmail?: string;
  bankCode?: string;
  accountNumber?: string;
  method: PayoutMethod;
  reference: string;
  description?: string;
}

interface PayoutResponse {
  success: boolean;
  transactionId?: string;
  reference: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  message?: string;
  provider: PaymentProvider;
  estimatedDelivery?: string;
}

interface TransactionStatus {
  transactionId: string;
  reference: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  amount: number;
  currency: string;
  provider: PaymentProvider;
  providerRef?: string;
  createdAt: string;
  updatedAt: string;
  message?: string;
}

interface SupportedBank {
  code: string;
  name: string;
  logo?: string;
  supportedMethods: PayoutMethod[];
}

const ETHIOPIAN_BANKS: SupportedBank[] = [
  { code: 'CBE', name: 'Commercial Bank of Ethiopia', supportedMethods: ['bank_transfer', 'mobile_wallet'] },
  { code: 'AIB', name: 'Awash International Bank', supportedMethods: ['bank_transfer'] },
  { code: 'DB', name: 'Dashen Bank', supportedMethods: ['bank_transfer'] },
  { code: 'BOA', name: 'Bank of Abyssinia', supportedMethods: ['bank_transfer'] },
  { code: 'WB', name: 'Wegagen Bank', supportedMethods: ['bank_transfer'] },
  { code: 'UB', name: 'United Bank', supportedMethods: ['bank_transfer'] },
  { code: 'NIB', name: 'Nib International Bank', supportedMethods: ['bank_transfer'] },
  { code: 'CBO', name: 'Cooperative Bank of Oromia', supportedMethods: ['bank_transfer'] },
  { code: 'LIB', name: 'Lion International Bank', supportedMethods: ['bank_transfer'] },
  { code: 'ZB', name: 'Zemen Bank', supportedMethods: ['bank_transfer'] },
  { code: 'OIB', name: 'Oromia International Bank', supportedMethods: ['bank_transfer'] },
  { code: 'BIB', name: 'Bunna International Bank', supportedMethods: ['bank_transfer'] },
  { code: 'ABAY', name: 'Abay Bank', supportedMethods: ['bank_transfer'] },
  { code: 'ENAT', name: 'Enat Bank', supportedMethods: ['bank_transfer'] },
  { code: 'ADDIS', name: 'Addis International Bank', supportedMethods: ['bank_transfer'] },
];

const MOBILE_WALLETS = [
  { id: 'telebirr', name: 'Telebirr', provider: 'ethio_telecom' },
  { id: 'cbe_birr', name: 'CBE Birr', provider: 'CBE' },
  { id: 'm_pesa', name: 'M-Pesa', provider: 'safaricom' },
  { id: 'amole', name: 'Amole', provider: 'dashen' },
  { id: 'hellocash', name: 'HelloCash', provider: 'multiple' },
];

class PaymentGatewayService {
  private configs: Record<PaymentProvider, PaymentConfig> = {
    telebirr: {
      provider: 'telebirr',
      apiBaseUrl: 'https://api.telebirr.com',
      callbackUrl: 'https://sumsuma.com/webhooks/telebirr',
      isTestMode: true,
    },
    chapa: {
      provider: 'chapa',
      apiBaseUrl: 'https://api.chapa.co',
      callbackUrl: 'https://sumsuma.com/webhooks/chapa',
      isTestMode: true,
    },
    santimpay: {
      provider: 'santimpay',
      apiBaseUrl: 'https://api.santimpay.com',
      callbackUrl: 'https://sumsuma.com/webhooks/santimpay',
      isTestMode: true,
    },
  };

  private readonly TRANSACTIONS_KEY = 'gateway_transactions';

  async initializeTelebirr(publicKey: string, merchantId: string): Promise<void> {
    this.configs.telebirr.publicKey = publicKey;
    this.configs.telebirr.merchantId = merchantId;
    console.log('Telebirr initialized');
  }

  async initializeChapa(publicKey: string): Promise<void> {
    this.configs.chapa.publicKey = publicKey;
    console.log('Chapa initialized');
  }

  async initializeSantimPay(merchantId: string): Promise<void> {
    this.configs.santimpay.merchantId = merchantId;
    console.log('SantimPay initialized');
  }

  async initiatePayment(provider: PaymentProvider, request: PaymentRequest): Promise<PaymentResponse> {
    const config = this.configs[provider];

    const transactionId = this.generateTransactionId(provider);
    const checkoutUrl = this.generateMockCheckoutUrl(provider, transactionId);

    const response: PaymentResponse = {
      success: true,
      transactionId,
      paymentUrl: checkoutUrl,
      checkoutUrl,
      reference: request.reference,
      status: 'pending',
      provider,
      message: `Payment initiated with ${provider}`,
    };

    await this.saveTransaction({
      transactionId,
      reference: request.reference,
      status: 'pending',
      amount: request.amount,
      currency: request.currency,
      provider,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    console.log(`Payment initiated via ${provider}:`, response);
    return response;
  }

  async initiatePayout(provider: PaymentProvider, request: PayoutRequest): Promise<PayoutResponse> {
    const connectorProvider = this.toConnectorProvider(provider);

    try {
      const result = await payoutConnectors.sendPayout({
        userId: request.reference.split('-')[0] || 'unknown',
        amount: request.amount,
        currency: request.currency,
        recipientAccount: request.accountNumber || request.recipientPhone || '',
        recipientName: request.recipientName,
        recipientPhone: request.recipientPhone,
        payoutMethod: request.method,
        bankCode: request.bankCode,
        description: request.description,
        metadata: { legacyReference: request.reference },
      });

      const response: PayoutResponse = {
        success: result.payoutStatus !== 'FAILED',
        transactionId: result.id,
        reference: request.reference,
        status: result.payoutStatus === 'COMPLETED' ? 'completed'
          : result.payoutStatus === 'FAILED' ? 'failed' : 'processing',
        provider,
        message: result.lastError || `Payout initiated to ${request.recipientName}`,
        estimatedDelivery: this.calculateEstimatedDelivery(request.method),
      };

      await this.saveTransaction({
        transactionId: result.id,
        reference: request.reference,
        status: response.status as TransactionStatus['status'],
        amount: request.amount,
        currency: request.currency,
        provider,
        providerRef: result.providerRef,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        message: `Payout to ${request.recipientName} via ${request.method}`,
      });

      console.log(`Payout initiated via ${provider} [${connectorProvider}]:`, response);
      return response;
    } catch (error: any) {
      const fallbackId = this.generateTransactionId(provider);
      const response: PayoutResponse = {
        success: false,
        transactionId: fallbackId,
        reference: request.reference,
        status: 'failed',
        provider,
        message: error.message || 'Payout failed',
      };

      await this.saveTransaction({
        transactionId: fallbackId,
        reference: request.reference,
        status: 'failed',
        amount: request.amount,
        currency: request.currency,
        provider,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        message: `FAILED: ${error.message}`,
      });

      return response;
    }
  }

  private toConnectorProvider(provider: PaymentProvider): ConnectorProvider {
    switch (provider) {
      case 'chapa': return 'CHAPA';
      case 'telebirr': return 'TELEBIRR';
      default: return 'BANK';
    }
  }

  async checkTransactionStatus(provider: PaymentProvider, transactionId: string): Promise<TransactionStatus> {
    const transactions = await this.getStoredTransactions();
    const transaction = transactions.find(t => t.transactionId === transactionId);

    if (transaction && transaction.status !== 'processing') {
      return transaction;
    }

    if (transaction) {
      if (transaction.providerRef) {
        try {
          const connectorProvider = this.toConnectorProvider(provider);
          const liveStatus = await payoutConnectors.checkPayoutStatus(
            connectorProvider,
            transaction.providerRef
          );

          const mapped = liveStatus.payoutStatus === 'COMPLETED' ? 'completed' as const
            : liveStatus.payoutStatus === 'FAILED' ? 'failed' as const
            : 'processing' as const;

          if (mapped !== transaction.status) {
            transaction.status = mapped;
            transaction.updatedAt = new Date().toISOString();
            await this.updateStoredTransaction(transactionId, { status: mapped });
          }

          return transaction;
        } catch {
          return transaction;
        }
      }
      return transaction;
    }

    return {
      transactionId,
      reference: '',
      status: 'pending',
      amount: 0,
      currency: 'ETB',
      provider,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      message: 'Transaction not found',
    };
  }

  private async updateStoredTransaction(
    transactionId: string,
    updates: Partial<TransactionStatus>
  ): Promise<void> {
    try {
      const transactions = await this.getStoredTransactions();
      const idx = transactions.findIndex(t => t.transactionId === transactionId);
      if (idx >= 0) {
        transactions[idx] = { ...transactions[idx], ...updates, updatedAt: new Date().toISOString() };
        await AsyncStorage.setItem(this.TRANSACTIONS_KEY, JSON.stringify(transactions));
      }
    } catch (e) {
      console.error('Failed to update stored transaction:', e);
    }
  }

  async verifyPayment(provider: PaymentProvider, transactionId: string): Promise<boolean> {
    console.log(`Verifying payment ${transactionId} with ${provider}`);
    
    const transactions = await this.getStoredTransactions();
    const index = transactions.findIndex(t => t.transactionId === transactionId);
    
    if (index >= 0) {
      transactions[index].status = 'completed';
      transactions[index].updatedAt = new Date().toISOString();
      await AsyncStorage.setItem(this.TRANSACTIONS_KEY, JSON.stringify(transactions));
      return true;
    }

    return Math.random() > 0.1;
  }

  getSupportedBanks(): SupportedBank[] {
    return ETHIOPIAN_BANKS;
  }

  getMobileWallets(): typeof MOBILE_WALLETS {
    return MOBILE_WALLETS;
  }

  getProviderFees(provider: PaymentProvider, amount: number): { fee: number; percentage: number } {
    const feeStructures: Record<PaymentProvider, { percentage: number; minFee: number; maxFee: number }> = {
      telebirr: { percentage: 1.5, minFee: 5, maxFee: 200 },
      chapa: { percentage: 2.9, minFee: 10, maxFee: 500 },
      santimpay: { percentage: 2.0, minFee: 5, maxFee: 300 },
    };

    const structure = feeStructures[provider];
    let fee = amount * (structure.percentage / 100);
    fee = Math.max(fee, structure.minFee);
    fee = Math.min(fee, structure.maxFee);

    return {
      fee: Math.round(fee * 100) / 100,
      percentage: structure.percentage,
    };
  }

  isProviderAvailable(provider: PaymentProvider): boolean {
    const config = this.configs[provider];
    return true;
  }

  getProviderInfo(provider: PaymentProvider): { name: string; description: string; logo: string; currencies: string[] } {
    const info: Record<PaymentProvider, { name: string; description: string; logo: string; currencies: string[] }> = {
      telebirr: {
        name: 'Telebirr',
        description: 'Ethiopia\'s largest mobile money platform by Ethio Telecom',
        logo: 'telebirr_logo',
        currencies: ['ETB'],
      },
      chapa: {
        name: 'Chapa',
        description: 'Modern payment gateway for Ethiopian businesses',
        logo: 'chapa_logo',
        currencies: ['ETB', 'USD'],
      },
      santimpay: {
        name: 'SantimPay',
        description: 'Fast and secure payments across Ethiopia',
        logo: 'santimpay_logo',
        currencies: ['ETB'],
      },
    };

    return info[provider];
  }

  private generateTransactionId(provider: PaymentProvider): string {
    const prefix = provider.substring(0, 2).toUpperCase();
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }

  private generateMockCheckoutUrl(provider: PaymentProvider, transactionId: string): string {
    const baseUrls: Record<PaymentProvider, string> = {
      telebirr: 'https://checkout.telebirr.com',
      chapa: 'https://checkout.chapa.co',
      santimpay: 'https://checkout.santimpay.com',
    };
    return `${baseUrls[provider]}/pay/${transactionId}`;
  }

  private calculateEstimatedDelivery(method: PayoutMethod): string {
    const deliveryTimes: Record<PayoutMethod, number> = {
      bank_transfer: 24,
      mobile_wallet: 1,
      cash_pickup: 4,
    };

    const hours = deliveryTimes[method];
    const deliveryDate = new Date(Date.now() + hours * 60 * 60 * 1000);
    return deliveryDate.toISOString();
  }

  private async saveTransaction(transaction: TransactionStatus): Promise<void> {
    try {
      const transactions = await this.getStoredTransactions();
      transactions.unshift(transaction);
      
      const limited = transactions.slice(0, 100);
      await AsyncStorage.setItem(this.TRANSACTIONS_KEY, JSON.stringify(limited));
    } catch (error) {
      console.error('Failed to save transaction:', error);
    }
  }

  private async getStoredTransactions(): Promise<TransactionStatus[]> {
    try {
      const stored = await AsyncStorage.getItem(this.TRANSACTIONS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to get stored transactions:', error);
      return [];
    }
  }

  async getRecentTransactions(limit: number = 10): Promise<TransactionStatus[]> {
    const transactions = await this.getStoredTransactions();
    return transactions.slice(0, limit);
  }
}

export const paymentGatewayService = new PaymentGatewayService();
export { payoutConnectors } from './payoutConnectors';
export type { 
  PaymentProvider, 
  PayoutMethod, 
  PaymentRequest, 
  PaymentResponse, 
  PayoutRequest, 
  PayoutResponse,
  TransactionStatus,
  SupportedBank
};

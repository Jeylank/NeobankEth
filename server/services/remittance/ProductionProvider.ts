import type { IRemittanceProvider, RemittanceRequest, RemittanceResponse } from './IRemittanceProvider';

interface PayoutResult {
  id: string;
  provider: string;
  providerRef: string;
  payoutStatus: string;
  lastError?: string;
}

interface PayoutConnectors {
  sendPayout(request: Record<string, unknown>): Promise<PayoutResult>;
}

export type PayoutConnectorsLoader = () => PayoutConnectors;

// Deferred so simulation mode never loads the mobile connector dependencies.
const loadPayoutConnectors: PayoutConnectorsLoader = () => {
  const module = require('../../../src/services/payoutConnectors') as {
    payoutConnectors: PayoutConnectors;
  };
  return module.payoutConnectors;
};

/** Production is selected only when APP_MODE is exactly "production". */
export class ProductionProvider implements IRemittanceProvider {
  constructor(private readonly connectorLoader: PayoutConnectorsLoader = loadPayoutConnectors) {}

  async initiate(request: RemittanceRequest): Promise<RemittanceResponse> {
    const metadata = request.metadata ?? {};
    const payoutMethod = metadata.payoutMethod;
    const recipientAccount = metadata.recipientAccount;
    const recipientName = metadata.recipientName;

    if (
      typeof recipientAccount !== 'string' ||
      typeof recipientName !== 'string' ||
      !['bank_transfer', 'mobile_wallet', 'cash_pickup'].includes(String(payoutMethod))
    ) {
      return {
        ok: false,
        status: 400,
        payload: {
          error: 'MISSING_PAYOUT_DETAILS',
          message: 'Production payouts require recipientAccount, recipientName, and payoutMethod metadata.',
        },
      };
    }

    const payout = await this.connectorLoader().sendPayout({
      userId: request.userId,
      amount: request.amount,
      currency: request.currency.toUpperCase(),
      recipientAccount,
      recipientName,
      payoutMethod,
      recipientPhone: typeof metadata.recipientPhone === 'string' ? metadata.recipientPhone : undefined,
      bankCode: typeof metadata.bankCode === 'string' ? metadata.bankCode : undefined,
      description: typeof metadata.description === 'string' ? metadata.description : undefined,
      metadata: Object.fromEntries(
        Object.entries(metadata)
          .filter(([, value]) => typeof value === 'string')
          .map(([key, value]) => [key, value as string]),
      ),
    });

    const failed = payout.payoutStatus === 'FAILED';
    return {
      ok: !failed,
      status: failed ? 502 : 201,
      payload: {
        transactionId: payout.id,
        provider: payout.provider,
        providerRef: payout.providerRef,
        status: payout.payoutStatus,
        ...(payout.lastError ? { error: 'PAYOUT_FAILED', message: payout.lastError } : {}),
      },
    };
  }
}

import type { RemittanceApiResponse, RemittanceApiStatus } from './api';

export interface MobileRemittanceRequest {
  userId: string;
  recipientId: string;
  amount: number;
  currency: string;
  quoteId?: string;
  payout_method: string;
}

export interface MobileRemittanceClient {
  initiateTransfer(request: MobileRemittanceRequest): Promise<RemittanceApiResponse>;
  confirmPayment(
    transactionId: string,
    outcome?: 'confirmed' | 'failed',
  ): Promise<RemittanceApiResponse>;
}

const VALID_INITIATION_STATES = new Set<RemittanceApiStatus>([
  'PAYMENT_PENDING',
  'PAYMENT_CONFIRMING',
  'PENDING_REVIEW',
  'FUNDS_RECEIVED',
  'AGENT_ASSIGNED',
  'PROCESSING',
  'OTP_SENT',
  'READY_FOR_PAYOUT',
  'RECOVERY_PENDING',
  'PAID_OUT',
  'COMPLETED',
  'PENDING_LIQUIDITY',
  'PENDING_REQUOTE',
]);

const FAILED_INITIATION_STATES = new Set<RemittanceApiStatus>([
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED',
  'REFUNDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
]);

const CONFIRMATION_REQUIRED_STATES = new Set<RemittanceApiStatus>([
  'PAYMENT_PENDING',
  'PAYMENT_CONFIRMING',
]);

export function isValidRemittanceInitiationState(
  status: RemittanceApiResponse['status'] | undefined,
): status is RemittanceApiStatus {
  return !!status && (VALID_INITIATION_STATES.has(status) || FAILED_INITIATION_STATES.has(status));
}

export async function executeRemittanceFlow(
  client: MobileRemittanceClient,
  request: MobileRemittanceRequest,
  onPaymentPending?: (pending: RemittanceApiResponse) => void,
): Promise<RemittanceApiResponse> {
  const initiated = await client.initiateTransfer(request);
  if (!initiated.transactionId || !isValidRemittanceInitiationState(initiated.status)) {
    throw new Error(`Unexpected remittance initiation state: ${initiated.status ?? 'unknown'}`);
  }

  if (FAILED_INITIATION_STATES.has(initiated.status)) {
    throw new Error(`Remittance initiation failed: ${initiated.status}`);
  }

  if (!CONFIRMATION_REQUIRED_STATES.has(initiated.status)) {
    return initiated;
  }

  onPaymentPending?.(initiated);

  // A rejected confirmation remains an error. This function never creates a
  // local transaction or substitutes a synthetic success response.
  const confirmed = await client.confirmPayment(initiated.transactionId, 'confirmed');
  if (CONFIRMATION_REQUIRED_STATES.has(confirmed.status) || FAILED_INITIATION_STATES.has(confirmed.status)) {
    throw new Error(`Payment was not confirmed: ${confirmed.status}`);
  }
  return confirmed;
}

export interface RemittanceRequest {
  userId: string;
  recipientId: string;
  amount: number;
  currency: string;
  type: string;
  quoteId?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string | null;
  forcedRate?: number;
}

export interface RemittanceResponse {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
}

export interface IRemittanceProvider {
  initiate(request: RemittanceRequest): Promise<RemittanceResponse>;
}

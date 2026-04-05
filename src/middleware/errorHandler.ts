/**
 * errorHandler.ts
 * ────────────────
 * Global error handling for the Sumsuma backend worker and API layer.
 *
 * Responsibilities:
 *   - Recognise all custom error classes and map them to structured responses
 *   - Log every error to Firestore `system_errors` for admin visibility
 *   - Return a consistent { success, errorCode, message } envelope
 *
 * Usage (Express middleware pattern — slot in when backend is added):
 *   app.use(expressErrorHandler);
 *
 * Usage (standalone / worker):
 *   const response = handleError(err, { requestId, endpoint, userId });
 */

import { collection, addDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { SettlementError, ReconciliationError } from '../types';
import {
  FxQuoteExpiredError,
  FxAmountMismatchError,
  FxQuoteNotFoundError,
  FxQuoteAlreadyUsedError,
  FxInsufficientLiquidityError,
} from '../services/fxMarketplaceService';

// ─── Custom Error Classes ────────────────────────────────────────────────────

export class IdempotencyError extends Error {
  code = 'DUPLICATE_REQUEST';
  constructor(key: string) {
    super(`Duplicate request: idempotency key '${key}' already used`);
    this.name = 'IdempotencyError';
    Object.setPrototypeOf(this, IdempotencyError.prototype);
  }
}

export class RateLimitError extends Error {
  code = 'RATE_LIMIT_EXCEEDED';
  retryAfterMs: number;
  constructor(endpoint: string, retryAfterMs = 60_000) {
    super(`Rate limit exceeded for ${endpoint}`);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class WebhookVerificationError extends Error {
  code = 'WEBHOOK_SIGNATURE_INVALID';
  constructor(provider: string) {
    super(`HMAC signature verification failed for provider: ${provider}`);
    this.name = 'WebhookVerificationError';
    Object.setPrototypeOf(this, WebhookVerificationError.prototype);
  }
}

export class FraudBlockError extends Error {
  code = 'TRANSACTION_BLOCKED';
  riskScore: number;
  constructor(riskScore: number) {
    super(`Transaction blocked due to high fraud risk score: ${riskScore}`);
    this.name = 'FraudBlockError';
    this.riskScore = riskScore;
    Object.setPrototypeOf(this, FraudBlockError.prototype);
  }
}

export class ValidationError extends Error {
  code = 'VALIDATION_ERROR';
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

// ─── Error Response Shape ────────────────────────────────────────────────────

export interface ErrorResponse {
  success: false;
  errorCode: string;
  message: string;
  requestId?: string;
  retryAfterMs?: number;
}

// ─── Error → Code Mapping ────────────────────────────────────────────────────

function resolveErrorCode(err: unknown): string {
  if (err instanceof FxQuoteExpiredError)          return 'QUOTE_EXPIRED';
  if (err instanceof FxAmountMismatchError)         return 'AMOUNT_MISMATCH';
  if (err instanceof FxQuoteNotFoundError)          return 'QUOTE_NOT_FOUND';
  if (err instanceof FxQuoteAlreadyUsedError)       return 'QUOTE_ALREADY_USED';
  if (err instanceof FxInsufficientLiquidityError)  return 'INSUFFICIENT_LIQUIDITY';
  if (err instanceof SettlementError)               return (err as SettlementError).code || 'SETTLEMENT_ERROR';
  if (err instanceof ReconciliationError)           return 'RECONCILIATION_ERROR';
  if (err instanceof IdempotencyError)              return 'DUPLICATE_REQUEST';
  if (err instanceof RateLimitError)                return 'RATE_LIMIT_EXCEEDED';
  if (err instanceof WebhookVerificationError)      return 'WEBHOOK_SIGNATURE_INVALID';
  if (err instanceof FraudBlockError)               return 'TRANSACTION_BLOCKED';
  if (err instanceof ValidationError)               return 'VALIDATION_ERROR';
  return 'INTERNAL_ERROR';
}

function resolveMessage(err: unknown): string {
  if (err instanceof FxQuoteExpiredError)   return 'Quote expired, please refresh the rate';
  if (err instanceof RateLimitError)        return 'Too many requests, please slow down';
  if (err instanceof WebhookVerificationError) return 'Webhook signature invalid — request rejected';
  if (err instanceof FraudBlockError)       return 'Transaction blocked — contact support';
  if (err instanceof IdempotencyError)      return 'Duplicate request — this transfer is already being processed';
  if (err instanceof Error)                 return err.message;
  return 'An unexpected error occurred';
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export interface ErrorContext {
  requestId?: string;
  endpoint?: string;
  userId?: string;
  method?: string;
}

/**
 * handleError — convert any thrown value into a structured ErrorResponse.
 * Also fires a non-blocking Firestore write to `system_errors`.
 */
export function handleError(err: unknown, context: ErrorContext = {}): ErrorResponse {
  const errorCode = resolveErrorCode(err);
  const message   = resolveMessage(err);

  const response: ErrorResponse = {
    success: false,
    errorCode,
    message,
    requestId: context.requestId,
  };

  if (err instanceof RateLimitError) {
    response.retryAfterMs = err.retryAfterMs;
  }

  // Non-blocking Firestore log
  logErrorToFirestore(err, errorCode, context).catch(() => {});

  return response;
}

// ─── Firestore Error Logger ───────────────────────────────────────────────────

const SYSTEM_ERRORS_COL = 'system_errors';

export async function logErrorToFirestore(
  err: unknown,
  errorCode: string,
  context: ErrorContext = {},
): Promise<void> {
  try {
    await addDoc(collection(db, SYSTEM_ERRORS_COL), {
      errorCode,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      requestId: context.requestId ?? null,
      endpoint: context.endpoint ?? null,
      userId: context.userId ?? null,
      method: context.method ?? null,
      occurredAt: new Date().toISOString(),
    });
  } catch {
    // Fail silently — never let error logging crash the app
  }
}

/**
 * expressErrorHandler — drop-in Express error middleware.
 * Mount as: app.use(expressErrorHandler)
 */
export function expressErrorHandler(
  err: unknown,
  req: { method: string; path: string; headers: Record<string, string | undefined> },
  res: { status: (n: number) => { json: (b: unknown) => void } },
  _next: unknown,
): void {
  const requestId = req.headers['x-request-id'];
  const userId    = req.headers['x-user-id'];

  const statusCode =
    err instanceof RateLimitError   ? 429 :
    err instanceof FraudBlockError  ? 403 :
    err instanceof ValidationError  ? 422 :
    err instanceof IdempotencyError ? 409 :
    err instanceof WebhookVerificationError ? 401 :
    500;

  const response = handleError(err, {
    requestId,
    userId,
    endpoint: req.path,
    method: req.method,
  });

  res.status(statusCode).json(response);
}

/**
 * server/services/riskControls/errors.ts
 * ────────────────────────────────────────
 * Typed custom error classes for the Risk Controls Layer.
 * All errors carry a machine-readable `code`, human-readable `message`,
 * and optional structured `details` for the API response.
 */

export interface RiskErrorDetails {
  limit?:   number;
  current?: number;
  currency?: string;
  feature?: string;
  userId?:  string;
  reason?:  string;
  [key: string]: unknown;
}

export class RiskControlError extends Error {
  readonly code:    string;
  readonly details: RiskErrorDetails;
  readonly httpStatus: number;

  constructor(code: string, message: string, details: RiskErrorDetails = {}, httpStatus = 422) {
    super(message);
    this.name       = 'RiskControlError';
    this.code       = code;
    this.details    = details;
    this.httpStatus = httpStatus;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export class FeatureDisabledError extends RiskControlError {
  constructor(feature: string, reason?: string) {
    super(
      'FEATURE_DISABLED',
      'This service is temporarily unavailable. Please try again later.',
      { feature, reason },
      503,
    );
    this.name = 'FeatureDisabledError';
  }
}

export class LimitExceededError extends RiskControlError {
  constructor(limitKey: string, current: number, limit: number, currency?: string) {
    super(
      'LIMIT_EXCEEDED',
      `Transaction exceeds the allowed limit (${limit}${currency ? ' ' + currency : ''}).`,
      { limitKey, current, limit, currency },
      422,
    );
    this.name = 'LimitExceededError';
  }
}

export class VelocityLimitExceededError extends RiskControlError {
  constructor(limitKey: string, current: number, limit: number) {
    super(
      'VELOCITY_LIMIT_EXCEEDED',
      'Too many transactions in a short period. Please wait before trying again.',
      { limitKey, current, limit },
      429,
    );
    this.name = 'VelocityLimitExceededError';
  }
}

export class ReviewRequiredError extends RiskControlError {
  constructor(reason?: string) {
    super(
      'REVIEW_REQUIRED',
      'This transaction requires manual review before it can proceed.',
      { reason },
      403,
    );
    this.name = 'ReviewRequiredError';
  }
}

export class UserFrozenError extends RiskControlError {
  constructor(userId: string, reason?: string) {
    super(
      'USER_FROZEN',
      'Your account has been temporarily suspended. Please contact support.',
      { userId, reason },
      403,
    );
    this.name = 'UserFrozenError';
  }
}

export class SafetyGuardError extends RiskControlError {
  constructor(check: string, message: string, details?: RiskErrorDetails) {
    super('SAFETY_GUARD_FAILED', message, { check, ...details }, 422);
    this.name = 'SafetyGuardError';
  }
}

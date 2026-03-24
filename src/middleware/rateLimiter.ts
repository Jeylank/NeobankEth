/**
 * rateLimiter.ts
 * ───────────────
 * Firestore-based sliding window rate limiter for the Habeshare backend.
 *
 * Uses Firestore so rate limit state is shared across multiple worker processes
 * and server instances — no in-memory state required.
 *
 * Rules (matches spec):
 *   /api/payout      → 5 requests / 60s / user
 *   /api/fx/quotes   → 10 requests / 60s / user
 *   /api/auth        → 10 requests / 60s / IP
 *
 * Usage:
 *   const result = await checkPayoutLimit(userId);
 *   if (!result.allowed) throw new RateLimitError('/api/payout', result.retryAfterMs);
 *
 * Algorithm: fixed window with per-minute counter reset.
 * Firestore document: rate_limit_counters/{windowKey}
 */

import {
  doc,
  getDoc,
  setDoc,
  increment,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { RateLimitError } from './errorHandler';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterMs: number;
  windowKey: string;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowSecs: number;
}

const COL = 'rate_limit_counters';

// ─── Core Check ───────────────────────────────────────────────────────────────

/**
 * checkRateLimit — check and increment the rate limit counter for a key.
 *
 * @param identifier  - userId or IP address
 * @param endpoint    - the route being guarded (e.g. 'payout', 'fx_quotes')
 * @param config      - { maxRequests, windowSecs }
 * @returns RateLimitResult
 */
export async function checkRateLimit(
  identifier: string,
  endpoint: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const windowStart = Math.floor(Date.now() / (config.windowSecs * 1000));
  const windowKey   = `${endpoint}:${identifier}:${windowStart}`;
  const docRef      = doc(db, COL, windowKey);

  try {
    const snap = await getDoc(docRef);

    if (!snap.exists()) {
      // First request in this window
      await setDoc(docRef, {
        count: 1,
        identifier,
        endpoint,
        windowStart,
        expiresAt: new Date(Date.now() + config.windowSecs * 1000).toISOString(),
        createdAt: serverTimestamp(),
      });

      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        limit: config.maxRequests,
        retryAfterMs: 0,
        windowKey,
      };
    }

    const current = (snap.data().count as number) ?? 0;

    if (current >= config.maxRequests) {
      const windowEndsAt = (windowStart + 1) * config.windowSecs * 1000;
      const retryAfterMs = Math.max(0, windowEndsAt - Date.now());
      return {
        allowed: false,
        remaining: 0,
        limit: config.maxRequests,
        retryAfterMs,
        windowKey,
      };
    }

    // Increment counter
    await setDoc(docRef, { count: increment(1) }, { merge: true });

    return {
      allowed: true,
      remaining: config.maxRequests - current - 1,
      limit: config.maxRequests,
      retryAfterMs: 0,
      windowKey,
    };
  } catch {
    // Fail-open: if Firestore is unavailable, allow the request.
    // Better to serve than to block valid users during a DB outage.
    return {
      allowed: true,
      remaining: config.maxRequests,
      limit: config.maxRequests,
      retryAfterMs: 0,
      windowKey,
    };
  }
}

// ─── Pre-configured Limiters ─────────────────────────────────────────────────

/** Payout limiter — 5 req/60s per user */
export async function checkPayoutLimit(userId: string): Promise<RateLimitResult> {
  return checkRateLimit(userId, 'payout', { maxRequests: 5, windowSecs: 60 });
}

/** FX quotes limiter — 10 req/60s per user */
export async function checkFxQuoteLimit(userId: string): Promise<RateLimitResult> {
  return checkRateLimit(userId, 'fx_quotes', { maxRequests: 10, windowSecs: 60 });
}

/** Auth limiter — 10 req/60s per IP */
export async function checkAuthLimit(ip: string): Promise<RateLimitResult> {
  return checkRateLimit(ip, 'auth', { maxRequests: 10, windowSecs: 60 });
}

// ─── Express Middleware Factory ───────────────────────────────────────────────

/**
 * createRateLimitMiddleware — wraps checkRateLimit in an Express-compatible middleware.
 *
 * Usage:
 *   app.use('/api/payout', createRateLimitMiddleware('payout', { maxRequests: 5, windowSecs: 60 }));
 */
export function createRateLimitMiddleware(
  endpoint: string,
  config: RateLimitConfig,
  identifierFn?: (req: any) => string,
) {
  return async (
    req: { headers: Record<string, string | undefined>; ip?: string },
    res: { status: (n: number) => { json: (b: unknown) => void }; setHeader: (k: string, v: string) => void },
    next: () => void,
  ): Promise<void> => {
    const identifier =
      identifierFn
        ? identifierFn(req)
        : (req.headers['x-user-id'] ?? req.ip ?? 'anonymous');

    const result = await checkRateLimit(identifier, endpoint, config);

    res.setHeader('X-RateLimit-Limit',     String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      res.status(429).json({
        success: false,
        errorCode: 'RATE_LIMIT_EXCEEDED',
        message: `Too many requests for ${endpoint}. Please retry after ${Math.ceil(result.retryAfterMs / 1000)}s.`,
        retryAfterMs: result.retryAfterMs,
      });
      return;
    }

    next();
  };
}

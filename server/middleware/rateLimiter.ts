/**
 * server/middleware/rateLimiter.ts
 * ─────────────────────────────────
 * Tiered rate limiting for the Simulation API.
 *
 * Three tiers — each scoped by API-key (if present) or IP:
 *
 *   readLimiter        — GET endpoints            120 req / min
 *   writeLimiter       — mutating endpoints         30 req / min
 *   destructiveLimiter — reset / drain / seed /
 *                        circuit-breaker trips       10 req / min
 *
 * When the limit is exceeded the server returns:
 *   HTTP 429  { error: "RATE_LIMIT_EXCEEDED", message, retryAfterSeconds }
 *
 * Standard RateLimit-* headers are included on every response so clients
 * can observe remaining quota without hitting the limit.
 */

import rateLimit, { Options, RateLimitRequestHandler, ipKeyGenerator } from 'express-rate-limit';
import { Request, Response } from 'express';

// ─── Key generator ────────────────────────────────────────────────────────────
// Prefer the API key (one bucket per caller regardless of IP).
// Fall back to IP using the official ipKeyGenerator helper (IPv6-safe).
function keyGenerator(req: Request): string {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && typeof apiKey === 'string' && apiKey.length > 0) return `apikey:${apiKey}`;
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  return `ip:${ipKeyGenerator(ip)}`;
}

// ─── Shared handler ───────────────────────────────────────────────────────────
function handler(req: Request, res: Response, _next: () => void, options: Options): void {
  const retryAfter = Math.ceil((options.windowMs ?? 60_000) / 1000);
  res.status(429).json({
    error:             'RATE_LIMIT_EXCEEDED',
    message:           `Too many requests. Please wait ${retryAfter}s before retrying.`,
    retryAfterSeconds: retryAfter,
    limit:             options.max,
  });
}

// ─── Tier factory ─────────────────────────────────────────────────────────────
function makeLimiter(max: number, windowMs = 60_000): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,   // Return RateLimit-* headers
    legacyHeaders:   false,
    keyGenerator,
    handler,
    skip: (req) => {
      // Never rate-limit the /health check
      return req.path === '/health';
    },
  });
}

// ─── Exported limiters ────────────────────────────────────────────────────────

/** GET endpoints — 120 req / min per API key or IP */
export const readLimiter = makeLimiter(120);

/** Mutating endpoints (initiate, topup, contribute, recurring, resume, campaign)
 *  — 30 req / min per API key or IP */
export const writeLimiter = makeLimiter(30);

/** High-impact endpoints (simulation reset/seed/drain, circuit-breaker trip)
 *  — 10 req / min per API key or IP */
export const destructiveLimiter = makeLimiter(10);

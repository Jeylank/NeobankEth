/**
 * server/middleware/apiKeyAuth.ts
 * ────────────────────────────────
 * Shared API-key authentication middleware used by simulation and agent-payout
 * routes. Reads the expected key from SIMULATION_API_KEY env var.
 */

import { Request, Response, NextFunction } from 'express';

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = process.env.SIMULATION_API_KEY;
  if (!expectedKey) {
    res.status(500).json({ error: 'SERVER_MISCONFIGURED', message: 'API key not set on server.' });
    return;
  }
  const provided = req.headers['x-api-key'] as string | undefined;
  if (!provided || provided !== expectedKey) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Missing or invalid X-API-Key header.',
    });
    return;
  }
  next();
}

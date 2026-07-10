/**
 * server/routes/auditLogs.ts
 * ──────────────────────────
 * Admin Audit Logs screen API — searchable/filterable unified event feed.
 *
 *   GET /api/admin/audit-logs
 *     Query params:
 *       type       — comma-separated AuditEventType(s), e.g. "LOGIN,SEND_MONEY"
 *       userId     — filter to a single user's events
 *       q          — free-text search across description/metadata
 *       startDate  — ISO date, inclusive lower bound
 *       endDate    — ISO date, inclusive upper bound
 *       limit      — max results (default 100, max 500)
 *
 *   GET /api/admin/audit-logs/types
 *     Returns the fixed list of supported event types (for filter UI).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { verifyAdmin }   from '../middleware/auth';
import { requireApiKey } from '../middleware/apiKeyAuth';
import { readLimiter }   from '../middleware/rateLimiter';
import { queryAuditLogs, AUDIT_EVENT_TYPES, AuditEventType } from '../services/auditLogService';

const router = Router();

function requireAdminOrApiKey(req: Request, res: Response, next: NextFunction): void {
  if (req.headers['x-api-key']) {
    requireApiKey(req, res, next);
  } else {
    verifyAdmin(req, res, next);
  }
}

router.get('/audit-logs/types', requireAdminOrApiKey, readLimiter, (_req: Request, res: Response): void => {
  res.json({ types: AUDIT_EVENT_TYPES });
});

router.get('/audit-logs', requireAdminOrApiKey, readLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, userId, q, startDate, endDate, limit } = req.query as Record<string, string | undefined>;
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    if (limit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit! < 1 || parsedLimit! > 500)) {
      res.status(400).json({ error: 'INVALID_LIMIT', message: 'limit must be an integer from 1 to 500.' }); return;
    }
    if (userId && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(userId)) {
      res.status(400).json({ error: 'INVALID_ID', message: 'Invalid user ID.' }); return;
    }
    const startMs = startDate ? Date.parse(startDate) : NaN;
    const endMs = endDate ? Date.parse(endDate) : NaN;
    if ((startDate && !Number.isFinite(startMs)) || (endDate && !Number.isFinite(endMs)) || (startDate && endDate && startMs > endMs)) {
      res.status(400).json({ error: 'INVALID_DATE_RANGE', message: 'Provide a valid date range with startDate before endDate.' }); return;
    }

    const types = type
      ? type.split(',').map((t) => t.trim().toUpperCase()).filter((t): t is AuditEventType => AUDIT_EVENT_TYPES.includes(t as AuditEventType))
      : undefined;

    const result = await queryAuditLogs({
      types,
      userId,
      q,
      startDate,
      endDate,
      limit: parsedLimit,
    });

    res.json({ ...result, fetchedAt: new Date().toISOString() });
  } catch (err: any) {
    console.error('[AuditLogs] GET /audit-logs: internal failure');
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'The request could not be completed.' });
  }
});

export default router;

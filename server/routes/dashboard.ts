/**
 * server/routes/dashboard.ts
 * ───────────────────────────
 * Admin Dashboard API. Mounted at /api/admin in server/index.ts.
 *
 * All endpoints accept either:
 *   • Authorization: Bearer <Firebase admin token>   (production)
 *   • X-API-Key: <SIMULATION_API_KEY>                (QA / simulation)
 *
 * GET /api/admin/dashboard/transfers
 *   Transfer state summary, stuck transactions, recent failures, recent history.
 *
 * GET /api/admin/dashboard/agents
 *   Agent roster, per-city stats, low-float warnings.
 *
 * GET /api/admin/dashboard/alerts
 *   Actionable alert feed: stuck transfers, low float, fraud review, failures.
 *   Sorted by severity: critical → high → medium → low.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireApiKey } from '../middleware/apiKeyAuth';
import { verifyAdmin }   from '../middleware/auth';
import { readLimiter }   from '../middleware/rateLimiter';
import {
  getTransfersDashboard,
  getAgentsDashboard,
  getAlertsDashboard,
  LOW_FLOAT_THRESHOLD_ETB,
  STUCK_UNASSIGNED_THRESHOLD_MS,
} from '../services/dashboardService';
import { AGENT_RESPONSE_TIMEOUT_MS, OTP_FLOW_TIMEOUT_MS, MAX_ASSIGNMENT_ATTEMPTS } from '../services/agentPayoutService';

const router = Router();

// ─── Auth: accept Firebase admin token OR simulation API key ─────────────────
// Firebase tokens are used in production; API key is used for QA / simulation.

function requireAdminOrApiKey(req: Request, res: Response, next: NextFunction): void {
  const hasApiKey = Boolean(req.headers['x-api-key']);
  if (hasApiKey) {
    requireApiKey(req, res, next);
  } else {
    verifyAdmin(req, res, next);
  }
}

// ─── Shared error handler ─────────────────────────────────────────────────────

function handleError(res: Response, err: unknown, context: string): void {
  const msg = (err as Error).message ?? 'Unexpected error';
  console.error(`[Dashboard] ${context}: ${msg}`);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: msg });
}

// ─── Transfers ────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/dashboard/transfers
 *
 * Response shape:
 * {
 *   summary:       { COMPLETED: 120, FAILED: 8, AGENT_ASSIGNED: 3, ... }
 *   totalCount:    number
 *   stuck:         StuckTransfer[]   — AGENT_ASSIGNED stale, OTP_SENT timeout, FUNDS_RECEIVED unassigned
 *   recentFailed:  Transfer[]        — FAILED / TIMED_OUT in last 24 h
 *   recent:        Transfer[]        — 20 most recent (any state)
 *   thresholds:    { agentResponseMs, otpFlowTimeoutMs, unassignedThresholdMs }
 *   fetchedAt:     ISO string
 * }
 */
router.get(
  '/dashboard/transfers',
  requireAdminOrApiKey,
  readLimiter,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await getTransfersDashboard();
      res.json({
        ...data,
        thresholds: {
          agentResponseMs:      AGENT_RESPONSE_TIMEOUT_MS,
          otpFlowTimeoutMs:     OTP_FLOW_TIMEOUT_MS,
          unassignedThresholdMs: STUCK_UNASSIGNED_THRESHOLD_MS,
        },
      });
    } catch (err) { handleError(res, err, 'GET /dashboard/transfers'); }
  },
);

// ─── Agents ───────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/dashboard/agents
 *
 * Response shape:
 * {
 *   summary:    { total, online, offline, lowFloat, totalFloat }
 *   byCity:     { "Addis Ababa": { total, online, offline, totalFloat, lowFloat }, ... }
 *   lowFloat:   Agent[]    — agents below LOW_FLOAT_THRESHOLD_ETB, sorted asc by float
 *   agents:     Agent[]    — full roster
 *   thresholds: { lowFloatETB, maxAssignmentAttempts }
 *   fetchedAt:  ISO string
 * }
 */
router.get(
  '/dashboard/agents',
  requireAdminOrApiKey,
  readLimiter,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await getAgentsDashboard();
      res.json({
        ...data,
        thresholds: {
          ...data.thresholds,
          maxAssignmentAttempts: MAX_ASSIGNMENT_ATTEMPTS,
        },
      });
    } catch (err) { handleError(res, err, 'GET /dashboard/agents'); }
  },
);

// ─── Alerts ───────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/dashboard/alerts
 *
 * Response shape:
 * {
 *   alerts:      DashboardAlert[]   — sorted critical → high → medium → low
 *   count:       number
 *   bySeverity:  { critical: 2, high: 3, medium: 1, low: 5 }
 *   thresholds:  { lowFloatETB, agentResponseMs, otpFlowTimeoutMs, unassignedThresholdMs }
 *   fetchedAt:   ISO string
 * }
 *
 * Alert types:
 *   STUCK_AGENT_UNRESPONSIVE  — agent assigned but not responded past deadline
 *   STUCK_OTP_TIMEOUT         — transfer in OTP_SENT > 15 min
 *   STUCK_UNASSIGNED          — FUNDS_RECEIVED > 10 min with no agent
 *   LOW_AGENT_FLOAT           — agent float below threshold
 *   AGENT_OFFLINE             — informational: N agents offline
 *   FAILED_TRANSFER           — FAILED in last 24 h
 *   TIMED_OUT_TRANSFER        — TIMED_OUT in last 24 h
 *   PENDING_FRAUD_REVIEW      — fraud_decisions awaiting review
 */
router.get(
  '/dashboard/alerts',
  requireAdminOrApiKey,
  readLimiter,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await getAlertsDashboard();
      res.json({
        ...data,
        thresholds: {
          lowFloatETB:           LOW_FLOAT_THRESHOLD_ETB,
          agentResponseMs:       AGENT_RESPONSE_TIMEOUT_MS,
          otpFlowTimeoutMs:      OTP_FLOW_TIMEOUT_MS,
          unassignedThresholdMs: STUCK_UNASSIGNED_THRESHOLD_MS,
        },
      });
    } catch (err) { handleError(res, err, 'GET /dashboard/alerts'); }
  },
);

export default router;

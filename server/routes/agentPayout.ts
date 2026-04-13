/**
 * server/routes/agentPayout.ts
 * ─────────────────────────────
 * Agent Cash-Payout HTTP layer. Mounted at /api/v1 in server/index.ts.
 * All endpoints require X-API-Key header (SIMULATION_API_KEY).
 *
 * POST   /agents                              — register a new agent
 * GET    /agents                              — list agents (?city=, ?status=)
 * GET    /agents/:id                          — single agent
 *
 * POST   /transfers/:id/assign-agent          — auto-assign best eligible agent
 * POST   /transfers/:id/retry-assignment      — manually retry a stale/failed assignment
 * POST   /agents/:id/accept-assignment        — agent accepts pending assignment
 * POST   /agents/:id/reject-assignment        — agent rejects (triggers auto-reassign)
 *
 * POST   /transfers/:id/send-otp              — generate 6-digit OTP (stale-check included)
 * POST   /payouts/verify-otp                  — verify OTP → payout token
 * POST   /payouts/mark-paid                   — execute payout
 *
 * GET    /transfers/:id/timeline              — full event log for a transfer
 * GET    /assignments/stale                   — scan all assignments past response deadline
 */

import { Router, Request, Response } from 'express';
import { requireApiKey } from '../middleware/apiKeyAuth';
import { readLimiter, writeLimiter } from '../middleware/rateLimiter';
import {
  AgentPayoutError,
  createAgent,
  listAgents,
  getAgent,
  assignBestAgent,
  respondToAssignment,
  checkAndReassignStaleAssignment,
  scanStaleAssignments,
  sendOtp,
  verifyOtp,
  markPaid,
  getTimeline,
  AGENT_RESPONSE_TIMEOUT_MS,
  MAX_ASSIGNMENT_ATTEMPTS,
  MAX_OTP_ATTEMPTS,
} from '../services/agentPayoutService';

const router = Router();

// ─── Shared error handler ─────────────────────────────────────────────────────

function handleError(
  res:     Response,
  err:     unknown,
  context: string,
): void {
  if (err instanceof AgentPayoutError) {
    console.error(`[AgentPayout] ${context}: [${err.code}] ${err.message}`);
    res.status(err.httpStatus).json({
      error:   err.code,
      message: err.message,
    });
  } else {
    const msg = (err as Error).message ?? 'Unexpected error';
    console.error(`[AgentPayout] ${context}: INTERNAL_ERROR — ${msg}`);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: msg });
  }
}

// ─── Agents ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/agents
 * Register a new payout agent.
 * Body: { full_name, phone, city, status?, available_float, score? }
 */
router.post('/agents', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { full_name, phone, city, status = 'online', available_float, score = 100 } = req.body ?? {};

    // Required fields
    const missing = (['full_name', 'phone', 'city'] as const).filter(f => !req.body?.[f]);
    if (missing.length) {
      res.status(400).json({ error: 'MISSING_FIELDS', message: `Required fields missing: ${missing.join(', ')}.` });
      return;
    }

    // Type checks
    if (typeof available_float !== 'number' || available_float < 0) {
      res.status(400).json({ error: 'INVALID_FLOAT', message: 'available_float must be a non-negative number.' });
      return;
    }
    if (!['online', 'offline'].includes(status)) {
      res.status(400).json({ error: 'INVALID_STATUS', message: 'status must be "online" or "offline".' });
      return;
    }
    if (typeof score !== 'number' || score < 0 || score > 1000) {
      res.status(400).json({ error: 'INVALID_SCORE', message: 'score must be a number between 0 and 1000.' });
      return;
    }

    const agent = await createAgent({ full_name, phone, city, status, available_float, score });
    res.status(201).json({ agent });
  } catch (err) { handleError(res, err, 'POST /agents'); }
});

/**
 * GET /api/v1/agents
 * List agents. Optional query params: ?city=  ?status=online|offline
 */
router.get('/agents', requireApiKey, readLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const city   = req.query.city   as string | undefined;
    const status = req.query.status as string | undefined;

    if (status && !['online', 'offline'].includes(status)) {
      res.status(400).json({ error: 'INVALID_STATUS', message: 'status must be "online" or "offline".' });
      return;
    }

    let agents = await listAgents(city);
    if (status) agents = agents.filter(a => a.status === status);

    res.json({ agents, count: agents.length, filter: { city: city ?? null, status: status ?? null } });
  } catch (err) { handleError(res, err, 'GET /agents'); }
});

/**
 * GET /api/v1/agents/:id
 */
router.get('/agents/:id', requireApiKey, readLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const agent = await getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'AGENT_NOT_FOUND', message: `Agent ${req.params.id} not found.` });
      return;
    }
    res.json({ agent });
  } catch (err) { handleError(res, err, 'GET /agents/:id'); }
});

// ─── Assignment ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/transfers/:id/assign-agent
 * Select and assign the highest-scoring eligible agent.
 * Body: { city? }  — required when transfer doc doesn't store recipient_city.
 */
router.post('/transfers/:id/assign-agent', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const city = (req.body?.city as string | undefined) || undefined;
    const { assignment, agent } = await assignBestAgent(req.params.id, city);
    res.status(201).json({
      message:          `Agent ${agent.full_name} assigned. Response required by ${assignment.response_deadline}.`,
      assignment,
      agent:            { id: agent.id, full_name: agent.full_name, city: agent.city, score: agent.score },
      attemptsAllowed:  MAX_ASSIGNMENT_ATTEMPTS,
      responseTimeout:  `${AGENT_RESPONSE_TIMEOUT_MS / 60_000} minutes`,
    });
  } catch (err) { handleError(res, err, `POST /transfers/${req.params.id}/assign-agent`); }
});

/**
 * POST /api/v1/transfers/:id/retry-assignment
 * Manually check for a stale assignment and reassign, OR force a fresh
 * assignment attempt (e.g. after "no agent available" was returned earlier).
 * Body: { city? }  — required if transfer doesn't have recipient_city stored.
 */
router.post('/transfers/:id/retry-assignment', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const transferId = req.params.id;

    // First check if there is a stale assignment to resolve
    const staleResult = await checkAndReassignStaleAssignment(transferId);

    if (staleResult.wasStale) {
      if (staleResult.reassignment) {
        const { assignment, agent } = staleResult.reassignment;
        res.json({
          message:        `Stale assignment resolved. New agent ${agent.full_name} assigned.`,
          timedOutAgent:  staleResult.timedOutAgentId,
          assignment,
          agent:          { id: agent.id, full_name: agent.full_name, city: agent.city, score: agent.score },
        });
      } else {
        res.status(422).json({
          error:          'NO_ELIGIBLE_AGENT',
          message:        staleResult.reason ?? 'No replacement agent available.',
          timedOutAgent:  staleResult.timedOutAgentId,
          suggestion:     'Add agents to this city or check agent float levels, then retry.',
        });
      }
      return;
    }

    // No stale assignment — attempt a fresh assign (e.g. from FUNDS_RECEIVED state)
    const city = (req.body?.city as string | undefined) || undefined;
    const { assignment, agent } = await assignBestAgent(transferId, city);
    res.status(201).json({
      message:         `Agent ${agent.full_name} assigned on retry. Response required by ${assignment.response_deadline}.`,
      assignment,
      agent:           { id: agent.id, full_name: agent.full_name, city: agent.city, score: agent.score },
      responseTimeout: `${AGENT_RESPONSE_TIMEOUT_MS / 60_000} minutes`,
    });
  } catch (err) { handleError(res, err, `POST /transfers/${req.params.id}/retry-assignment`); }
});

/**
 * POST /api/v1/agents/:id/accept-assignment
 */
router.post('/agents/:id/accept-assignment', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await respondToAssignment(req.params.id, 'accept');
    res.json({
      message:    'Assignment accepted.',
      assignment: result.assignment,
    });
  } catch (err) { handleError(res, err, `POST /agents/${req.params.id}/accept-assignment`); }
});

/**
 * POST /api/v1/agents/:id/reject-assignment
 * Agent rejects their current assignment.
 * Immediately triggers auto-reassignment to the next best agent (excluding the
 * rejecting agent). If no replacement is found, transfer returns to queue.
 */
router.post('/agents/:id/reject-assignment', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await respondToAssignment(req.params.id, 'reject');

    if (result.autoReassignment) {
      const { assignment: newAssign, agent: newAgent } = result.autoReassignment;
      res.json({
        message:          `Assignment rejected. Auto-reassigned to ${newAgent.full_name}.`,
        rejectedAssignment: result.assignment,
        newAssignment:    newAssign,
        newAgent:         { id: newAgent.id, full_name: newAgent.full_name, city: newAgent.city, score: newAgent.score },
        autoReassigned:   true,
      });
    } else {
      res.json({
        message:          'Assignment rejected. No replacement agent found — transfer returned to queue.',
        rejectedAssignment: result.assignment,
        autoReassigned:   false,
        noAgentReason:    result.noAgentReason,
        suggestion:       'Call POST /transfers/:id/retry-assignment when an agent becomes available.',
      });
    }
  } catch (err) { handleError(res, err, `POST /agents/${req.params.id}/reject-assignment`); }
});

// ─── OTP flow ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/transfers/:id/send-otp
 * Generate a 6-digit OTP. Checks for stale agent assignment first.
 * Resend-safe: replaces any existing OTP.
 * NOTE: otp is returned in plaintext for simulation/QA — remove in production.
 */
router.post('/transfers/:id/send-otp', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { otp, expiresAt, staleCheck } = await sendOtp(req.params.id);
    res.json({
      message:      'OTP generated and dispatched to recipient.',
      expiresAt,
      maxAttempts:  MAX_OTP_ATTEMPTS,
      otp,          // simulation only — remove in production
      ...(staleCheck?.wasStale ? { staleCheck } : {}),
    });
  } catch (err) { handleError(res, err, `POST /transfers/${req.params.id}/send-otp`); }
});

/**
 * POST /api/v1/payouts/verify-otp
 * Verify 6-digit OTP. Returns payout_token on success.
 * After MAX_OTP_ATTEMPTS wrong guesses the OTP is invalidated (429).
 * After expiry a fresh OTP must be requested (410).
 *
 * Body: { transfer_id, otp }
 */
router.post('/payouts/verify-otp', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { transfer_id, otp } = req.body ?? {};
    if (!transfer_id || !otp) {
      res.status(400).json({
        error:   'MISSING_FIELDS',
        message: 'transfer_id and otp are required.',
      });
      return;
    }
    const { payoutToken } = await verifyOtp(String(transfer_id), String(otp));
    res.json({
      message:      'OTP verified. Transfer approved for cash payout.',
      payout_token: payoutToken,
    });
  } catch (err) { handleError(res, err, 'POST /payouts/verify-otp'); }
});

/**
 * POST /api/v1/payouts/mark-paid
 * Execute cash payout. Atomically debits agent float, marks transfer PAID_OUT.
 * Idempotency guard prevents double-payout.
 *
 * Body: { transfer_id, payout_token }
 */
router.post('/payouts/mark-paid', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { transfer_id, payout_token } = req.body ?? {};
    if (!transfer_id || !payout_token) {
      res.status(400).json({
        error:   'MISSING_FIELDS',
        message: 'transfer_id and payout_token are required.',
      });
      return;
    }
    const { transfer, agent } = await markPaid(String(transfer_id), String(payout_token));
    res.json({
      message:  'Cash payout completed successfully.',
      transfer: { id: transfer_id, status: transfer.status, amount: transfer.amount, currency: transfer.currency },
      agent:    { id: agent.id, full_name: agent.full_name, available_float: agent.available_float },
    });
  } catch (err) { handleError(res, err, 'POST /payouts/mark-paid'); }
});

// ─── Observability ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/transfers/:id/timeline
 * Full chronological event log for a transfer.
 */
router.get('/transfers/:id/timeline', requireApiKey, readLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const events = await getTimeline(req.params.id);
    res.json({ transfer_id: req.params.id, events, count: events.length });
  } catch (err) { handleError(res, err, `GET /transfers/${req.params.id}/timeline`); }
});

/**
 * GET /api/v1/assignments/stale
 * List all assignments where the agent has not responded within the timeout window.
 * Useful for ops dashboards and triggering bulk re-assignment.
 *
 * Does NOT auto-reassign — call POST /transfers/:id/retry-assignment per transfer.
 */
router.get('/assignments/stale', requireApiKey, readLimiter, async (_req: Request, res: Response): Promise<void> => {
  try {
    const stale = await scanStaleAssignments();
    res.json({
      stale,
      count:          stale.length,
      responseTimeout: `${AGENT_RESPONSE_TIMEOUT_MS / 60_000} minutes`,
      timestamp:      new Date().toISOString(),
      note:           stale.length > 0
        ? 'Call POST /api/v1/transfers/:id/retry-assignment for each stale transfer.'
        : 'No stale assignments found.',
    });
  } catch (err) { handleError(res, err, 'GET /assignments/stale'); }
});

export default router;

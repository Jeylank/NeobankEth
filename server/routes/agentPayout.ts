/**
 * server/routes/agentPayout.ts
 * ─────────────────────────────
 * Agent Cash-Payout HTTP layer. Mounted at /api/v1 in server/index.ts.
 *
 * All endpoints require X-API-Key header (SIMULATION_API_KEY).
 *
 * POST   /agents                         — register a new agent
 * GET    /agents                         — list agents (optional ?city=)
 * GET    /agents/:id                     — get a single agent
 *
 * POST   /transfers/:id/assign-agent     — auto-assign best eligible agent
 * POST   /agents/:id/accept-assignment   — agent accepts their pending assignment
 * POST   /agents/:id/reject-assignment   — agent rejects, transfer returns to queue
 *
 * POST   /transfers/:id/send-otp         — generate & dispatch 6-digit OTP
 * POST   /payouts/verify-otp             — verify OTP, receive payout token
 * POST   /payouts/mark-paid              — execute payout (consumes payout token)
 *
 * GET    /transfers/:id/timeline         — full event log for a transfer
 */

import { Router, Request, Response } from 'express';
import { requireApiKey } from '../middleware/apiKeyAuth';
import { readLimiter, writeLimiter } from '../middleware/rateLimiter';
import {
  createAgent,
  listAgents,
  getAgent,
  assignBestAgent,
  respondToAssignment,
  sendOtp,
  verifyOtp,
  markPaid,
  getTimeline,
} from '../services/agentPayoutService';

const router = Router();

// ─── Agents ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/agents
 * Register a new payout agent.
 *
 * Body: { full_name, phone, city, status?, available_float, score? }
 */
router.post('/agents', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { full_name, phone, city, status = 'online', available_float, score = 100 } = req.body ?? {};

    if (!full_name || !phone || !city) {
      res.status(400).json({ error: 'MISSING_FIELDS', message: 'full_name, phone, and city are required.' });
      return;
    }
    if (typeof available_float !== 'number' || available_float < 0) {
      res.status(400).json({ error: 'INVALID_FLOAT', message: 'available_float must be a non-negative number.' });
      return;
    }
    if (!['online', 'offline'].includes(status)) {
      res.status(400).json({ error: 'INVALID_STATUS', message: 'status must be "online" or "offline".' });
      return;
    }

    const agent = await createAgent({ full_name, phone, city, status, available_float, score });
    res.status(201).json({ agent });
  } catch (err: any) {
    console.error('[AgentPayout] POST /agents error:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * GET /api/v1/agents
 * List agents. Optional query param: ?city=Addis+Ababa
 */
router.get('/agents', requireApiKey, readLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const city   = req.query.city as string | undefined;
    const agents = await listAgents(city);
    res.json({ agents, count: agents.length, filter: { city: city ?? null } });
  } catch (err: any) {
    console.error('[AgentPayout] GET /agents error:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * GET /api/v1/agents/:id
 * Fetch a single agent by Firestore document ID.
 */
router.get('/agents/:id', requireApiKey, readLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const agent = await getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'AGENT_NOT_FOUND', message: `Agent ${req.params.id} not found.` });
      return;
    }
    res.json({ agent });
  } catch (err: any) {
    console.error('[AgentPayout] GET /agents/:id error:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

// ─── Assignment ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/transfers/:id/assign-agent
 * Select and assign the highest-scoring eligible agent for a transfer.
 * Agent selection criteria: same city, online, float >= amount, sorted by score desc.
 */
router.post('/transfers/:id/assign-agent', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const city = (req.body?.city as string | undefined) || undefined;
    const { assignment, agent } = await assignBestAgent(req.params.id, city);
    res.status(201).json({
      message:    `Agent ${agent.full_name} assigned successfully.`,
      assignment,
      agent: { id: agent.id, full_name: agent.full_name, city: agent.city, score: agent.score },
    });
  } catch (err: any) {
    const isNotFound = err.message.includes('not found');
    const noAgent    = err.message.includes('No eligible agents');
    const status     = isNotFound ? 404 : noAgent ? 422 : 500;
    console.error(`[AgentPayout] POST /transfers/${req.params.id}/assign-agent error:`, err.message);
    res.status(status).json({ error: noAgent ? 'NO_ELIGIBLE_AGENT' : 'ASSIGNMENT_FAILED', message: err.message });
  }
});

/**
 * POST /api/v1/agents/:id/accept-assignment
 * Agent accepts their currently pending assignment.
 */
router.post('/agents/:id/accept-assignment', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const assignment = await respondToAssignment(req.params.id, 'accept');
    res.json({ message: 'Assignment accepted.', assignment });
  } catch (err: any) {
    const status = err.message.includes('No pending') ? 404 : 500;
    console.error(`[AgentPayout] POST /agents/${req.params.id}/accept-assignment error:`, err.message);
    res.status(status).json({ error: 'ACCEPT_FAILED', message: err.message });
  }
});

/**
 * POST /api/v1/agents/:id/reject-assignment
 * Agent rejects — transfer is returned to queue for re-assignment.
 */
router.post('/agents/:id/reject-assignment', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const assignment = await respondToAssignment(req.params.id, 'reject');
    res.json({ message: 'Assignment rejected. Transfer returned to queue.', assignment });
  } catch (err: any) {
    const status = err.message.includes('No pending') ? 404 : 500;
    console.error(`[AgentPayout] POST /agents/${req.params.id}/reject-assignment error:`, err.message);
    res.status(status).json({ error: 'REJECT_FAILED', message: err.message });
  }
});

// ─── OTP flow ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/transfers/:id/send-otp
 * Generate a 6-digit OTP for the recipient (valid 5 minutes).
 * In production the OTP is delivered via SMS/push; in simulation it is returned
 * in the response body for QA testing.
 */
router.post('/transfers/:id/send-otp', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { otp, expiresAt } = await sendOtp(req.params.id);
    res.json({
      message:   'OTP generated and sent to recipient.',
      expiresAt,
      // Returned in plaintext for simulation/QA only — never in production
      otp,
    });
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : err.message.includes('must be') ? 422 : 500;
    console.error(`[AgentPayout] POST /transfers/${req.params.id}/send-otp error:`, err.message);
    res.status(status).json({ error: 'OTP_SEND_FAILED', message: err.message });
  }
});

/**
 * POST /api/v1/payouts/verify-otp
 * Verify OTP submitted by the recipient. On success returns a payout_token
 * that the agent uses with /payouts/mark-paid.
 *
 * Body: { transfer_id, otp }
 */
router.post('/payouts/verify-otp', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { transfer_id, otp } = req.body ?? {};
    if (!transfer_id || !otp) {
      res.status(400).json({ error: 'MISSING_FIELDS', message: 'transfer_id and otp are required.' });
      return;
    }

    const { payoutToken } = await verifyOtp(String(transfer_id), String(otp));
    res.json({
      message:      'OTP verified. Transfer is approved for cash payout.',
      payout_token: payoutToken,
    });
  } catch (err: any) {
    const status =
      err.message.includes('not found')  ? 404 :
      err.message.includes('expired')    ? 410 :
      err.message.includes('Invalid')    ? 422 :
      err.message.includes('already')    ? 409 : 500;
    console.error('[AgentPayout] POST /payouts/verify-otp error:', err.message);
    res.status(status).json({ error: 'OTP_VERIFY_FAILED', message: err.message });
  }
});

/**
 * POST /api/v1/payouts/mark-paid
 * Execute the cash payout. Debits agent float, marks transfer PAID_OUT.
 * Idempotency guard prevents double-payout.
 *
 * Body: { transfer_id, payout_token }
 */
router.post('/payouts/mark-paid', requireApiKey, writeLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { transfer_id, payout_token } = req.body ?? {};
    if (!transfer_id || !payout_token) {
      res.status(400).json({ error: 'MISSING_FIELDS', message: 'transfer_id and payout_token are required.' });
      return;
    }

    const { transfer, agent } = await markPaid(String(transfer_id), String(payout_token));
    res.json({
      message:  'Cash payout completed successfully.',
      transfer: { id: transfer_id, status: transfer.status, amount: transfer.amount, currency: transfer.currency },
      agent:    { id: agent.id, full_name: agent.full_name, available_float: agent.available_float },
    });
  } catch (err: any) {
    const status =
      err.message.includes('not found')   ? 404 :
      err.message.includes('duplicate')   ? 409 :
      err.message.includes('must be')     ? 422 :
      err.message.includes('Invalid')     ? 422 :
      err.message.includes('insufficient') ? 422 : 500;
    console.error('[AgentPayout] POST /payouts/mark-paid error:', err.message);
    res.status(status).json({ error: 'PAYOUT_FAILED', message: err.message });
  }
});

// ─── Transfer timeline ────────────────────────────────────────────────────────

/**
 * GET /api/v1/transfers/:id/timeline
 * Full chronological event log for a transfer.
 */
router.get('/transfers/:id/timeline', requireApiKey, readLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const events = await getTimeline(req.params.id);
    res.json({ transfer_id: req.params.id, events, count: events.length });
  } catch (err: any) {
    console.error(`[AgentPayout] GET /transfers/${req.params.id}/timeline error:`, err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

export default router;

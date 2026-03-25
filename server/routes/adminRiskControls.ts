/**
 * server/routes/adminRiskControls.ts
 * ─────────────────────────────────────
 * Admin-only endpoints for the Risk Controls Layer.
 *
 * All routes require a valid Firebase admin token (verifyAdmin middleware).
 *
 * Endpoints:
 *   GET  /api/admin/system-controls
 *   POST /api/admin/system-controls/:key
 *
 *   GET  /api/admin/risk-limits
 *   POST /api/admin/risk-limits/:key
 *
 *   GET  /api/admin/risk-flags
 *   GET  /api/admin/risk-flags/:userId
 *   POST /api/admin/risk-flags/:userId/freeze
 *   POST /api/admin/risk-flags/:userId/unfreeze
 *   POST /api/admin/risk-flags/:userId/review
 *
 *   GET  /api/admin/risk-summary
 */

import { Router, Request, Response } from 'express';
import { adminDb } from '../firebaseAdmin';
import { verifyAdmin, AuthRequest } from '../middleware/auth';
import { killSwitchService, ControlKey, ALL_CONTROL_KEYS } from '../services/riskControls/killSwitchService';
import { limitsService } from '../services/riskControls/limitsService';
import { safetyGuardsService } from '../services/riskControls/safetyGuardsService';
import { writeAuditLog } from '../middleware/auditLog';
import { Timestamp } from 'firebase-admin/firestore';

const router = Router();

// ── Helper ────────────────────────────────────────────────────────────────────

function admin(req: Request): AuthRequest { return req as AuthRequest; }

function dayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── System Controls (Kill Switches) ───────────────────────────────────────────

/**
 * GET /api/admin/system-controls
 * Returns the state of all platform kill switches.
 */
router.get('/system-controls', verifyAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const controls = await killSwitchService.getAllControls();
    res.json({ controls });
  } catch (err: any) {
    console.error('[/system-controls GET]', err.message);
    res.status(500).json({ error: 'Failed to fetch system controls', detail: err.message });
  }
});

/**
 * POST /api/admin/system-controls/:key
 * Enable or disable a platform feature.
 * Body: { enabled: boolean, reason?: string }
 */
router.post('/system-controls/:key', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { key }    = req.params;
    const { enabled, reason } = req.body as { enabled: boolean; reason?: string };
    const { adminId, adminEmail } = admin(req);

    if (!ALL_CONTROL_KEYS.includes(key as ControlKey)) {
      res.status(400).json({ error: `Unknown control key: ${key}` });
      return;
    }

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: '`enabled` must be a boolean' });
      return;
    }

    const updated = await killSwitchService.setControl(
      key as ControlKey,
      enabled,
      adminId,
      adminEmail,
      reason,
    );

    res.json({ control: updated });
  } catch (err: any) {
    console.error('[/system-controls/:key POST]', err.message);
    res.status(500).json({ error: 'Failed to update control', detail: err.message });
  }
});

// ── Risk Limits ────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/risk-limits
 * Returns all configured transaction and velocity limits.
 */
router.get('/risk-limits', verifyAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const limits = await limitsService.getAllLimits();
    res.json({ limits });
  } catch (err: any) {
    console.error('[/risk-limits GET]', err.message);
    res.status(500).json({ error: 'Failed to fetch risk limits', detail: err.message });
  }
});

/**
 * POST /api/admin/risk-limits/:key
 * Update a specific limit.
 * Body: { value: number, enabled: boolean, currency?: string }
 */
router.post('/risk-limits/:key', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { key }                           = req.params;
    const { value, enabled, currency }      = req.body as { value: number; enabled: boolean; currency?: string };
    const { adminId, adminEmail }           = admin(req);

    if (typeof value !== 'number' || value < 0) {
      res.status(400).json({ error: '`value` must be a non-negative number' });
      return;
    }

    const updated = await limitsService.setLimit(key, value, enabled !== false, adminId, adminEmail, currency);
    res.json({ limit: updated });
  } catch (err: any) {
    console.error('[/risk-limits/:key POST]', err.message);
    res.status(500).json({ error: 'Failed to update limit', detail: err.message });
  }
});

// ── Risk Flags ─────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/risk-flags
 * Returns all users with non-default risk flags.
 */
router.get('/risk-flags', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const limitParam = parseInt((req.query.limit as string) ?? '100', 10);
    const flags      = await safetyGuardsService.getAllRiskFlags(Math.min(limitParam, 500));
    res.json({ flags, total: flags.length });
  } catch (err: any) {
    console.error('[/risk-flags GET]', err.message);
    res.status(500).json({ error: 'Failed to fetch risk flags', detail: err.message });
  }
});

/**
 * GET /api/admin/risk-flags/:userId
 * Returns the risk flag for a specific user.
 */
router.get('/risk-flags/:userId', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const flag = await safetyGuardsService.getRiskFlag(req.params.userId);
    res.json({ flag });
  } catch (err: any) {
    console.error('[/risk-flags/:userId GET]', err.message);
    res.status(500).json({ error: 'Failed to fetch user risk flag', detail: err.message });
  }
});

/**
 * POST /api/admin/risk-flags/:userId/freeze
 * Freeze a user account — prevents all payouts.
 * Body: { reason?: string }
 */
router.post('/risk-flags/:userId/freeze', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId }              = req.params;
    const { reason }              = req.body as { reason?: string };
    const { adminId, adminEmail } = admin(req);

    await safetyGuardsService.freezeUser(userId, adminId, adminEmail, reason);
    res.json({ success: true, userId, action: 'frozen', reason: reason ?? null });
  } catch (err: any) {
    console.error('[/risk-flags/:userId/freeze]', err.message);
    res.status(500).json({ error: 'Failed to freeze user', detail: err.message });
  }
});

/**
 * POST /api/admin/risk-flags/:userId/unfreeze
 * Unfreeze a user account and clear all risk flags.
 */
router.post('/risk-flags/:userId/unfreeze', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId }              = req.params;
    const { adminId, adminEmail } = admin(req);

    await safetyGuardsService.unfreezeUser(userId, adminId, adminEmail);
    res.json({ success: true, userId, action: 'unfrozen' });
  } catch (err: any) {
    console.error('[/risk-flags/:userId/unfreeze]', err.message);
    res.status(500).json({ error: 'Failed to unfreeze user', detail: err.message });
  }
});

/**
 * POST /api/admin/risk-flags/:userId/review
 * Mark a user for manual review.
 * Body: { reason?: string }
 */
router.post('/risk-flags/:userId/review', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId }  = req.params;
    const { reason }  = req.body as { reason?: string };
    const { adminId, adminEmail } = admin(req);

    await safetyGuardsService.markReviewRequired(userId, reason);

    await writeAuditLog({
      adminId,
      adminEmail,
      action:     'review_required',
      entityId:   userId,
      entityType: 'user',
      payload:    { userId, reason },
      ip:         req.ip ?? '',
    });

    res.json({ success: true, userId, action: 'review_required', reason: reason ?? null });
  } catch (err: any) {
    console.error('[/risk-flags/:userId/review]', err.message);
    res.status(500).json({ error: 'Failed to mark for review', detail: err.message });
  }
});

// ── Risk Summary ───────────────────────────────────────────────────────────────

/**
 * GET /api/admin/risk-summary
 * Dashboard summary of all risk controls.
 */
router.get('/risk-summary', verifyAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const today = dayStart();
    const tsToday = Timestamp.fromDate(today);

    const [
      controls,
      allFlags,
      limitBreachesToday,
      velocityBreachesToday,
      failedPayoutsToday,
      blockedTxToday,
    ] = await Promise.all([
      killSwitchService.getAllControls(),

      safetyGuardsService.getAllRiskFlags(500),

      adminDb.collection('admin_action_logs')
        .where('action', '==', 'limit_exceeded')
        .where('timestamp', '>=', today.toISOString())
        .get()
        .then((s) => s.size)
        .catch(() => 0),

      adminDb.collection('admin_action_logs')
        .where('action', '==', 'velocity_blocked')
        .where('timestamp', '>=', today.toISOString())
        .get()
        .then((s) => s.size)
        .catch(() => 0),

      adminDb.collection('payout_transactions')
        .where('payoutStatus', '==', 'FAILED')
        .where('createdAt', '>=', tsToday)
        .get()
        .then((s) => s.size)
        .catch(() => 0),

      adminDb.collection('admin_action_logs')
        .where('action', '==', 'payout_blocked_by_safety_guard')
        .where('timestamp', '>=', today.toISOString())
        .get()
        .then((s) => s.size)
        .catch(() => 0),
    ]);

    const controlMap = Object.fromEntries(controls.map((c) => [c.key, c.enabled]));

    const frozenCount         = allFlags.filter((f) => f.isFrozen || f.isBlocked).length;
    const inReviewCount       = allFlags.filter((f) => f.reviewRequired && !f.isFrozen).length;

    res.json({
      systemControls: {
        remittance_enabled:        controlMap['remittance_enabled']        ?? true,
        wallet_topup_enabled:      controlMap['wallet_topup_enabled']      ?? true,
        recurring_support_enabled: controlMap['recurring_support_enabled'] ?? true,
        campaign_payout_enabled:   controlMap['campaign_payout_enabled']   ?? true,
        fx_marketplace_enabled:    controlMap['fx_marketplace_enabled']    ?? true,
        referral_rewards_enabled:  controlMap['referral_rewards_enabled']  ?? true,
      },
      users: {
        frozen:      frozenCount,
        inReview:    inReviewCount,
      },
      today: {
        limitBreaches:     limitBreachesToday,
        velocityBreaches:  velocityBreachesToday,
        failedPayouts:     failedPayoutsToday,
        blockedTransactions: blockedTxToday,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[/risk-summary GET]', err.message);
    res.status(500).json({ error: 'Failed to generate risk summary', detail: err.message });
  }
});

export default router;

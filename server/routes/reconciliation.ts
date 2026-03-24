/**
 * routes/reconciliation.ts
 * ─────────────────────────
 * GET  /api/admin/reconciliation          — summary stats
 * GET  /api/admin/reconciliation/runs     — list reconciliation runs
 * GET  /api/admin/reconciliation/run/:id  — run detail + items
 * GET  /api/admin/reconciliation/alerts   — open alerts
 * POST /api/admin/reconciliation/run      — trigger manual run
 * POST /api/admin/reconciliation/alert-action — resolve/ignore alert
 *
 * All reads from reconciliation_reports, reconciliation_runs,
 * reconciliation_items, reconciliation_alerts collections.
 */

import { Router, Request, Response } from 'express';
import { adminDb } from '../firebaseAdmin';
import { verifyAdmin, AuthRequest } from '../middleware/auth';
import { writeAuditLog } from '../middleware/auditLog';
import { requireFields, requireEnum } from '../middleware/validate';

const router = Router();

const REPORTS_COL = 'reconciliation_reports';
const RUNS_COL    = 'reconciliation_runs';
const ITEMS_COL   = 'reconciliation_items';
const ALERTS_COL  = 'reconciliation_alerts';

const ALERT_ACTIONS = ['RESOLVE', 'IGNORE'] as const;

// ─── GET /api/admin/reconciliation ────────────────────────────────────────────

router.get('/reconciliation', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const snap = await adminDb.collection(REPORTS_COL)
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();

    const reports = snap.docs.map(d => d.data());

    const totalTransactions = reports.length;
    const matched    = reports.filter(r => r['status'] === 'MATCHED').length;
    const mismatched = reports.filter(r => r['status'] === 'MISMATCH').length;
    const pending    = reports.filter(r =>
      r['status'] === 'MISSING_EXTERNAL' || r['status'] === 'MISSING_INTERNAL',
    ).length;
    const lastReport = reports[0];

    res.json({
      totalTransactions,
      matched,
      mismatched,
      pending,
      lastRunId : lastReport?.['runId']    ?? null,
      lastRunAt : lastReport?.['createdAt'] ?? null,
    });
  } catch (err: any) {
    console.error('[/api/admin/reconciliation]', err.message);
    res.status(500).json({ error: 'Failed to fetch reconciliation summary', detail: err.message });
  }
});

// ─── GET /api/admin/reconciliation/runs ──────────────────────────────────────

router.get('/reconciliation/runs', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit: limitParam } = req.query as Record<string, string>;
    const pageLimit = Math.min(parseInt(limitParam ?? '20', 10), 100);

    const snap = await adminDb.collection(RUNS_COL)
      .orderBy('startedAt', 'desc')
      .limit(pageLimit)
      .get();

    const runs = snap.docs.map(d => ({ runId: d.id, ...d.data() }));
    res.json({ runs, total: runs.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch reconciliation runs', detail: err.message });
  }
});

// ─── GET /api/admin/reconciliation/run/:runId ─────────────────────────────────

router.get('/reconciliation/run/:runId', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { runId } = req.params;

    const [runSnap, itemsSnap] = await Promise.all([
      adminDb.collection(RUNS_COL).doc(runId).get(),
      adminDb.collection(ITEMS_COL).where('runId', '==', runId).orderBy('createdAt', 'desc').limit(500).get(),
    ]);

    if (!runSnap.exists) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const run   = { runId, ...runSnap.data() };
    const items = itemsSnap.docs.map(d => ({ itemId: d.id, ...d.data() }));

    res.json({ run, items, itemCount: items.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch run details', detail: err.message });
  }
});

// ─── GET /api/admin/reconciliation/alerts ─────────────────────────────────────

router.get('/reconciliation/alerts', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, severity, limit: limitParam } = req.query as Record<string, string>;
    const pageLimit = Math.min(parseInt(limitParam ?? '50', 10), 200);

    let q = adminDb.collection(ALERTS_COL).orderBy('createdAt', 'desc').limit(pageLimit) as any;
    if (status)   q = adminDb.collection(ALERTS_COL).where('status',   '==', status).orderBy('createdAt', 'desc').limit(pageLimit);
    if (severity) q = adminDb.collection(ALERTS_COL).where('severity', '==', severity).orderBy('createdAt', 'desc').limit(pageLimit);

    const snap = await q.get();
    const alerts = snap.docs.map((d: any) => ({ alertId: d.id, ...d.data() }));

    const open     = alerts.filter((a: any) => a.status === 'open').length;
    const critical = alerts.filter((a: any) => a.severity === 'critical').length;

    res.json({ alerts, total: alerts.length, open, critical });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch reconciliation alerts', detail: err.message });
  }
});

// ─── POST /api/admin/reconciliation/run ──────────────────────────────────────

router.post('/reconciliation/run', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  const adminReq = req as AuthRequest;
  try {
    const { provider = 'all', dateRangeHours = 24 } = req.body as {
      provider?: string; dateRangeHours?: number;
    };

    const runId     = `recon_manual_${Date.now()}`;
    const startedAt = new Date().toISOString();

    // Write a pending run record
    await adminDb.collection(RUNS_COL).doc(runId).set({
      runId,
      startedAt,
      status    : 'running',
      mode      : 'manual',
      provider,
      createdBy : adminReq.adminId,
      totalChecked: 0, totalMatched: 0, totalMismatched: 0,
      totalMissing: 0, totalDuplicate: 0, totalAlertsCreated: 0,
    });

    await writeAuditLog({
      adminId   : adminReq.adminId,
      adminEmail: adminReq.adminEmail,
      action    : 'TRIGGER_RECONCILIATION_RUN',
      entityId  : runId,
      entityType: 'reconciliation_run',
      payload   : { provider, dateRangeHours },
      ip        : req.ip ?? '',
    });

    // Return immediately — actual reconciliation runs async via worker
    res.status(202).json({
      success  : true,
      runId,
      message  : 'Reconciliation run queued. Check reconciliation/runs for status.',
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to trigger reconciliation run', detail: err.message });
  }
});

// ─── POST /api/admin/reconciliation/alert-action ─────────────────────────────

router.post(
  '/reconciliation/alert-action',
  verifyAdmin,
  requireFields('alertId', 'action'),
  requireEnum('action', ALERT_ACTIONS),
  async (req: Request, res: Response): Promise<void> => {
    const { alertId, action, note } = req.body as { alertId: string; action: 'RESOLVE' | 'IGNORE'; note?: string };
    const adminReq = req as AuthRequest;

    try {
      const now = new Date().toISOString();
      const newStatus = action === 'RESOLVE' ? 'resolved' : 'ignored';

      await adminDb.collection(ALERTS_COL).doc(alertId).update({
        status    : newStatus,
        resolvedBy: adminReq.adminId,
        resolvedAt: now,
        note      : note ?? null,
      });

      await writeAuditLog({
        adminId   : adminReq.adminId,
        adminEmail: adminReq.adminEmail,
        action    : `RECONCILIATION_ALERT_${action}`,
        entityId  : alertId,
        entityType: 'reconciliation_alert',
        payload   : { alertId, action, note },
        ip        : req.ip ?? '',
      });

      res.json({ success: true, alertId, action, status: newStatus });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to process alert action', detail: err.message });
    }
  },
);

export default router;

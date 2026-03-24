/**
 * routes/supportTickets.ts
 * ────────────────────────
 * GET  /api/admin/support-tickets
 * POST /api/admin/support-action
 *
 * Collection: support_tickets
 */

import { Router, Request, Response } from 'express';
import { adminDb } from '../firebaseAdmin';
import { verifyAdmin, AuthRequest } from '../middleware/auth';
import { writeAuditLog } from '../middleware/auditLog';
import { requireFields, requireEnum } from '../middleware/validate';

const router = Router();
const TICKETS_COL = 'support_tickets';

const TICKET_ACTIONS = ['IN_REVIEW', 'RESOLVED', 'CLOSED'] as const;
type TicketAction = typeof TICKET_ACTIONS[number];

// ─── GET /api/admin/support-tickets ──────────────────────────────────────────

router.get('/support-tickets', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, userId, category, limit: limitParam } = req.query as Record<string, string>;
    const pageLimit = Math.min(parseInt(limitParam ?? '50', 10), 200);

    let q = adminDb.collection(TICKETS_COL).orderBy('createdAt', 'desc').limit(pageLimit) as any;
    if (status) {
      q = adminDb.collection(TICKETS_COL)
        .where('status', '==', status)
        .orderBy('createdAt', 'desc')
        .limit(pageLimit);
    }
    if (userId) {
      q = adminDb.collection(TICKETS_COL)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(pageLimit);
    }

    const snap = await q.get();

    const tickets = snap.docs.map((d: any) => {
      const data = d.data();
      return {
        ticketId   : d.id,
        userId     : data.userId      ?? null,
        txId       : data.txId        ?? null,
        category   : data.category    ?? 'GENERAL',
        subject    : data.subject     ?? null,
        description: data.description ?? null,
        status     : data.status      ?? 'OPEN',
        priority   : data.priority    ?? 'NORMAL',
        assignedTo : data.assignedTo  ?? null,
        createdAt  : data.createdAt   ?? null,
        updatedAt  : data.updatedAt   ?? null,
        resolvedAt : data.resolvedAt  ?? null,
      };
    });

    const open       = tickets.filter((t: any) => t.status === 'OPEN').length;
    const inReview   = tickets.filter((t: any) => t.status === 'IN_REVIEW').length;
    const resolved   = tickets.filter((t: any) => t.status === 'RESOLVED').length;

    res.json({ tickets, total: tickets.length, open, inReview, resolved });
  } catch (err: any) {
    console.error('[/api/admin/support-tickets]', err.message);
    res.status(500).json({ error: 'Failed to fetch support tickets', detail: err.message });
  }
});

// ─── POST /api/admin/support-action ──────────────────────────────────────────

router.post(
  '/support-action',
  verifyAdmin,
  requireFields('ticketId', 'action'),
  requireEnum('action', TICKET_ACTIONS),
  async (req: Request, res: Response): Promise<void> => {
    const { ticketId, action, note, assignedTo } = req.body as {
      ticketId: string; action: TicketAction; note?: string; assignedTo?: string;
    };
    const adminReq = req as AuthRequest;

    try {
      const now = new Date().toISOString();

      const updates: Record<string, any> = {
        status   : action,
        updatedAt: now,
        updatedBy: adminReq.adminId,
      };

      if (note)       updates['latestNote'] = note;
      if (assignedTo) updates['assignedTo'] = assignedTo;
      if (action === 'RESOLVED' || action === 'CLOSED') {
        updates['resolvedAt'] = now;
        updates['resolvedBy'] = adminReq.adminId;
      }

      await adminDb.collection(TICKETS_COL).doc(ticketId).update(updates);

      await writeAuditLog({
        adminId   : adminReq.adminId,
        adminEmail: adminReq.adminEmail,
        action    : `TICKET_${action}`,
        entityId  : ticketId,
        entityType: 'support_ticket',
        payload   : { ticketId, action, note, assignedTo },
        ip        : req.ip ?? '',
      });

      res.json({ success: true, ticketId, action });
    } catch (err: any) {
      console.error('[/api/admin/support-action]', err.message);
      res.status(500).json({ error: 'Failed to process support action', detail: err.message });
    }
  },
);

export default router;

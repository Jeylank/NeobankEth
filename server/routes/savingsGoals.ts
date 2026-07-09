/**
 * server/routes/savingsGoals.ts
 * ──────────────────────────────
 * User-facing savings goals endpoints, backed by Firestore.
 *
 * Routes (mounted at /api)
 * ────────────────────────
 *   GET   /api/savings-goals
 *   POST  /api/savings-goals
 *   PATCH /api/savings-goals/:id
 */

import { Router, Request, Response } from 'express';
import { verifyUser, UserAuthRequest } from '../middleware/verifyUser';
import { adminDb } from '../firebaseAdmin';

const router = Router();

const COLLECTION = 'savings_goals';

function mapGoal(id: string, data: any) {
  return {
    id,
    userId: data.userId,
    name: data.name,
    targetAmount: String(data.targetAmount ?? '0'),
    currentAmount: String(data.currentAmount ?? '0'),
    currency: data.currency ?? 'USD',
    deadline: data.deadline ?? undefined,
    status: data.status ?? 'active',
    createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
  };
}

// ─── GET /api/savings-goals ────────────────────────────────────────────────
router.get('/savings-goals', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;
  try {
    const snap = await adminDb
      .collection(COLLECTION)
      .where('userId', '==', userId)
      .get();

    const goals = snap.docs
      .map((doc: any) => mapGoal(doc.id, doc.data()))
      .sort((a: any, b: any) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));

    res.json({ goals });
  } catch (err: any) {
    console.error('[savingsGoals] GET error:', err.message);
    res.json({ goals: [] });
  }
});

// ─── POST /api/savings-goals ───────────────────────────────────────────────
router.post('/savings-goals', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;
  const { name, targetAmount, currentAmount, currency, deadline } = req.body;

  if (!name || !targetAmount) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'name and targetAmount are required.' });
    return;
  }

  try {
    const ref = await adminDb.collection(COLLECTION).add({
      userId,
      name,
      targetAmount: String(targetAmount),
      currentAmount: String(currentAmount ?? '0'),
      currency: currency ?? 'USD',
      deadline: deadline ?? null,
      status: 'active',
      createdAt: new Date(),
    });
    const doc = await ref.get();
    res.status(201).json(mapGoal(ref.id, doc.data()!));
  } catch (err: any) {
    console.error('[savingsGoals] POST error:', err.message);
    res.status(500).json({ error: 'CREATE_FAILED', message: err.message });
  }
});

// ─── PATCH /api/savings-goals/:id ──────────────────────────────────────────
router.patch('/savings-goals/:id', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;
  const { id } = req.params;
  const { name, targetAmount, currentAmount, currency, deadline, status } = req.body;

  try {
    const ref = adminDb.collection(COLLECTION).doc(id);
    const doc = await ref.get();
    if (!doc.exists || doc.data()!.userId !== userId) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (targetAmount !== undefined) updates.targetAmount = String(targetAmount);
    if (currentAmount !== undefined) updates.currentAmount = String(currentAmount);
    if (currency !== undefined) updates.currency = currency;
    if (deadline !== undefined) updates.deadline = deadline;
    if (status !== undefined) updates.status = status;

    await ref.update(updates);
    const updated = await ref.get();
    res.json(mapGoal(ref.id, updated.data()!));
  } catch (err: any) {
    console.error('[savingsGoals] PATCH error:', err.message);
    res.status(500).json({ error: 'UPDATE_FAILED', message: err.message });
  }
});

export default router;

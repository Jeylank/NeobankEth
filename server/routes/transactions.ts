import { Router, Response } from 'express';
import { adminDb } from '../firebaseAdmin';
import { verifyUser, type UserAuthRequest } from '../middleware/verifyUser';

const router = Router();

function toIsoString(value: unknown): string {
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

function toHistoryStatus(status: unknown): 'pending' | 'completed' | 'failed' {
  const normalized = String(status ?? '').toUpperCase();
  if (['COMPLETED', 'PAID_OUT'].includes(normalized)) return 'completed';
  if (['FAILED', 'PAYMENT_FAILED', 'CANCELLED', 'REFUNDED'].includes(normalized)) return 'failed';
  return 'pending';
}

export function mapRemittanceToTransaction(
  id: string,
  data: Record<string, unknown>,
) {
  const recipientName =
    typeof data.recipientName === 'string'
      ? data.recipientName
      : typeof data.recipientId === 'string'
        ? data.recipientId
        : undefined;

  return {
    id,
    userId: String(data.userId ?? ''),
    type: 'remittance' as const,
    amount: String(data.amount ?? '0'),
    currency: String(data.currency ?? 'USD'),
    description: recipientName ? `Send money to ${recipientName}` : 'Send money',
    status: toHistoryStatus(data.status),
    recipientName,
    createdAt: toIsoString(data.createdAt),
  };
}

router.get('/transactions', verifyUser, async (req, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;

  try {
    const snapshot = await adminDb
      .collection('sim_transactions')
      .where('userId', '==', userId)
      .get();

    const transactions = snapshot.docs
      .map(document => mapRemittanceToTransaction(document.id, document.data()))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    res.json({ transactions });
  } catch (error: any) {
    console.error('[Transactions] History read failed:', error.message);
    res.status(503).json({
      error: 'TRANSACTION_HISTORY_UNAVAILABLE',
      message: 'Transaction history is temporarily unavailable. Please try again.',
    });
  }
});

export default router;

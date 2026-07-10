import { Router, Response } from 'express';
import { adminDb } from '../firebaseAdmin';
import { verifyUser, type UserAuthRequest } from '../middleware/verifyUser';

const router = Router();
const HISTORY_COLLECTIONS = ['sim_transactions', 'transactions', 'remittances'] as const;
const USER_ID_FIELDS = ['userId', 'senderId', 'uid'] as const;

function shouldLogTransactionHistoryDebug(): boolean {
  return process.env.APP_ENV === 'preview'
    || process.env.TRANSACTION_HISTORY_DEBUG === 'true';
}

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
    userId: String(data.userId ?? data.senderId ?? data.uid ?? ''),
    type: (typeof data.type === 'string' ? data.type : 'remittance') as TransactionHistoryType,
    amount: String(data.amount ?? '0'),
    currency: String(data.currency ?? 'USD'),
    description: recipientName ? `Send money to ${recipientName}` : 'Send money',
    status: toHistoryStatus(data.status),
    recipientName,
    createdAt: toIsoString(data.createdAt),
  };
}

type TransactionHistoryType = 'deposit' | 'withdrawal' | 'transfer' | 'remittance' | 'payment' | string;

async function getUserTransactionDocs(userId: string) {
  const byId = new Map<string, { id: string; data: Record<string, unknown>; collection: string }>();

  for (const collectionName of HISTORY_COLLECTIONS) {
    for (const field of USER_ID_FIELDS) {
      const snapshot = await adminDb
        .collection(collectionName)
        .where(field, '==', userId)
        .get();

      snapshot.docs.forEach(document => {
        const key = `${collectionName}/${document.id}`;
        if (!byId.has(key)) {
          byId.set(key, {
            id: document.id,
            data: document.data(),
            collection: collectionName,
          });
        }
      });
    }
  }

  return [...byId.values()];
}

router.get('/transactions', verifyUser, async (req, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;
  const debug = shouldLogTransactionHistoryDebug();

  try {
    if (debug) {
      console.info('[Transactions] history query', {
        userId,
        collections: HISTORY_COLLECTIONS,
        userFields: USER_ID_FIELDS,
      });
    }

    const docs = await getUserTransactionDocs(userId);
    const countsByCollection = docs.reduce<Record<string, number>>((acc, doc) => {
      acc[doc.collection] = (acc[doc.collection] ?? 0) + 1;
      return acc;
    }, {});

    const transactions = docs
      .map(document => mapRemittanceToTransaction(document.id, document.data))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    if (debug) {
      console.info('[Transactions] history result', {
        userId,
        count: transactions.length,
        countsByCollection,
      });
    }

    res.json({
      transactions,
      count: transactions.length,
      ...(debug ? { debug: { count: transactions.length, countsByCollection } } : {}),
    });
  } catch (error: any) {
    console.error('[Transactions] History read failed:', error.message);
    res.status(503).json({
      error: 'TRANSACTION_HISTORY_UNAVAILABLE',
      message: 'Transaction history is temporarily unavailable. Please try again.',
    });
  }
});

export default router;

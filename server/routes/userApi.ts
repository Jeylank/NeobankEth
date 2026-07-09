/**
 * server/routes/userApi.ts
 * ─────────────────────────
 * User-facing REST routes that the mobile/web client calls directly.
 * All routes require a valid Firebase ID token (verifyUser middleware).
 *
 * Routes (mounted at /api)
 * ─────────────────────────
 *   GET  /api/exchange-rates
 *   GET  /api/exchange-rates/convert
 *   GET  /api/balance
 *   GET  /api/balance/multi-currency
 *   GET  /api/transactions
 *   GET  /api/beneficiaries
 *   POST /api/beneficiaries
 *   DELETE /api/beneficiaries/:id
 *   POST /api/remittance/initiate
 *   POST /api/fx/quotes
 *   POST /api/fx/select
 */

import { Router, Request, Response } from 'express';
import { verifyUser, UserAuthRequest } from '../middleware/verifyUser';
import { adminDb } from '../firebaseAdmin';
import {
  FX_BASE_RATES,
  liveRate,
  createQuote,
  getWalletBalances,
  processRemittance,
  extractIdempotencyKey,
  checkIdempotency,
} from '../services/simulationEngine';

const router = Router();

// ─── GET /api/exchange-rates ──────────────────────────────────────────────────
// Returns live FX rates (with small jitter) relative to ETB.

router.get('/exchange-rates', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rates: Record<string, number> = {};
    for (const from of Object.keys(FX_BASE_RATES)) {
      rates[from] = liveRate(from, 'ETB');
    }
    res.json({
      rates,
      baseCurrency: 'ETB',
      lastUpdated: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'RATES_UNAVAILABLE', message: err.message });
  }
});

// ─── GET /api/exchange-rates/convert ─────────────────────────────────────────
// ?from=USD&to=ETB&amount=100

router.get('/exchange-rates/convert', (req: Request, res: Response): void => {
  const { from = 'USD', to = 'ETB', amount = '1' } = req.query as Record<string, string>;
  const rate = liveRate(from.toUpperCase(), to.toUpperCase());
  const convertedAmount = parseFloat(amount) * rate;
  res.json({ convertedAmount: parseFloat(convertedAmount.toFixed(2)), rate });
});

// ─── GET /api/balance ─────────────────────────────────────────────────────────
// Returns the primary USD balance for the authenticated user.

router.get('/balance', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;
  try {
    const balances = await getWalletBalances(userId);
    const usdBalance = balances['USD'] ?? 0;
    res.json({
      balance:  usdBalance,
      currency: 'USD',
      userId,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'BALANCE_UNAVAILABLE', message: err.message });
  }
});

// ─── GET /api/balance/multi-currency ─────────────────────────────────────────

router.get('/balance/multi-currency', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;
  try {
    const balances = await getWalletBalances(userId);
    const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', ETB: 'ETB' };
    const result = Object.entries(balances).map(([currency, amount]) => ({
      currency,
      amount,
      symbol: SYMBOLS[currency] ?? currency,
    }));
    res.json({ balances: result });
  } catch (err: any) {
    res.status(500).json({ error: 'BALANCE_UNAVAILABLE', message: err.message });
  }
});

// ─── GET /api/transactions ────────────────────────────────────────────────────
// Returns the authenticated user's transaction history (newest first).

router.get('/transactions', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;
  const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 100);
  try {
    const snap = await adminDb
      .collection('sim_transactions')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const transactions = snap.docs.map((doc: any) => {
      const d = doc.data();
      return {
        id:          doc.id,
        txId:        d.txId ?? doc.id,
        amount:      d.amount,
        currency:    d.currency ?? d.fromCurrency ?? 'USD',
        status:      d.status,
        provider:    d.provider,
        description: d.description ?? 'Remittance',
        createdAt:   d.createdAt?.toDate?.()?.toISOString() ?? null,
        completedAt: d.completedAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    res.json({ transactions });
  } catch (err: any) {
    console.error('[userApi] /transactions error:', err.message);
    res.json({ transactions: [] });
  }
});

// ─── GET /api/beneficiaries ───────────────────────────────────────────────────

router.get('/beneficiaries', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;
  try {
    const snap = await adminDb
      .collection('beneficiaries')
      .where('userId', '==', userId)
      .get();

    const beneficiaries = snap.docs
      .map((doc: any) => ({
        id:            doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() ?? null,
      }))
      .sort((a: any, b: any) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));

    res.json({ beneficiaries });
  } catch (err: any) {
    console.error('[userApi] /beneficiaries error:', err.message);
    res.json({ beneficiaries: [] });
  }
});

// ─── POST /api/beneficiaries ──────────────────────────────────────────────────

router.post('/beneficiaries', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;
  const { fullName, bankName, accountNumber, phone, city, relationship } = req.body;

  if (!fullName || !accountNumber) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'fullName and accountNumber are required.' });
    return;
  }

  try {
    const ref = await adminDb.collection('beneficiaries').add({
      userId,
      fullName,
      bankName:    bankName    ?? null,
      accountNumber,
      phone:       phone       ?? null,
      city:        city        ?? null,
      relationship: relationship ?? null,
      createdAt:   new Date(),
    });
    const doc = await ref.get();
    res.status(201).json({ id: ref.id, ...doc.data(), createdAt: doc.data()!.createdAt?.toDate?.()?.toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: 'CREATE_FAILED', message: err.message });
  }
});

// ─── DELETE /api/beneficiaries/:id ───────────────────────────────────────────

router.delete('/beneficiaries/:id', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;
  const { id } = req.params;
  try {
    const ref  = adminDb.collection('beneficiaries').doc(id);
    const doc  = await ref.get();
    if (!doc.exists || doc.data()!.userId !== userId) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    await ref.delete();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'DELETE_FAILED', message: err.message });
  }
});

// ─── POST /api/remittance/initiate ───────────────────────────────────────────
// Main send-money endpoint called by the mobile app.
// Delegates to processRemittance (the Firestore-backed simulation engine).

router.post('/remittance/initiate', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { userId } = req as UserAuthRequest;
  const {
    amount,
    fromCurrency = 'USD',
    toCurrency   = 'ETB',
    beneficiaryId,
    description,
    paymentMethod,
    payoutMethod,
    quoteId,
  } = req.body;

  if (!amount || !beneficiaryId) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'amount and beneficiaryId are required.' });
    return;
  }

  // Idempotency key from header (optional but recommended)
  const idempotencyKey = extractIdempotencyKey(req.headers as Record<string, string>, req.body);

  // Replay existing result if key already seen
  if (idempotencyKey) {
    const cached = await checkIdempotency(idempotencyKey);
    if (cached) {
      res.status(cached.status).json(cached.payload);
      return;
    }
  }

  try {
    const result = await processRemittance({
      userId,
      recipientId:    String(beneficiaryId),
      amount:         Number(amount),
      currency:       fromCurrency.toUpperCase(),
      type:           'REMITTANCE',
      quoteId,
      idempotencyKey,
      metadata: {
        description,
        paymentMethod,
        payoutMethod,
        toCurrency: toCurrency.toUpperCase(),
      },
    });

    res.status(result.status).json(result.payload);
  } catch (err: any) {
    console.error('[userApi] /remittance/initiate error:', err.message);
    res.status(500).json({ error: 'INITIATE_FAILED', message: err.message });
  }
});

// ─── POST /api/fx/quotes ──────────────────────────────────────────────────────
// Returns FX quotes from multiple simulated bank providers for the given amount.

router.post('/fx/quotes', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { amount = 100, currency = 'USD', payoutMethod = 'bank_account' } = req.body;

  const BANKS = [
    { bank: 'Dashen Bank',    fee: 3.5,  deliveryTime: '1-2 hours'  },
    { bank: 'Awash Bank',     fee: 2.5,  deliveryTime: '2-4 hours'  },
    { bank: 'CBE',            fee: 4.0,  deliveryTime: '30 minutes' },
    { bank: 'Abyssinia Bank', fee: 3.0,  deliveryTime: '1-3 hours'  },
  ];

  try {
    const from = (currency as string).toUpperCase();
    const baseRate = liveRate(from, 'ETB');

    const quotes = await Promise.all(
      BANKS.map(async ({ bank, fee, deliveryTime }) => {
        const bankJitter = 1 + (Math.random() - 0.5) * 0.01; // ±0.5% per bank
        const rate       = parseFloat((baseRate * bankJitter).toFixed(4));
        const net        = (Number(amount) - fee) * rate;
        const { quoteId } = await createQuote(from, 'ETB');
        return {
          quoteId,
          bank,
          rate,
          fee,
          receiveAmount: parseFloat(net.toFixed(2)),
          deliveryTime,
          payoutMethod,
        };
      })
    );

    res.json(quotes);
  } catch (err: any) {
    res.status(500).json({ error: 'QUOTES_UNAVAILABLE', message: err.message });
  }
});

// ─── POST /api/fx/select ──────────────────────────────────────────────────────
// Confirms that the user has selected a quote. The quoteId is already locked in
// Firestore by createQuote; this endpoint just acknowledges the selection.

router.post('/fx/select', verifyUser, async (req: Request, res: Response): Promise<void> => {
  const { quoteId } = req.body;
  if (!quoteId) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'quoteId is required.' });
    return;
  }
  try {
    const doc = await adminDb.collection('sim_quotes').doc(quoteId).get();
    if (!doc.exists) {
      res.status(404).json({ error: 'QUOTE_NOT_FOUND', message: 'Quote not found or expired.' });
      return;
    }
    res.json({ success: true, quoteId });
  } catch (err: any) {
    res.status(500).json({ error: 'SELECT_FAILED', message: err.message });
  }
});

export default router;

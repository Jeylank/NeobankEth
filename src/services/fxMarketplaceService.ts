import {
  db,
  collection,
  doc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
} from './firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clientRiskService } from './riskControls/clientRiskService';
import type {
  FxQuoteRecord,
  FxQuoteStatus,
  FxReservation,
  FxReservationStatus,
  FxAuditEvent,
  FxAuditLog,
  FxProviderHealth,
  FxMarketplaceStats,
} from '../types';

const IS_DEV = __DEV__;
const QUOTE_TTL_MS = 5 * 60 * 1000;
const LOCAL_QUOTES_KEY = 'fx_quotes_local';
const LOCAL_RESERVATIONS_KEY = 'fx_reservations_local';
const LOCAL_AUDIT_KEY = 'fx_audit_local';

function generateQuoteId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `FXQ-${ts}-${rand}`;
}

function generateReservationId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `RES-${ts}-${rand}`;
}

function now(): string {
  return new Date().toISOString();
}

const PROVIDER_HEALTH: FxProviderHealth[] = [
  { provider: 'Dashen Bank', healthy: true, availableLiquidityETB: 15_000_000, lastCheckedAt: now() },
  { provider: 'Awash Bank', healthy: true, availableLiquidityETB: 12_000_000, lastCheckedAt: now() },
  { provider: 'CBE', healthy: true, availableLiquidityETB: 25_000_000, lastCheckedAt: now() },
  { provider: 'Abyssinia Bank', healthy: true, availableLiquidityETB: 8_000_000, lastCheckedAt: now() },
  { provider: 'Wegagen Bank', healthy: false, availableLiquidityETB: 500_000, lastCheckedAt: now() },
];

const BASE_RATES: Record<string, Record<string, number>> = {
  EUR: { base: 61.20, spread: 1.8 },
  USD: { base: 56.50, spread: 1.5 },
  GBP: { base: 71.80, spread: 2.0 },
};

function generateBankRate(baseCfg: { base: number; spread: number }, seed: number): number {
  const offset = (seed * 0.7 - 0.35) * baseCfg.spread;
  return parseFloat((baseCfg.base + offset).toFixed(2));
}

async function persistQuote(quote: FxQuoteRecord): Promise<void> {
  if (IS_DEV) {
    try {
      const stored = await AsyncStorage.getItem(LOCAL_QUOTES_KEY);
      const list: FxQuoteRecord[] = stored ? JSON.parse(stored) : [];
      list.unshift(quote);
      await AsyncStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(list.slice(0, 500)));
    } catch (e) {
      console.error('Failed to persist quote locally:', e);
    }
    return;
  }
  try {
    await setDoc(doc(db, 'fx_quotes', quote.quoteId), quote);
  } catch (e) {
    console.error('Firestore quote persist failed:', e);
  }
}

async function updateQuote(quoteId: string, updates: Partial<FxQuoteRecord>): Promise<void> {
  const updateData = { ...updates, updatedAt: now() };
  if (IS_DEV) {
    try {
      const stored = await AsyncStorage.getItem(LOCAL_QUOTES_KEY);
      const list: FxQuoteRecord[] = stored ? JSON.parse(stored) : [];
      const idx = list.findIndex(q => q.quoteId === quoteId);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...updateData };
        await AsyncStorage.setItem(LOCAL_QUOTES_KEY, JSON.stringify(list));
      }
    } catch (e) {
      console.error('Failed to update quote locally:', e);
    }
    return;
  }
  try {
    await updateDoc(doc(db, 'fx_quotes', quoteId), updateData);
  } catch (e) {
    console.error('Firestore quote update failed:', e);
  }
}

async function getQuoteById(quoteId: string): Promise<FxQuoteRecord | null> {
  if (IS_DEV) {
    try {
      const stored = await AsyncStorage.getItem(LOCAL_QUOTES_KEY);
      const list: FxQuoteRecord[] = stored ? JSON.parse(stored) : [];
      return list.find(q => q.quoteId === quoteId) || null;
    } catch {
      return null;
    }
  }
  try {
    const { getDoc } = await import('./firebase');
    const snap = await getDoc(doc(db, 'fx_quotes', quoteId));
    return snap.exists() ? (snap.data() as FxQuoteRecord) : null;
  } catch {
    return null;
  }
}

async function persistReservation(reservation: FxReservation): Promise<void> {
  if (IS_DEV) {
    try {
      const stored = await AsyncStorage.getItem(LOCAL_RESERVATIONS_KEY);
      const list: FxReservation[] = stored ? JSON.parse(stored) : [];
      list.unshift(reservation);
      await AsyncStorage.setItem(LOCAL_RESERVATIONS_KEY, JSON.stringify(list.slice(0, 500)));
    } catch (e) {
      console.error('Failed to persist reservation locally:', e);
    }
    return;
  }
  try {
    await setDoc(doc(db, 'fx_reservations', reservation.reservationId), reservation);
  } catch (e) {
    console.error('Firestore reservation persist failed:', e);
  }
}

async function updateReservation(reservationId: string, updates: Partial<FxReservation>): Promise<void> {
  const updateData = { ...updates, updatedAt: now() };
  if (IS_DEV) {
    try {
      const stored = await AsyncStorage.getItem(LOCAL_RESERVATIONS_KEY);
      const list: FxReservation[] = stored ? JSON.parse(stored) : [];
      const idx = list.findIndex(r => r.reservationId === reservationId);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...updateData };
        await AsyncStorage.setItem(LOCAL_RESERVATIONS_KEY, JSON.stringify(list));
      }
    } catch (e) {
      console.error('Failed to update reservation locally:', e);
    }
    return;
  }
  try {
    await updateDoc(doc(db, 'fx_reservations', reservationId), updateData);
  } catch (e) {
    console.error('Firestore reservation update failed:', e);
  }
}

async function writeAuditLog(entry: FxAuditLog): Promise<void> {
  if (IS_DEV) {
    try {
      const stored = await AsyncStorage.getItem(LOCAL_AUDIT_KEY);
      const list: FxAuditLog[] = stored ? JSON.parse(stored) : [];
      list.unshift(entry);
      await AsyncStorage.setItem(LOCAL_AUDIT_KEY, JSON.stringify(list.slice(0, 1000)));
    } catch (e) {
      console.error('Failed to write audit log locally:', e);
    }
    return;
  }
  try {
    const logId = `${entry.event}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, 'fx_audit_log', logId), entry);
  } catch (e) {
    console.error('Firestore audit log write failed:', e);
  }
}

export class FxQuoteExpiredError extends Error {
  public code = 'QUOTE_EXPIRED';
  constructor(quoteId: string) {
    super(`Quote ${quoteId} has expired. Please request new quotes.`);
    this.name = 'FxQuoteExpiredError';
  }
}

export class FxAmountMismatchError extends Error {
  public code = 'AMOUNT_MISMATCH';
  constructor(expected: number, received: number, currency: string) {
    super(
      `Amount mismatch: quote was for ${expected} ${currency} but transfer requests ${received} ${currency}. Please select a new quote.`
    );
    this.name = 'FxAmountMismatchError';
  }
}

export class FxQuoteNotFoundError extends Error {
  public code = 'QUOTE_NOT_FOUND';
  constructor(quoteId: string) {
    super(`Quote ${quoteId} not found.`);
    this.name = 'FxQuoteNotFoundError';
  }
}

export class FxQuoteAlreadyUsedError extends Error {
  public code = 'QUOTE_ALREADY_USED';
  constructor(quoteId: string) {
    super(`Quote ${quoteId} has already been used for a transfer.`);
    this.name = 'FxQuoteAlreadyUsedError';
  }
}

export class FxInsufficientLiquidityError extends Error {
  public code = 'INSUFFICIENT_LIQUIDITY';
  constructor(provider: string) {
    super(`Provider ${provider} has insufficient liquidity for this payout.`);
    this.name = 'FxInsufficientLiquidityError';
  }
}

export const fxMarketplaceService = {
  async generateQuotes(params: {
    userId: string;
    amount: number;
    currency: string;
    payoutMethod: string;
  }): Promise<FxQuoteRecord[]> {
    const { userId, amount, currency, payoutMethod } = params;
    const rateCfg = BASE_RATES[currency];
    if (!rateCfg) {
      throw new Error(`Unsupported currency: ${currency}`);
    }

    const healthyProviders = PROVIDER_HEALTH.filter(p => {
      if (!p.healthy) return false;
      const etbNeeded = amount * rateCfg.base;
      if (p.availableLiquidityETB < etbNeeded) return false;
      return true;
    });

    if (healthyProviders.length === 0) {
      throw new FxInsufficientLiquidityError('all providers');
    }

    const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
    const quotes: FxQuoteRecord[] = [];

    for (let i = 0; i < healthyProviders.length; i++) {
      const provider = healthyProviders[i];
      const seed = (i + 1) / (healthyProviders.length + 1);
      const rate = generateBankRate(rateCfg, seed);
      const fee = parseFloat((amount * 0.005 + (i * 0.3)).toFixed(2));
      const receiveAmount = parseFloat(((amount - fee) * rate).toFixed(2));

      const quote: FxQuoteRecord = {
        quoteId: generateQuoteId(),
        userId,
        bank: provider.provider,
        rate,
        fee,
        sendAmount: amount,
        sendCurrency: currency,
        receiveAmount,
        receiveCurrency: 'ETB',
        deliveryTime: i === 0 ? 'Instant' : i === 1 ? '2 min' : i === 2 ? '5 min' : '15 min',
        payoutMethod,
        status: 'active' as FxQuoteStatus,
        providerHealthy: true,
        providerLiquidity: provider.availableLiquidityETB,
        expiresAt,
        createdAt: now(),
        updatedAt: now(),
      };

      await persistQuote(quote);
      quotes.push(quote);
    }

    await writeAuditLog({
      event: 'quote_generated',
      userId,
      quoteIds: quotes.map(q => q.quoteId),
      amount,
      currency,
      providerCount: quotes.length,
      timestamp: now(),
    });

    return quotes;
  },

  async selectQuote(params: {
    userId: string;
    quoteId: string;
  }): Promise<{ quote: FxQuoteRecord; reservation: FxReservation }> {
    const { userId, quoteId } = params;

    // ── Risk Controls Layer ───────────────────────────────────────────────
    if (userId) {
      await clientRiskService.runFxMarketplaceChecks(userId);
    }
    // ─────────────────────────────────────────────────────────────────────

    const quote = await getQuoteById(quoteId);
    if (!quote) {
      await writeAuditLog({
        event: 'quote_rejected',
        userId,
        quoteId,
        reason: 'not_found',
        timestamp: now(),
      });
      throw new FxQuoteNotFoundError(quoteId);
    }

    if (quote.status === 'used') {
      await writeAuditLog({
        event: 'quote_rejected',
        userId,
        quoteId,
        reason: 'already_used',
        timestamp: now(),
      });
      throw new FxQuoteAlreadyUsedError(quoteId);
    }

    const isExpired = new Date(quote.expiresAt).getTime() < Date.now();
    if (isExpired || quote.status === 'expired') {
      await updateQuote(quoteId, { status: 'expired' });
      await writeAuditLog({
        event: 'quote_expired',
        userId,
        quoteId,
        bank: quote.bank,
        expiresAt: quote.expiresAt,
        timestamp: now(),
      });
      throw new FxQuoteExpiredError(quoteId);
    }

    const provider = PROVIDER_HEALTH.find(p => p.provider === quote.bank);
    if (provider && !provider.healthy) {
      await writeAuditLog({
        event: 'quote_rejected',
        userId,
        quoteId,
        reason: 'provider_unhealthy',
        bank: quote.bank,
        timestamp: now(),
      });
      throw new FxInsufficientLiquidityError(quote.bank);
    }

    if (provider && provider.availableLiquidityETB < quote.receiveAmount) {
      await writeAuditLog({
        event: 'quote_rejected',
        userId,
        quoteId,
        reason: 'insufficient_liquidity',
        bank: quote.bank,
        available: provider.availableLiquidityETB,
        required: quote.receiveAmount,
        timestamp: now(),
      });
      throw new FxInsufficientLiquidityError(quote.bank);
    }

    const reservation: FxReservation = {
      reservationId: generateReservationId(),
      quoteId,
      userId,
      bank: quote.bank,
      reservedAmountETB: quote.receiveAmount,
      sendAmount: quote.sendAmount,
      sendCurrency: quote.sendCurrency,
      rate: quote.rate,
      fee: quote.fee,
      status: 'reserved',
      txId: null,
      createdAt: now(),
      updatedAt: now(),
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
    };

    await persistReservation(reservation);

    await updateQuote(quoteId, {
      status: 'selected',
      reservationId: reservation.reservationId,
    });

    if (provider) {
      provider.availableLiquidityETB -= quote.receiveAmount;
    }

    await writeAuditLog({
      event: 'quote_selected',
      userId,
      quoteId,
      bank: quote.bank,
      reservationId: reservation.reservationId,
      reservedAmountETB: quote.receiveAmount,
      rate: quote.rate,
      timestamp: now(),
    });

    return { quote, reservation };
  },

  async validateTransferAgainstQuote(params: {
    quoteId: string;
    transferAmount: number;
    transferCurrency: string;
    userId: string;
  }): Promise<{ quote: FxQuoteRecord; reservation: FxReservation | null }> {
    const { quoteId, transferAmount, transferCurrency, userId } = params;

    const quote = await getQuoteById(quoteId);
    if (!quote) {
      throw new FxQuoteNotFoundError(quoteId);
    }

    const isExpired = new Date(quote.expiresAt).getTime() < Date.now();
    if (isExpired) {
      await updateQuote(quoteId, { status: 'expired' });
      await writeAuditLog({
        event: 'quote_expired',
        userId,
        quoteId,
        reason: 'expired_at_transfer',
        timestamp: now(),
      });
      throw new FxQuoteExpiredError(quoteId);
    }

    if (quote.status === 'used') {
      throw new FxQuoteAlreadyUsedError(quoteId);
    }

    if (quote.sendAmount !== transferAmount || quote.sendCurrency !== transferCurrency) {
      await writeAuditLog({
        event: 'quote_rejected',
        userId,
        quoteId,
        reason: 'amount_mismatch',
        expectedAmount: quote.sendAmount,
        expectedCurrency: quote.sendCurrency,
        receivedAmount: transferAmount,
        receivedCurrency: transferCurrency,
        timestamp: now(),
      });
      throw new FxAmountMismatchError(quote.sendAmount, transferAmount, quote.sendCurrency);
    }

    let reservation: FxReservation | null = null;
    if (quote.reservationId) {
      if (IS_DEV) {
        const stored = await AsyncStorage.getItem(LOCAL_RESERVATIONS_KEY);
        const list: FxReservation[] = stored ? JSON.parse(stored) : [];
        reservation = list.find(r => r.reservationId === quote.reservationId) || null;
      }
    }

    return { quote, reservation };
  },

  async confirmReservation(params: {
    reservationId: string;
    txId: string;
    userId: string;
  }): Promise<void> {
    const { reservationId, txId, userId } = params;

    await updateReservation(reservationId, {
      status: 'confirmed',
      txId,
    });

    const stored = IS_DEV ? await AsyncStorage.getItem(LOCAL_RESERVATIONS_KEY) : null;
    let reservation: FxReservation | null = null;
    if (stored) {
      const list: FxReservation[] = JSON.parse(stored);
      reservation = list.find(r => r.reservationId === reservationId) || null;
    }

    if (reservation?.quoteId) {
      await updateQuote(reservation.quoteId, { status: 'used', txId });
    }

    await writeAuditLog({
      event: 'payout_executed_from_quote',
      userId,
      reservationId,
      txId,
      quoteId: reservation?.quoteId,
      bank: reservation?.bank,
      amountETB: reservation?.reservedAmountETB,
      timestamp: now(),
    });
  },

  async releaseReservation(params: {
    reservationId: string;
    userId: string;
    reason: 'abandoned' | 'failed' | 'expired';
  }): Promise<void> {
    const { reservationId, userId, reason } = params;

    await updateReservation(reservationId, {
      status: 'released',
    });

    if (IS_DEV) {
      const stored = await AsyncStorage.getItem(LOCAL_RESERVATIONS_KEY);
      if (stored) {
        const list: FxReservation[] = JSON.parse(stored);
        const reservation = list.find(r => r.reservationId === reservationId);
        if (reservation) {
          const provider = PROVIDER_HEALTH.find(p => p.provider === reservation.bank);
          if (provider) {
            provider.availableLiquidityETB += reservation.reservedAmountETB;
          }
          if (reservation.quoteId) {
            await updateQuote(reservation.quoteId, {
              status: reason === 'expired' ? 'expired' : 'active',
            });
          }
        }
      }
    }

    await writeAuditLog({
      event: 'quote_rejected',
      userId,
      reservationId,
      reason: `reservation_${reason}`,
      timestamp: now(),
    });
  },

  async getMarketplaceStats(userId: string): Promise<FxMarketplaceStats> {
    let allQuotes: FxQuoteRecord[] = [];
    let allAuditLogs: FxAuditLog[] = [];

    if (IS_DEV) {
      const quotesStored = await AsyncStorage.getItem(LOCAL_QUOTES_KEY);
      allQuotes = quotesStored ? JSON.parse(quotesStored) : [];
      const auditStored = await AsyncStorage.getItem(LOCAL_AUDIT_KEY);
      allAuditLogs = auditStored ? JSON.parse(auditStored) : [];
    } else {
      try {
        const quotesSnap = await getDocs(collection(db, 'fx_quotes'));
        allQuotes = quotesSnap.docs.map(d => d.data() as FxQuoteRecord);
        const auditSnap = await getDocs(collection(db, 'fx_audit_log'));
        allAuditLogs = auditSnap.docs.map(d => d.data() as FxAuditLog);
      } catch (e) {
        console.error('Failed to fetch marketplace stats:', e);
      }
    }

    const quotesGenerated = allQuotes.length;
    const quotesSelected = allQuotes.filter(q => q.status === 'selected' || q.status === 'used').length;
    const quotesExpired = allQuotes.filter(q => q.status === 'expired').length;

    const bankQuotes = new Map<string, { generated: number; selected: number }>();
    for (const q of allQuotes) {
      const entry = bankQuotes.get(q.bank) || { generated: 0, selected: 0 };
      entry.generated++;
      if (q.status === 'selected' || q.status === 'used') entry.selected++;
      bankQuotes.set(q.bank, entry);
    }

    const conversionRateByBank: { bank: string; generated: number; selected: number; conversionRate: number }[] = [];
    for (const [bank, data] of bankQuotes) {
      conversionRateByBank.push({
        bank,
        generated: data.generated,
        selected: data.selected,
        conversionRate: data.generated > 0 ? parseFloat((data.selected / data.generated * 100).toFixed(1)) : 0,
      });
    }

    const failedExecutions = allAuditLogs.filter(l => l.event === 'quote_rejected' && l.reason?.includes('reservation_failed')).length;

    const providerHealth = PROVIDER_HEALTH.map(p => ({
      provider: p.provider,
      healthy: p.healthy,
      availableLiquidityETB: p.availableLiquidityETB,
    }));

    return {
      quotesGenerated,
      quotesSelected,
      quotesExpired,
      failedExecutions,
      conversionRateByBank,
      providerHealth,
      recentAuditLogs: allAuditLogs.slice(0, 50),
    };
  },

  getProviderHealth(): FxProviderHealth[] {
    return [...PROVIDER_HEALTH];
  },

  setProviderHealth(provider: string, healthy: boolean): void {
    const p = PROVIDER_HEALTH.find(h => h.provider === provider);
    if (p) {
      p.healthy = healthy;
      p.lastCheckedAt = now();
    }
  },

  setProviderLiquidity(provider: string, amount: number): void {
    const p = PROVIDER_HEALTH.find(h => h.provider === provider);
    if (p) {
      p.availableLiquidityETB = amount;
      p.lastCheckedAt = now();
    }
  },
};

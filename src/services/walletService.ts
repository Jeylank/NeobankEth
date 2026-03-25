import {
  db,
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  setDoc,
  query,
  orderBy,
  limit as firestoreLimit,
  serverTimestamp,
} from './firebase';
import { exchangeRatesApi } from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clientRiskService } from './riskControls/clientRiskService';
import type {
  Wallet,
  LedgerEntry,
  FxConversion,
  WalletCurrency,
  LedgerCategory,
  LedgerEntryType,
  LedgerStatus,
} from '../types';

const LOCAL_WALLET_KEY = 'wallet_local';
const LOCAL_ENTRIES_KEY = 'wallet_entries_local';
const LOCAL_FX_KEY = 'fx_conversions_local';
const IS_DEV = __DEV__;

const MOCK_RATES: Record<string, Record<string, number>> = {
  EUR: { USD: 1.08, GBP: 0.86, EUR: 1 },
  USD: { EUR: 0.93, GBP: 0.79, USD: 1 },
  GBP: { EUR: 1.16, USD: 1.27, GBP: 1 },
};

function walletDocRef(userId: string) {
  return doc(db, 'wallets', userId);
}

function entriesRef(userId: string) {
  return collection(db, 'wallets', userId, 'entries');
}

function fxConversionsRef() {
  return collection(db, 'fx_conversions');
}

async function getLocalWallet(userId: string): Promise<Wallet | null> {
  try {
    const stored = await AsyncStorage.getItem(`${LOCAL_WALLET_KEY}_${userId}`);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

async function saveLocalWallet(userId: string, wallet: Wallet): Promise<void> {
  await AsyncStorage.setItem(`${LOCAL_WALLET_KEY}_${userId}`, JSON.stringify(wallet));
}

async function getLocalEntries(userId: string): Promise<LedgerEntry[]> {
  try {
    const stored = await AsyncStorage.getItem(`${LOCAL_ENTRIES_KEY}_${userId}`);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

async function saveLocalEntries(userId: string, entries: LedgerEntry[]): Promise<void> {
  await AsyncStorage.setItem(`${LOCAL_ENTRIES_KEY}_${userId}`, JSON.stringify(entries));
}

async function getLocalFxConversions(): Promise<FxConversion[]> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_FX_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

async function saveLocalFxConversions(conversions: FxConversion[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_FX_KEY, JSON.stringify(conversions));
}

class WalletService {
  private useLocalFallback = false;

  private enableFallback(): void {
    if (!this.useLocalFallback) {
      console.warn('Firestore unavailable for wallet — using local storage fallback');
      this.useLocalFallback = true;
    }
  }

  isOffline(): boolean {
    return this.useLocalFallback;
  }

  async createWallet(userId: string): Promise<Wallet> {
    const now = new Date().toISOString();
    const wallet: Wallet = {
      userId,
      balances: { EUR: 0, USD: 0, GBP: 0 },
      reservations: { EUR: 0, USD: 0, GBP: 0 },
      defaultCurrency: 'EUR',
      updatedAt: now,
    };

    if (this.useLocalFallback || !userId) {
      await saveLocalWallet(userId, wallet);
      return wallet;
    }

    try {
      await setDoc(walletDocRef(userId), wallet);
      return wallet;
    } catch (error) {
      console.error('Firestore createWallet failed:', error);
      this.enableFallback();
      await saveLocalWallet(userId, wallet);
      return wallet;
    }
  }

  async getWallet(userId: string): Promise<Wallet | null> {
    if (this.useLocalFallback) {
      return getLocalWallet(userId);
    }

    try {
      const snap = await getDoc(walletDocRef(userId));
      if (!snap.exists()) return null;
      return snap.data() as Wallet;
    } catch (error) {
      console.error('Firestore getWallet failed:', error);
      this.enableFallback();
      return getLocalWallet(userId);
    }
  }

  async creditWallet(
    userId: string,
    currency: WalletCurrency,
    amount: number,
    category: LedgerCategory,
    provider?: string,
    providerRef?: string
  ): Promise<LedgerEntry> {
    // ── Risk Controls Layer (TOPUP only) ────────────────────────────────────
    if (category === 'TOPUP' && userId && !this.useLocalFallback) {
      await clientRiskService.runTopupChecks(userId, amount, currency);
    }
    // ───────────────────────────────────────────────────────────────────────
    const now = new Date().toISOString();
    const entry: LedgerEntry = {
      entryId: `entry_${Date.now()}`,
      type: 'CREDIT',
      category,
      currency,
      amount,
      status: 'POSTED',
      provider,
      providerRef,
      description: `${category} credit of ${amount} ${currency}`,
      createdAt: now,
    };

    if (this.useLocalFallback || !userId) {
      const wallet = await getLocalWallet(userId);
      if (!wallet) throw new Error('Wallet not found');
      wallet.balances[currency] += amount;
      wallet.updatedAt = now;
      await saveLocalWallet(userId, wallet);

      const entries = await getLocalEntries(userId);
      entries.unshift(entry);
      await saveLocalEntries(userId, entries);
      return entry;
    }

    try {
      const walletSnap = await getDoc(walletDocRef(userId));
      if (!walletSnap.exists()) throw new Error('Wallet not found');
      const wallet = walletSnap.data() as Wallet;

      wallet.balances[currency] += amount;
      wallet.updatedAt = now;
      await updateDoc(walletDocRef(userId), {
        [`balances.${currency}`]: wallet.balances[currency],
        updatedAt: now,
      });

      const docRef = await addDoc(entriesRef(userId), entry);
      entry.entryId = docRef.id;
      return entry;
    } catch (error: any) {
      if (error?.message === 'Wallet not found') throw error;
      console.error('Firestore creditWallet failed:', error);
      this.enableFallback();

      const wallet = await getLocalWallet(userId);
      if (!wallet) throw new Error('Wallet not found');
      wallet.balances[currency] += amount;
      wallet.updatedAt = now;
      await saveLocalWallet(userId, wallet);

      const entries = await getLocalEntries(userId);
      entries.unshift(entry);
      await saveLocalEntries(userId, entries);
      return entry;
    }
  }

  async debitWallet(
    userId: string,
    currency: WalletCurrency,
    amount: number,
    category: LedgerCategory,
    txId?: string
  ): Promise<LedgerEntry> {
    const now = new Date().toISOString();
    const entry: LedgerEntry = {
      entryId: `entry_${Date.now()}`,
      type: 'DEBIT',
      category,
      currency,
      amount,
      status: 'POSTED',
      txId,
      description: `${category} debit of ${amount} ${currency}`,
      createdAt: now,
    };

    if (this.useLocalFallback || !userId) {
      const wallet = await getLocalWallet(userId);
      if (!wallet) throw new Error('Wallet not found');
      if (wallet.balances[currency] < amount) throw new Error('Insufficient balance');
      wallet.balances[currency] -= amount;
      wallet.updatedAt = now;
      await saveLocalWallet(userId, wallet);

      const entries = await getLocalEntries(userId);
      entries.unshift(entry);
      await saveLocalEntries(userId, entries);
      return entry;
    }

    try {
      const walletSnap = await getDoc(walletDocRef(userId));
      if (!walletSnap.exists()) throw new Error('Wallet not found');
      const wallet = walletSnap.data() as Wallet;

      if (wallet.balances[currency] < amount) throw new Error('Insufficient balance');

      wallet.balances[currency] -= amount;
      wallet.updatedAt = now;
      await updateDoc(walletDocRef(userId), {
        [`balances.${currency}`]: wallet.balances[currency],
        updatedAt: now,
      });

      const docRef = await addDoc(entriesRef(userId), entry);
      entry.entryId = docRef.id;
      return entry;
    } catch (error: any) {
      if (error?.message === 'Wallet not found' || error?.message === 'Insufficient balance') throw error;
      console.error('Firestore debitWallet failed:', error);
      this.enableFallback();

      const wallet = await getLocalWallet(userId);
      if (!wallet) throw new Error('Wallet not found');
      if (wallet.balances[currency] < amount) throw new Error('Insufficient balance');
      wallet.balances[currency] -= amount;
      wallet.updatedAt = now;
      await saveLocalWallet(userId, wallet);

      const entries = await getLocalEntries(userId);
      entries.unshift(entry);
      await saveLocalEntries(userId, entries);
      return entry;
    }
  }

  async reserveFunds(userId: string, currency: WalletCurrency, amount: number): Promise<LedgerEntry> {
    const now = new Date().toISOString();
    const entry: LedgerEntry = {
      entryId: `entry_${Date.now()}`,
      type: 'DEBIT',
      category: 'REMITTANCE',
      currency,
      amount,
      status: 'RESERVED',
      description: `Reserved ${amount} ${currency}`,
      createdAt: now,
    };

    if (this.useLocalFallback || !userId) {
      const wallet = await getLocalWallet(userId);
      if (!wallet) throw new Error('Wallet not found');
      if (wallet.balances[currency] < amount) throw new Error('Insufficient balance');
      wallet.balances[currency] -= amount;
      wallet.reservations[currency] += amount;
      wallet.updatedAt = now;
      await saveLocalWallet(userId, wallet);
      const entries = await getLocalEntries(userId);
      entries.unshift(entry);
      await saveLocalEntries(userId, entries);
      return entry;
    }

    try {
      const walletSnap = await getDoc(walletDocRef(userId));
      if (!walletSnap.exists()) throw new Error('Wallet not found');
      const wallet = walletSnap.data() as Wallet;

      if (wallet.balances[currency] < amount) throw new Error('Insufficient balance');

      await updateDoc(walletDocRef(userId), {
        [`balances.${currency}`]: wallet.balances[currency] - amount,
        [`reservations.${currency}`]: (wallet.reservations[currency] || 0) + amount,
        updatedAt: now,
      });

      const docRef = await addDoc(entriesRef(userId), entry);
      entry.entryId = docRef.id;
      return entry;
    } catch (error: any) {
      if (error?.message === 'Wallet not found' || error?.message === 'Insufficient balance') throw error;
      console.error('Firestore reserveFunds failed:', error);
      this.enableFallback();

      const wallet = await getLocalWallet(userId);
      if (!wallet) throw new Error('Wallet not found');
      if (wallet.balances[currency] < amount) throw new Error('Insufficient balance');
      wallet.balances[currency] -= amount;
      wallet.reservations[currency] += amount;
      wallet.updatedAt = now;
      await saveLocalWallet(userId, wallet);
      const entries = await getLocalEntries(userId);
      entries.unshift(entry);
      await saveLocalEntries(userId, entries);
      return entry;
    }
  }

  async releaseReservation(userId: string, currency: WalletCurrency, amount: number, reservationEntryId?: string): Promise<LedgerEntry> {
    const now = new Date().toISOString();
    const entry: LedgerEntry = {
      entryId: `entry_${Date.now()}`,
      type: 'CREDIT',
      category: 'REMITTANCE',
      currency,
      amount,
      status: 'CANCELLED',
      description: `Released reservation of ${amount} ${currency}`,
      createdAt: now,
    };

    if (this.useLocalFallback || !userId) {
      const wallet = await getLocalWallet(userId);
      if (!wallet) throw new Error('Wallet not found');
      const reserved = wallet.reservations[currency] || 0;
      if (reserved < amount) throw new Error('Insufficient reservation');
      wallet.reservations[currency] = reserved - amount;
      wallet.balances[currency] += amount;
      wallet.updatedAt = now;
      await saveLocalWallet(userId, wallet);
      const entries = await getLocalEntries(userId);
      entries.unshift(entry);
      await saveLocalEntries(userId, entries);
      return entry;
    }

    try {
      const walletSnap = await getDoc(walletDocRef(userId));
      if (!walletSnap.exists()) throw new Error('Wallet not found');
      const wallet = walletSnap.data() as Wallet;
      const reserved = wallet.reservations[currency] || 0;
      if (reserved < amount) throw new Error('Insufficient reservation');

      await updateDoc(walletDocRef(userId), {
        [`reservations.${currency}`]: reserved - amount,
        [`balances.${currency}`]: wallet.balances[currency] + amount,
        updatedAt: now,
      });

      const docRef = await addDoc(entriesRef(userId), entry);
      entry.entryId = docRef.id;
      return entry;
    } catch (error: any) {
      if (error?.message === 'Wallet not found' || error?.message === 'Insufficient reservation') throw error;
      console.error('Firestore releaseReservation failed:', error);
      this.enableFallback();

      const wallet = await getLocalWallet(userId);
      if (!wallet) throw new Error('Wallet not found');
      const reserved = wallet.reservations[currency] || 0;
      if (reserved < amount) throw new Error('Insufficient reservation');
      wallet.reservations[currency] = reserved - amount;
      wallet.balances[currency] += amount;
      wallet.updatedAt = now;
      await saveLocalWallet(userId, wallet);
      const entries = await getLocalEntries(userId);
      entries.unshift(entry);
      await saveLocalEntries(userId, entries);
      return entry;
    }
  }

  async confirmReservation(
    userId: string,
    currency: WalletCurrency,
    amount: number,
    category: LedgerCategory,
    txId?: string
  ): Promise<LedgerEntry> {
    const now = new Date().toISOString();
    const entry: LedgerEntry = {
      entryId: `entry_${Date.now()}`,
      type: 'DEBIT',
      category,
      currency,
      amount,
      status: 'POSTED',
      txId,
      description: `${category} confirmed reservation of ${amount} ${currency}`,
      createdAt: now,
    };

    if (this.useLocalFallback || !userId) {
      const wallet = await getLocalWallet(userId);
      if (!wallet) throw new Error('Wallet not found');
      const reserved = wallet.reservations[currency] || 0;
      if (reserved < amount) throw new Error('Insufficient reservation');
      wallet.reservations[currency] = reserved - amount;
      wallet.updatedAt = now;
      await saveLocalWallet(userId, wallet);

      const entries = await getLocalEntries(userId);
      entries.unshift(entry);
      await saveLocalEntries(userId, entries);
      return entry;
    }

    try {
      const walletSnap = await getDoc(walletDocRef(userId));
      if (!walletSnap.exists()) throw new Error('Wallet not found');
      const wallet = walletSnap.data() as Wallet;
      const reserved = wallet.reservations[currency] || 0;
      if (reserved < amount) throw new Error('Insufficient reservation');

      await updateDoc(walletDocRef(userId), {
        [`reservations.${currency}`]: reserved - amount,
        updatedAt: now,
      });

      const docRef = await addDoc(entriesRef(userId), entry);
      entry.entryId = docRef.id;
      return entry;
    } catch (error: any) {
      if (error?.message === 'Wallet not found' || error?.message === 'Insufficient reservation') throw error;
      console.error('Firestore confirmReservation failed:', error);
      this.enableFallback();

      const wallet = await getLocalWallet(userId);
      if (!wallet) throw new Error('Wallet not found');
      const reserved = wallet.reservations[currency] || 0;
      if (reserved < amount) throw new Error('Insufficient reservation');
      wallet.reservations[currency] = reserved - amount;
      wallet.updatedAt = now;
      await saveLocalWallet(userId, wallet);

      const entries = await getLocalEntries(userId);
      entries.unshift(entry);
      await saveLocalEntries(userId, entries);
      return entry;
    }
  }

  async getWalletActivity(userId: string, activityLimit?: number): Promise<LedgerEntry[]> {
    const fetchLimit = activityLimit || 50;

    if (this.useLocalFallback) {
      const entries = await getLocalEntries(userId);
      return entries.slice(0, fetchLimit);
    }

    try {
      const q = query(
        entriesRef(userId),
        orderBy('createdAt', 'desc'),
        firestoreLimit(fetchLimit)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => ({ ...d.data(), entryId: d.id } as LedgerEntry));
    } catch (error) {
      console.error('Firestore getWalletActivity failed:', error);
      this.enableFallback();
      const entries = await getLocalEntries(userId);
      return entries.slice(0, fetchLimit);
    }
  }

  async convertCurrency(
    userId: string,
    fromCurrency: WalletCurrency,
    toCurrency: WalletCurrency,
    amount: number
  ): Promise<FxConversion> {
    const rate = await this.getExchangeRate(fromCurrency, toCurrency);
    const fee = Math.round(amount * 0.015 * 100) / 100;
    const netAmount = amount - fee;
    const toAmount = Math.round(netAmount * rate * 100) / 100;
    const now = new Date().toISOString();

    await this.debitWallet(userId, fromCurrency, amount, 'CONVERSION');
    try {
      await this.creditWallet(userId, toCurrency, toAmount, 'CONVERSION');
    } catch (creditError) {
      await this.creditWallet(userId, fromCurrency, amount, 'CONVERSION');
      throw creditError;
    }

    const conversion: FxConversion = {
      id: `fx_${Date.now()}`,
      userId,
      fromCurrency,
      toCurrency,
      fromAmount: amount,
      toAmount,
      rate,
      fee,
      createdAt: now,
    };

    if (this.useLocalFallback || !userId) {
      const conversions = await getLocalFxConversions();
      conversions.unshift(conversion);
      await saveLocalFxConversions(conversions);
      return conversion;
    }

    try {
      const docRef = await addDoc(fxConversionsRef(), conversion);
      conversion.id = docRef.id;
      return conversion;
    } catch (error) {
      console.error('Firestore convertCurrency record failed:', error);
      this.enableFallback();
      const conversions = await getLocalFxConversions();
      conversions.unshift(conversion);
      await saveLocalFxConversions(conversions);
      return conversion;
    }
  }

  async calculateBalance(userId: string): Promise<Record<WalletCurrency, number>> {
    const entries = await this.getWalletActivity(userId, 10000);
    const balances: Record<WalletCurrency, number> = { EUR: 0, USD: 0, GBP: 0 };

    for (const entry of entries) {
      if (entry.status === 'CANCELLED') continue;
      if (entry.type === 'CREDIT') {
        balances[entry.currency] += entry.amount;
      } else if (entry.type === 'DEBIT') {
        balances[entry.currency] -= entry.amount;
      }
    }

    return balances;
  }

  async getExchangeRate(from: WalletCurrency, to: WalletCurrency): Promise<number> {
    if (from === to) return 1;

    try {
      const result = await exchangeRatesApi.convert(from, to, 1);
      return result.rate;
    } catch {
      const rate = MOCK_RATES[from]?.[to];
      if (rate) return rate;
      return 1;
    }
  }
}

export const walletService = new WalletService();

import { collection, addDoc, getDocs, query, orderBy, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { getAuth } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clientRiskService, RiskError } from './riskControls/clientRiskService';

const RECIPIENTS_STORAGE_KEY = 'habeshare_recipients';

export interface RemittanceRecord {
  txId:           string;
  userId:         string;
  amount:         number;
  fromCurrency:   string;
  toCurrency:     string;
  convertedAmount: number;
  beneficiaryId:  number | null;
  recipientName:  string;
  description:    string;
  paymentMethod:  string;
  payoutMethod:   string;
  status:         'pending' | 'processing' | 'delivered' | 'failed';
  createdAt:      any;
}

export interface SavedRecipient {
  id:           number;
  name:         string;
  phone:        string;
  bank:         string;
  accountNumber: string;
  currency:     string;
  country:      string;
}

const DEFAULT_RECIPIENTS: SavedRecipient[] = [
  { id: 1, name: 'Abebe Bekele',   phone: '+251911234567', bank: 'CBE',       accountNumber: '1000123456789', currency: 'ETB', country: 'Ethiopia' },
  { id: 2, name: 'Tigist Haile',   phone: '+251922345678', bank: 'Dashen',    accountNumber: '5678901234',    currency: 'ETB', country: 'Ethiopia' },
  { id: 3, name: 'Mulugeta Girma', phone: '+251933456789', bank: 'Awash',     accountNumber: '9012345678',    currency: 'ETB', country: 'Ethiopia' },
  { id: 4, name: 'Selamawit Tesfaye', phone: '+251944567890', bank: 'Abyssinia', accountNumber: '3456789012', currency: 'ETB', country: 'Ethiopia' },
];

export async function getRecipients(): Promise<SavedRecipient[]> {
  try {
    const user = getAuth().currentUser;
    if (user) {
      const snap = await getDocs(
        query(collection(db, 'users', user.uid, 'recipients'), orderBy('name'))
      );
      if (!snap.empty) {
        return snap.docs.map((d, i) => ({ id: i + 1, ...d.data() } as SavedRecipient));
      }
    }
  } catch {
    // fall through
  }

  try {
    const stored = await AsyncStorage.getItem(RECIPIENTS_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // fall through
  }

  return DEFAULT_RECIPIENTS;
}

export async function initiateTransferFirestore(data: {
  amount:         number;
  fromCurrency:   string;
  toCurrency:     string;
  beneficiaryId:  number;
  description?:   string;
  paymentMethod?: string;
  payoutMethod?:  string;
  quoteId?:       string;
  recipientName?: string;
  convertedAmount?: number;
}): Promise<{ txId: string; status: string }> {
  const user = getAuth().currentUser;

  // ── Risk Controls Layer ───────────────────────────────────────────────────
  if (user) {
    await clientRiskService.runRemittanceChecks(user.uid, data.amount, data.fromCurrency);
  }
  // ─────────────────────────────────────────────────────────────────────────

  const txId = 'TX-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();

  const record: Omit<RemittanceRecord, 'txId'> & { txId: string } = {
    txId,
    userId:          user?.uid ?? 'anonymous',
    amount:          data.amount,
    fromCurrency:    data.fromCurrency,
    toCurrency:      data.toCurrency,
    convertedAmount: data.convertedAmount ?? 0,
    beneficiaryId:   data.beneficiaryId,
    recipientName:   data.recipientName ?? 'Recipient',
    description:     data.description ?? '',
    paymentMethod:   data.paymentMethod ?? 'wallet',
    payoutMethod:    data.payoutMethod ?? 'bank_account',
    status:          'pending',
    createdAt:       serverTimestamp(),
  };

  try {
    if (user) {
      const ref = collection(db, 'users', user.uid, 'transactions');
      await addDoc(ref, record);
      await addDoc(collection(db, 'transactions'), record);
    }
  } catch {
    try {
      const existing = await AsyncStorage.getItem('habeshare_transactions');
      const list = existing ? JSON.parse(existing) : [];
      list.unshift({ ...record, createdAt: new Date().toISOString() });
      await AsyncStorage.setItem('habeshare_transactions', JSON.stringify(list.slice(0, 100)));
    } catch {
      // best effort
    }
  }

  return { txId, status: 'pending' };
}

export async function getWalletBalanceFallback(): Promise<number> {
  try {
    const user = getAuth().currentUser;
    if (user) {
      const snap = await getDoc(doc(db, 'wallets', user.uid));
      if (snap.exists()) {
        const data = snap.data();
        const eur = data?.balances?.EUR ?? 0;
        const usd = data?.balances?.USD ?? 0;
        const gbp = data?.balances?.GBP ?? 0;
        const total = eur + usd + gbp;
        return total > 0 ? total : 10000;
      }
    }
  } catch {
    // fall through
  }

  try {
    const raw = await AsyncStorage.getItem(`wallet_data_${getAuth().currentUser?.uid ?? 'local'}`);
    if (raw) {
      const w = JSON.parse(raw);
      return (w?.balances?.EUR ?? 0) + (w?.balances?.USD ?? 0) + (w?.balances?.GBP ?? 0);
    }
  } catch {
    // fall through
  }

  return 10000;
}

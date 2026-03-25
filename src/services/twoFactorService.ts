import { db } from './firebase';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TWO_FACTOR_SETTINGS_COLLECTION = 'two_factor_settings';
const TWO_FACTOR_CHALLENGES_COLLECTION = 'two_factor_challenges';
const OTP_EXPIRY_MS = 5 * 60 * 1000;

export interface TwoFactorSettings {
  enabled: boolean;
  email?: string;
  enabledAt?: Date;
}

export interface TwoFactorChallenge {
  code: string;
  expiresAt: Date;
  used: boolean;
  uid: string;
}

function generateOTPCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export const twoFactorService = {
  isEnabled: async (uid: string): Promise<boolean> => {
    try {
      const ref = doc(db, TWO_FACTOR_SETTINGS_COLLECTION, uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) return false;
      return snap.data()?.enabled === true;
    } catch {
      const local = await AsyncStorage.getItem(`2fa_enabled_${uid}`);
      return local === 'true';
    }
  },

  getSettings: async (uid: string): Promise<TwoFactorSettings> => {
    try {
      const ref = doc(db, TWO_FACTOR_SETTINGS_COLLECTION, uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) return { enabled: false };
      const data = snap.data();
      return {
        enabled:   data?.enabled ?? false,
        email:     data?.email,
        enabledAt: data?.enabledAt?.toDate?.(),
      };
    } catch {
      const local = await AsyncStorage.getItem(`2fa_enabled_${uid}`);
      return { enabled: local === 'true' };
    }
  },

  enable: async (uid: string, email: string): Promise<void> => {
    try {
      const ref = doc(db, TWO_FACTOR_SETTINGS_COLLECTION, uid);
      await setDoc(ref, {
        enabled:   true,
        email,
        enabledAt: serverTimestamp(),
      });
    } catch {
      /* empty */
    }
    await AsyncStorage.setItem(`2fa_enabled_${uid}`, 'true');
  },

  disable: async (uid: string): Promise<void> => {
    try {
      await deleteDoc(doc(db, TWO_FACTOR_SETTINGS_COLLECTION, uid));
      await deleteDoc(doc(db, TWO_FACTOR_CHALLENGES_COLLECTION, uid));
    } catch {
      /* empty */
    }
    await AsyncStorage.removeItem(`2fa_enabled_${uid}`);
    await AsyncStorage.removeItem(`2fa_challenge_${uid}`);
  },

  generateAndStoreOTP: async (uid: string): Promise<string> => {
    const code    = generateOTPCode();
    const expires = Date.now() + OTP_EXPIRY_MS;

    try {
      const ref = doc(db, TWO_FACTOR_CHALLENGES_COLLECTION, uid);
      await setDoc(ref, {
        code,
        expiresAt: Timestamp.fromMillis(expires),
        used:      false,
        uid,
        createdAt: serverTimestamp(),
      });
    } catch {
      /* empty */
    }

    await AsyncStorage.setItem(
      `2fa_challenge_${uid}`,
      JSON.stringify({ code, expires })
    );

    return code;
  },

  verifyOTP: async (uid: string, inputCode: string): Promise<{ success: boolean; error?: string }> => {
    const trimmed = inputCode.trim();

    try {
      const ref  = doc(db, TWO_FACTOR_CHALLENGES_COLLECTION, uid);
      const snap = await getDoc(ref);

      if (snap.exists()) {
        const data = snap.data();
        if (data.used) return { success: false, error: 'Code already used.' };
        const expiresAt: Date = data.expiresAt?.toDate?.() ?? new Date(0);
        if (Date.now() > expiresAt.getTime()) return { success: false, error: 'Code expired. Request a new one.' };
        if (data.code !== trimmed) return { success: false, error: 'Incorrect code. Please try again.' };

        await setDoc(ref, { ...data, used: true });
        await AsyncStorage.removeItem(`2fa_challenge_${uid}`);
        return { success: true };
      }
    } catch {
      /* fall through to local */
    }

    const local = await AsyncStorage.getItem(`2fa_challenge_${uid}`);
    if (!local) return { success: false, error: 'No active challenge. Request a new code.' };
    const { code, expires } = JSON.parse(local);
    if (Date.now() > expires) return { success: false, error: 'Code expired. Request a new one.' };
    if (code !== trimmed) return { success: false, error: 'Incorrect code. Please try again.' };

    await AsyncStorage.removeItem(`2fa_challenge_${uid}`);
    return { success: true };
  },
};

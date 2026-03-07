import { biometricService } from '../services/biometric';
import { secureStorage } from './storage';

const SESSION_TIMEOUT_KEY = 'sessionTimeoutMinutes';
const LAST_ACTIVITY_KEY = 'lastActivityTimestamp';
const BIOMETRIC_CONFIRM_KEY = 'biometricConfirmEnabled';

export const SessionManager = {
  async getTimeoutMinutes(): Promise<number> {
    const val = await secureStorage.getItemAsync(SESSION_TIMEOUT_KEY);
    return val ? parseInt(val, 10) : 5;
  },

  async setTimeoutMinutes(minutes: number): Promise<void> {
    await secureStorage.setItemAsync(SESSION_TIMEOUT_KEY, minutes.toString());
  },

  async recordActivity(): Promise<void> {
    await secureStorage.setItemAsync(LAST_ACTIVITY_KEY, Date.now().toString());
  },

  async isSessionExpired(): Promise<boolean> {
    const lastActivity = await secureStorage.getItemAsync(LAST_ACTIVITY_KEY);
    if (!lastActivity) return false;

    const timeoutMinutes = await this.getTimeoutMinutes();
    const elapsed = Date.now() - parseInt(lastActivity, 10);
    return elapsed > timeoutMinutes * 60 * 1000;
  },

  async clearSession(): Promise<void> {
    await secureStorage.deleteItemAsync(LAST_ACTIVITY_KEY);
  },
};

export async function requireBiometricConfirmation(promptMessage?: string): Promise<boolean> {
  const enabled = await secureStorage.getItemAsync(BIOMETRIC_CONFIRM_KEY);
  if (enabled !== 'true') return true;

  const available = await biometricService.isAvailable();
  if (!available) return true;

  return biometricService.authenticate(promptMessage || 'Confirm your identity');
}

export async function setBiometricConfirmEnabled(value: boolean): Promise<void> {
  await secureStorage.setItemAsync(BIOMETRIC_CONFIRM_KEY, value ? 'true' : 'false');
}

export async function isBiometricConfirmEnabled(): Promise<boolean> {
  const val = await secureStorage.getItemAsync(BIOMETRIC_CONFIRM_KEY);
  return val === 'true';
}

export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .replace(/&(?!amp;|lt;|gt;|quot;|#)/g, '&amp;')
    .trim();
}

export function validateAmount(amount: string | number): { valid: boolean; error?: string } {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (isNaN(num)) {
    return { valid: false, error: 'Invalid number' };
  }
  if (num <= 0) {
    return { valid: false, error: 'Amount must be positive' };
  }
  if (num > 1000000) {
    return { valid: false, error: 'Amount exceeds maximum limit' };
  }

  const decimalPart = num.toString().split('.')[1];
  if (decimalPart && decimalPart.length > 2) {
    return { valid: false, error: 'Maximum 2 decimal places allowed' };
  }

  return { valid: true };
}

export function maskAccountNumber(num: string): string {
  if (!num || num.length <= 4) return num;
  return '••••' + num.slice(-4);
}

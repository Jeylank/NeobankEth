import {
  db,
  doc,
  setDoc,
  getDoc,
  updateDoc,
} from './firebase';

const IS_DEV = __DEV__;
const LOCK_TTL_MS = 60 * 1000;

export interface RateLock {
  lockId: string;
  userId: string;
  quoteId: string;
  lockedRate: number;
  expiresAt: string;
  status: 'active' | 'expired' | 'released';
  createdAt: string;
}

const inMemoryLocks = new Map<string, RateLock>();

function generateLockId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `LOCK-${ts}-${rand}`;
}

function now(): string {
  return new Date().toISOString();
}

export const rateLockService = {
  async lockRate(userId: string, quoteId: string, rate?: number): Promise<RateLock> {
    const lockId = generateLockId();
    const expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();

    const lock: RateLock = {
      lockId,
      userId,
      quoteId,
      lockedRate: rate ?? 0,
      expiresAt,
      status: 'active',
      createdAt: now(),
    };

    if (IS_DEV) {
      inMemoryLocks.set(lockId, lock);
    } else {
      try {
        await setDoc(doc(db, 'rate_locks', lockId), lock);
      } catch (e) {
        console.error('Failed to persist rate lock:', e);
      }
    }

    return lock;
  },

  async validateRateLock(lockId: string): Promise<{ valid: boolean; lock: RateLock | null }> {
    let lock: RateLock | null = null;

    if (IS_DEV) {
      lock = inMemoryLocks.get(lockId) ?? null;
    } else {
      try {
        const snap = await getDoc(doc(db, 'rate_locks', lockId));
        lock = snap.exists() ? (snap.data() as RateLock) : null;
      } catch (e) {
        console.error('Failed to validate rate lock:', e);
        return { valid: false, lock: null };
      }
    }

    if (!lock) {
      return { valid: false, lock: null };
    }

    const isExpired = new Date(lock.expiresAt).getTime() < Date.now();
    if (isExpired || lock.status === 'expired' || lock.status === 'released') {
      if (isExpired && lock.status === 'active') {
        lock.status = 'expired';
        if (IS_DEV) {
          inMemoryLocks.set(lockId, lock);
        } else {
          try {
            await updateDoc(doc(db, 'rate_locks', lockId), { status: 'expired' });
          } catch (e) {
            console.error('Failed to update expired lock:', e);
          }
        }
      }
      return { valid: false, lock };
    }

    return { valid: true, lock };
  },

  async releaseLock(lockId: string): Promise<void> {
    if (IS_DEV) {
      const lock = inMemoryLocks.get(lockId);
      if (lock) {
        lock.status = 'released';
        inMemoryLocks.set(lockId, lock);
      }
    } else {
      try {
        await updateDoc(doc(db, 'rate_locks', lockId), { status: 'released' });
      } catch (e) {
        console.error('Failed to release rate lock:', e);
      }
    }
  },
};

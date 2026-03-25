/**
 * src/utils/cache.ts
 * ──────────────────
 * Lightweight, type-safe in-memory TTL cache for client-side services.
 *
 * Designed for:
 *   - FX quote sets (30 s TTL)
 *   - Provider health snapshots (15 s TTL)
 *
 * Module-level singleton — shared across all service imports in the same JS
 * runtime (React Native JS thread or web worker).
 *
 * Usage:
 *   import { cache } from '../utils/cache';
 *   cache.set('fx_quotes:USD:100', quotes, 30_000);
 *   const cached = cache.get<FxQuoteRecord[]>('fx_quotes:USD:100');
 */

interface CacheEntry<T> {
  value:     T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export const cache = {
  /**
   * Retrieve a cached value. Returns undefined on miss or expiry.
   */
  get<T>(key: string): T | undefined {
    const entry = store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  },

  /**
   * Store a value with a TTL in milliseconds.
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  },

  /**
   * Immediately evict a single key.
   */
  invalidate(key: string): void {
    store.delete(key);
  },

  /**
   * Evict all keys whose names start with a given prefix.
   */
  invalidatePrefix(prefix: string): void {
    for (const k of store.keys()) {
      if (k.startsWith(prefix)) store.delete(k);
    }
  },

  /**
   * Check whether a key currently has a live (non-expired) entry.
   */
  has(key: string): boolean {
    const entry = store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) { store.delete(key); return false; }
    return true;
  },

  /**
   * Flush the entire store (use in tests or on logout).
   */
  flush(): void {
    store.clear();
  },
};

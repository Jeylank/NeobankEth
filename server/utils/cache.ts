/**
 * server/utils/cache.ts
 * ─────────────────────
 * Lightweight, type-safe in-memory TTL cache for the Admin API server.
 *
 * Designed for:
 *   - system_config (30 s TTL)
 *   - provider health (15 s TTL)
 *   - any ephemeral server-side read that avoids hot Firestore paths
 *
 * NOT suitable for distributed caches — restart clears all entries.
 *
 * Usage:
 *   cache.set('system_config', data, 30_000);
 *   const cfg = cache.get<SystemConfig>('system_config');
 *   cache.invalidate('system_config');
 */

interface CacheEntry<T> {
  value:     T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

let hits   = 0;
let misses = 0;

export const cache = {
  /**
   * Retrieve a cached value. Returns undefined on miss or expiry.
   */
  get<T>(key: string): T | undefined {
    const entry = store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      misses++;
      console.debug(`[Cache] MISS  key="${key}"`);
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      misses++;
      console.debug(`[Cache] EXPIRED key="${key}"`);
      return undefined;
    }
    hits++;
    console.debug(`[Cache] HIT   key="${key}"`);
    return entry.value;
  },

  /**
   * Store a value with a TTL in milliseconds.
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
    console.debug(`[Cache] SET   key="${key}" ttl=${ttlMs}ms`);
  },

  /**
   * Immediately evict a single key.
   */
  invalidate(key: string): void {
    store.delete(key);
    console.debug(`[Cache] INVALIDATE key="${key}"`);
  },

  /**
   * Evict all keys whose names start with a given prefix.
   */
  invalidatePrefix(prefix: string): void {
    let count = 0;
    for (const k of store.keys()) {
      if (k.startsWith(prefix)) { store.delete(k); count++; }
    }
    console.debug(`[Cache] INVALIDATE_PREFIX prefix="${prefix}" removed=${count}`);
  },

  /**
   * Diagnostic counts (useful for monitoring / tests).
   */
  stats(): { size: number; hits: number; misses: number } {
    return { size: store.size, hits, misses };
  },

  /**
   * Flush the entire store (use in tests / emergency).
   */
  flush(): void {
    store.clear();
    hits = 0;
    misses = 0;
    console.debug('[Cache] FLUSHED');
  },
};

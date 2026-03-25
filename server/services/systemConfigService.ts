/**
 * server/services/systemConfigService.ts
 * ─────────────────────────────────────────
 * Global system configuration and emergency kill switch layer.
 *
 * This operates at a HIGHER level than the per-feature kill switches in
 * server/services/riskControls/killSwitchService.ts. While the kill-switch
 * service controls individual features (remittance_enabled, fx_marketplace_enabled,
 * etc.), this service controls the ENTIRE platform:
 *
 *   systemEnabled=false  → reject ALL financial operations, no exceptions
 *   payoutEnabled=false  → block all payout disbursements
 *   fxMarketplaceEnabled=false → block FX quote selection
 *   walletEnabled=false  → block wallet top-ups
 *   maintenanceMode=true → return 503 maintenance responses
 *
 * Firestore path: system_config/global
 *
 * Safety guarantee:
 *   If Firestore is unreachable, the system falls back to SAFE_MODE_CONFIG
 *   (everything disabled). Unsafe execution is never permitted.
 *
 * Caching:
 *   Config is cached in-process for CACHE_TTL_MS (30 s) to avoid
 *   hammering Firestore on every request. Call invalidateCache() after
 *   an admin update to force an immediate re-read.
 */

import { adminDb } from '../firebaseAdmin';
import { cache }   from '../utils/cache';
import {
  SystemConfig,
  SystemConfigUpdateRequest,
  SYSTEM_CONFIG_DEFAULTS,
  SAFE_MODE_CONFIG,
} from '../types/systemConfig';

const DOC_PATH    = 'system_config/global';
const CACHE_KEY   = 'system_config:global';
const CACHE_TTL   = 30_000; // 30 seconds

export { SystemConfig, SystemConfigUpdateRequest } from '../types/systemConfig';

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function fetchFromFirestore(): Promise<SystemConfig> {
  const snap = await adminDb.doc(DOC_PATH).get();
  if (!snap.exists) {
    // Document has never been created — platform is fully operational (defaults).
    const defaultCfg: SystemConfig = {
      ...SYSTEM_CONFIG_DEFAULTS,
      updatedAt: new Date().toISOString(),
      updatedBy: 'system_defaults',
      reason:    null,
    };
    console.info('[SystemConfig] No document found — using defaults (all enabled)');
    return defaultCfg;
  }
  return snap.data() as SystemConfig;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const systemConfigService = {
  /**
   * Returns the current system configuration.
   *
   * Reads from the in-process cache first (30 s TTL).
   * Falls back to SAFE_MODE_CONFIG if Firestore is unreachable.
   */
  async getConfig(): Promise<SystemConfig> {
    const cached = cache.get<SystemConfig>(CACHE_KEY);
    if (cached) return cached;

    try {
      const cfg = await fetchFromFirestore();
      cache.set(CACHE_KEY, cfg, CACHE_TTL);
      return cfg;
    } catch (err: any) {
      console.error('[SystemConfig] Firestore read failed — engaging SAFE MODE:', err.message);
      // Do NOT cache the safe-mode fallback so the next request retries Firestore.
      return { ...SAFE_MODE_CONFIG, updatedAt: new Date().toISOString() };
    }
  },

  /**
   * Partially updates the system configuration.
   *
   * Only the keys present in `updates` are changed.
   * Always invalidates the in-process cache after writing.
   */
  async updateConfig(
    updates:    SystemConfigUpdateRequest,
    adminId:    string,
    adminEmail: string,
  ): Promise<SystemConfig> {
    const current = await systemConfigService.getConfig();
    const merged: SystemConfig = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
      updatedBy: adminId,
      reason:    updates.reason ?? current.reason ?? null,
    };

    await adminDb.doc(DOC_PATH).set(merged, { merge: false });

    // Immediately populate the cache with the freshly written value.
    cache.set(CACHE_KEY, merged, CACHE_TTL);

    const changes = Object.entries(updates)
      .filter(([k]) => k !== 'reason')
      .reduce<Record<string, unknown>>((acc, [k, v]) => { acc[k] = v; return acc; }, {});

    console.info(
      `[SystemConfig] Updated by ${adminEmail} (${adminId}): ${JSON.stringify(changes)}` +
      (updates.reason ? ` reason="${updates.reason}"` : ''),
    );

    return merged;
  },

  /** Force-evict the cache so the next getConfig() hits Firestore. */
  invalidateCache(): void {
    cache.invalidate(CACHE_KEY);
    console.info('[SystemConfig] Cache invalidated');
  },

  // ─── Convenience Booleans ─────────────────────────────────────────────────

  /** Returns false when the entire platform is disabled or Firestore is down. */
  async isSystemEnabled(): Promise<boolean> {
    const cfg = await systemConfigService.getConfig();
    if (!cfg.systemEnabled) {
      console.warn('[SystemConfig] SYSTEM_DISABLED — all operations blocked');
    }
    return cfg.systemEnabled;
  },

  /** Returns false when payouts have been administratively disabled. */
  async isPayoutEnabled(): Promise<boolean> {
    const cfg = await systemConfigService.getConfig();
    return cfg.systemEnabled && cfg.payoutEnabled;
  },

  /** Returns false when FX quote selection has been disabled. */
  async isFxEnabled(): Promise<boolean> {
    const cfg = await systemConfigService.getConfig();
    return cfg.systemEnabled && cfg.fxMarketplaceEnabled;
  },

  /** Returns false when wallet operations have been disabled. */
  async isWalletEnabled(): Promise<boolean> {
    const cfg = await systemConfigService.getConfig();
    return cfg.systemEnabled && cfg.walletEnabled;
  },

  /** Returns true when the platform is in scheduled maintenance. */
  async isMaintenanceMode(): Promise<boolean> {
    const cfg = await systemConfigService.getConfig();
    return cfg.maintenanceMode;
  },
};

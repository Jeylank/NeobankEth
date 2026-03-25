/**
 * server/types/systemConfig.ts
 * ─────────────────────────────
 * TypeScript types for the global system configuration document.
 *
 * Firestore path: system_config/global
 */

export interface SystemConfig {
  systemEnabled:       boolean;
  payoutEnabled:       boolean;
  fxMarketplaceEnabled: boolean;
  walletEnabled:       boolean;
  maintenanceMode:     boolean;
  updatedAt:           string;
  updatedBy:           string;
  reason:              string | null;
}

export interface SystemConfigUpdateRequest {
  systemEnabled?:        boolean;
  payoutEnabled?:        boolean;
  fxMarketplaceEnabled?: boolean;
  walletEnabled?:        boolean;
  maintenanceMode?:      boolean;
  reason?:               string;
}

export const SYSTEM_CONFIG_DEFAULTS: Omit<SystemConfig, 'updatedAt' | 'updatedBy' | 'reason'> = {
  systemEnabled:        true,
  payoutEnabled:        true,
  fxMarketplaceEnabled: true,
  walletEnabled:        true,
  maintenanceMode:      false,
};

export const SAFE_MODE_CONFIG: SystemConfig = {
  systemEnabled:        false,
  payoutEnabled:        false,
  fxMarketplaceEnabled: false,
  walletEnabled:        false,
  maintenanceMode:      true,
  updatedAt:            new Date().toISOString(),
  updatedBy:            'system_fallback',
  reason:               'Firestore read failure — safe mode engaged',
};

/**
 * server/services/riskControls/killSwitchService.ts
 * ───────────────────────────────────────────────────
 * Global kill switches for critical platform operations.
 *
 * Firestore collection: system_controls
 * Document schema:
 *   { key, enabled, updatedAt, updatedBy, reason }
 *
 * Usage:
 *   await killSwitchService.isEnabled('remittance_enabled');   // → bool
 *   await killSwitchService.checkEnabled('remittance_enabled'); // throws FeatureDisabledError if off
 */

import { adminDb } from '../../firebaseAdmin';
import { writeAuditLog } from '../../middleware/auditLog';
import { FeatureDisabledError } from './errors';
import { FieldValue } from 'firebase-admin/firestore';

const COL = 'system_controls';

export type ControlKey =
  | 'remittance_enabled'
  | 'wallet_topup_enabled'
  | 'recurring_support_enabled'
  | 'campaign_payout_enabled'
  | 'fx_marketplace_enabled'
  | 'referral_rewards_enabled';

export const ALL_CONTROL_KEYS: ControlKey[] = [
  'remittance_enabled',
  'wallet_topup_enabled',
  'recurring_support_enabled',
  'campaign_payout_enabled',
  'fx_marketplace_enabled',
  'referral_rewards_enabled',
];

export interface SystemControl {
  key:       ControlKey;
  enabled:   boolean;
  updatedAt: string;
  updatedBy: string;
  reason:    string | null;
}

export const killSwitchService = {
  /**
   * Returns true if the feature is enabled (or if the document doesn't exist
   * yet — default is permissive to avoid blocking new deployments).
   */
  async isEnabled(key: ControlKey): Promise<boolean> {
    try {
      const snap = await adminDb.collection(COL).doc(key).get();
      if (!snap.exists) return true;
      return snap.data()?.enabled !== false;
    } catch (err: any) {
      console.error('[KillSwitch] isEnabled error:', err.message);
      return true; // fail open — never block due to Firestore read failure
    }
  },

  /**
   * Throws FeatureDisabledError if the kill switch is off.
   */
  async checkEnabled(key: ControlKey): Promise<void> {
    const enabled = await killSwitchService.isEnabled(key);
    if (!enabled) {
      const snap = await adminDb.collection(COL).doc(key).get();
      const reason = snap.data()?.reason ?? undefined;
      throw new FeatureDisabledError(key, reason);
    }
  },

  /**
   * Enable or disable a feature.
   */
  async setControl(
    key:       ControlKey,
    enabled:   boolean,
    adminUid:  string,
    adminEmail: string,
    reason?:   string,
  ): Promise<SystemControl> {
    const now = new Date().toISOString();
    const data: SystemControl = {
      key,
      enabled,
      updatedAt: now,
      updatedBy: adminUid,
      reason: reason ?? null,
    };

    await adminDb.collection(COL).doc(key).set(data, { merge: true });

    await writeAuditLog({
      adminId:    adminUid,
      adminEmail,
      action:     'kill_switch_changed',
      entityId:   key,
      entityType: 'system_control',
      payload:    { key, enabled, reason: reason ?? null },
      ip:         '',
    });

    return data;
  },

  /**
   * Returns all control keys with their current state.
   * Missing documents are returned as enabled=true (default).
   */
  async getAllControls(): Promise<SystemControl[]> {
    const snap = await adminDb.collection(COL).get();
    const existing = new Map<string, SystemControl>();
    snap.docs.forEach((d) => existing.set(d.id, d.data() as SystemControl));

    return ALL_CONTROL_KEYS.map((key) => existing.get(key) ?? {
      key,
      enabled:   true,
      updatedAt: new Date().toISOString(),
      updatedBy: 'system',
      reason:    null,
    });
  },
};

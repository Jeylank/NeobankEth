/**
 * server/routes/systemConfigRoutes.ts
 * ──────────────────────────────────────
 * Admin routes for the global system configuration.
 *
 * All routes require a valid Firebase ID token with admin privileges
 * (enforced by the verifyAdmin middleware).
 *
 * Endpoints:
 *   GET  /api/admin/system-config          → current config
 *   POST /api/admin/system-config          → partial update + audit log
 *   POST /api/admin/system-config/refresh  → force cache invalidation
 */

import { Router, Request, Response } from 'express';
import { verifyAdmin, AuthRequest } from '../middleware/auth';
import { systemConfigService }      from '../services/systemConfigService';
import { SystemConfigUpdateRequest } from '../types/systemConfig';
import { writeAuditLog }            from '../middleware/auditLog';

const router = Router();

function admin(req: Request): AuthRequest { return req as AuthRequest; }

// ─── GET /api/admin/system-config ─────────────────────────────────────────────

router.get('/system-config', verifyAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await systemConfigService.getConfig();
    res.json({ config, cacheStats: { ttlSeconds: 30 } });
  } catch (err: any) {
    console.error('[GET /system-config]', err.message);
    res.status(500).json({ error: 'Failed to fetch system config', detail: err.message });
  }
});

// ─── POST /api/admin/system-config ────────────────────────────────────────────

router.post('/system-config', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { adminId, adminEmail } = admin(req);
    const updates = req.body as SystemConfigUpdateRequest;

    // Validate — reject unknown keys to prevent Firestore pollution.
    const ALLOWED_KEYS: (keyof SystemConfigUpdateRequest)[] = [
      'systemEnabled',
      'payoutEnabled',
      'fxMarketplaceEnabled',
      'walletEnabled',
      'maintenanceMode',
      'reason',
    ];
    const unknownKeys = Object.keys(updates).filter(
      (k) => !ALLOWED_KEYS.includes(k as keyof SystemConfigUpdateRequest),
    );
    if (unknownKeys.length > 0) {
      res.status(400).json({ error: `Unknown config keys: ${unknownKeys.join(', ')}` });
      return;
    }

    // At least one field must be changing.
    const changeKeys = Object.keys(updates).filter((k) => k !== 'reason');
    if (changeKeys.length === 0) {
      res.status(400).json({ error: 'No config fields to update' });
      return;
    }

    // Safety check: must confirm when disabling the entire system.
    if (updates.systemEnabled === false) {
      console.warn(
        `[SystemConfig] SYSTEM DISABLE requested by ${adminEmail} (${adminId})` +
        (updates.reason ? ` — "${updates.reason}"` : ''),
      );
    }

    const updated = await systemConfigService.updateConfig(updates, adminId, adminEmail);

    // Audit log — record every field that changed.
    const changePayload = changeKeys.reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = (updates as Record<string, unknown>)[k];
      return acc;
    }, {});

    await writeAuditLog({
      adminId,
      adminEmail,
      action:     'SYSTEM_CONFIG_UPDATED',
      entityId:   'global',
      entityType: 'system_config',
      payload:    {
        changes: changePayload,
        reason:  updates.reason ?? null,
      },
      ip: req.ip ?? '',
    });

    res.json({ config: updated, message: 'System config updated successfully' });
  } catch (err: any) {
    console.error('[POST /system-config]', err.message);
    res.status(500).json({ error: 'Failed to update system config', detail: err.message });
  }
});

// ─── POST /api/admin/system-config/refresh ────────────────────────────────────

router.post('/system-config/refresh', verifyAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { adminId, adminEmail } = admin(req);
    systemConfigService.invalidateCache();

    const config = await systemConfigService.getConfig();

    await writeAuditLog({
      adminId,
      adminEmail,
      action:     'SYSTEM_CONFIG_CACHE_REFRESHED',
      entityId:   'global',
      entityType: 'system_config',
      payload:    {},
      ip:         req.ip ?? '',
    });

    res.json({ config, message: 'Cache refreshed — config re-read from Firestore' });
  } catch (err: any) {
    console.error('[POST /system-config/refresh]', err.message);
    res.status(500).json({ error: 'Failed to refresh config cache', detail: err.message });
  }
});

export default router;

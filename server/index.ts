/**
 * server/index.ts
 * ───────────────
 * Sumsuma Admin Operations API
 *
 * Express server exposing admin-only endpoints for:
 *   Payout monitoring, Fraud alerts, Support tickets,
 *   Dispute management, Liquidity monitoring, Reconciliation.
 *
 * All routes require a valid Firebase ID token with admin role.
 *
 * Start:  npx ts-node --project server/tsconfig.json server/index.ts
 *         OR: npm run server:admin
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { runMigrations } from 'stripe-replit-sync';

import payoutsRouter        from './routes/payouts';
import fraudAlertsRouter    from './routes/fraudAlerts';
import supportTicketsRouter from './routes/supportTickets';
import disputesRouter       from './routes/disputes';
import liquidityRouter      from './routes/liquidity';
import reconciliationRouter from './routes/reconciliation';
import riskControlsRouter   from './routes/adminRiskControls';
import systemConfigRouter   from './routes/systemConfigRoutes';
import paymentsRouter       from './routes/payments';
import simulationRouter    from './routes/simulation';
import campaignsRouter     from './routes/campaigns';
import adminUsersRouter    from './routes/adminUsers';
import notificationsRouter from './routes/notifications';
import agentPayoutRouter   from './routes/agentPayout';
import dashboardRouter     from './routes/dashboard';
import remittancesRouter   from './routes/remittances';
import userApiRouter       from './routes/userApi';
import { systemConfigService } from './services/systemConfigService';
import { getStripeSync }    from './stripeClient';
import { stripePaymentService } from './services/stripePaymentService';

const app  = express();
const PORT = parseInt(process.env.ADMIN_API_PORT ?? '5000', 10);

// ─── Stripe webhook — MUST be registered before express.json() ───────────────
// Stripe sends raw JSON bodies that must NOT be pre-parsed; express.raw()
// captures them as Buffer so we can verify the Stripe-Signature.

app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      res.status(400).json({ error: 'MISSING_SIGNATURE' });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;
    try {
      await stripePaymentService.handleWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err: any) {
      console.error('[StripeWebhook]', err.message);
      const isSignatureError = err.message?.includes('signature');
      res.status(isSignatureError ? 400 : 500).json({ error: err.message });
    }
  },
);

// ─── Global Middleware ────────────────────────────────────────────────────────

app.use(cors({
  origin : process.env.ALLOWED_ORIGIN ?? '*',
  methods : ['GET', 'POST', 'PUT', 'PATCH'],
  allowedHeaders: ['Authorization', 'Content-Type'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Global Maintenance Mode Gate ─────────────────────────────────────────────
// Health check, Stripe webhook, and publishable-key are always bypassed.
const MAINTENANCE_BYPASS = [
  '/health',
  '/api/payments/webhook',
  '/api/payments/publishable-key',
];
app.use(async (req: Request, res: Response, next: NextFunction) => {
  // Non-API paths (static files / SPA) are never gated by maintenance mode.
  // Specific API paths (webhook, publishable-key) are also explicitly bypassed.
  // DISABLE_MAINTENANCE_MODE=true skips the check entirely (dev / testing).
  if (
    process.env.DISABLE_MAINTENANCE_MODE === 'true' ||
    !req.path.startsWith('/api/') ||
    MAINTENANCE_BYPASS.some((p) => req.path.startsWith(p))
  ) {
    return next();
  }
  try {
    const inMaintenance = await systemConfigService.isMaintenanceMode();
    if (inMaintenance) {
      console.warn(`[MaintenanceMode] Request blocked: ${req.method} ${req.path}`);
      res.status(503).json({
        error:   'MAINTENANCE_MODE',
        message: 'The platform is currently undergoing scheduled maintenance. Please try again later.',
      });
      return;
    }
  } catch {
    // If we cannot reach Firestore to check maintenance status, allow the
    // request through — the individual route guards will apply their own checks.
  }
  next();
});

// ─── Health Check (public) ────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'sumsuma-admin-api', timestamp: new Date().toISOString() });
});

// ─── Admin API Routes ─────────────────────────────────────────────────────────

const API_PREFIX = '/api/admin';

app.use(API_PREFIX, payoutsRouter);
app.use(API_PREFIX, fraudAlertsRouter);
app.use(API_PREFIX, supportTicketsRouter);
app.use(API_PREFIX, disputesRouter);
app.use(API_PREFIX, liquidityRouter);
app.use(API_PREFIX, reconciliationRouter);
app.use(API_PREFIX, riskControlsRouter);
app.use(API_PREFIX, systemConfigRouter);
app.use(API_PREFIX, adminUsersRouter);
app.use('/api',              paymentsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/v1',           simulationRouter);
app.use('/api/v1',           agentPayoutRouter);
app.use(API_PREFIX,          dashboardRouter);
app.use('/api/campaigns',    campaignsRouter);
app.use('/api',              remittancesRouter);
app.use('/api',              userApiRouter);

// ─── Expo Web App — static files ─────────────────────────────────────────────
// Serve the built Expo web bundle from /dist.  API routes are already mounted
// above so they take priority; anything else falls through to the SPA.
const DIST_DIR = path.join(__dirname, '..', 'dist');
app.use(express.static(DIST_DIR));

// ─── API status page (moved from /) ───────────────────────────────────────────
app.get('/api-docs', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sumsuma Admin API</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f8;color:#1a1a2e;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px}
    .card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:680px;width:100%;padding:40px}
    .logo{display:flex;align-items:center;gap:12px;margin-bottom:32px}
    .dot{width:36px;height:36px;border-radius:10px;background:#006633;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:18px}
    h1{font-size:22px;font-weight:700;color:#006633}
    .subtitle{font-size:13px;color:#888;margin-top:2px}
    .badge{display:inline-flex;align-items:center;gap:6px;background:#e8f5e9;color:#006633;font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;margin-bottom:28px}
    .pulse{width:8px;height:8px;border-radius:50%;background:#006633;animation:pulse 1.5s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
    .section{margin-bottom:24px}
    .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#aaa;margin-bottom:10px}
    .route{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px}
    .route:last-child{border-bottom:none}
    .method{font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;min-width:38px;text-align:center}
    .get{background:#e3f2fd;color:#1565c0}
    .post{background:#fce4ec;color:#b71c1c}
    .patch{background:#fff3e0;color:#e65100}
    .path{font-family:'SF Mono',Monaco,monospace;color:#333;flex:1}
    .footer{margin-top:28px;font-size:12px;color:#bbb;text-align:center}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="dot">S</div>
      <div>
        <h1>Sumsuma Admin API</h1>
        <div class="subtitle">Non-custodial mobile banking · Ethiopian diaspora</div>
      </div>
    </div>
    <div class="badge"><span class="pulse"></span> Server running · Port ${PORT}</div>

    <div class="section">
      <div class="section-title">Admin</div>
      <div class="route"><span class="method get">GET</span><span class="path">/api/admin/dashboard/transfers</span></div>
      <div class="route"><span class="method get">GET</span><span class="path">/api/admin/dashboard/agents</span></div>
      <div class="route"><span class="method get">GET</span><span class="path">/api/admin/dashboard/alerts</span></div>
      <div class="route"><span class="method get">GET</span><span class="path">/api/admin/payouts</span></div>
      <div class="route"><span class="method get">GET</span><span class="path">/api/admin/liquidity</span></div>
      <div class="route"><span class="method get">GET</span><span class="path">/api/admin/risk-summary</span></div>
    </div>

    <div class="section">
      <div class="section-title">Simulation (v1)</div>
      <div class="route"><span class="method get">GET</span><span class="path">/api/v1/health</span></div>
      <div class="route"><span class="method post">POST</span><span class="path">/api/v1/wallet/topup</span></div>
      <div class="route"><span class="method post">POST</span><span class="path">/api/v1/remittance/initiate</span></div>
      <div class="route"><span class="method post">POST</span><span class="path">/api/v1/fx/quote</span></div>
      <div class="route"><span class="method get">GET</span><span class="path">/api/v1/liquidity</span></div>
      <div class="route"><span class="method post">POST</span><span class="path">/api/v1/simulation/reset</span></div>
      <div class="route"><span class="method post">POST</span><span class="path">/api/v1/simulation/seed</span></div>
    </div>

    <div class="section">
      <div class="section-title">Fraud &amp; Risk</div>
      <div class="route"><span class="method get">GET</span><span class="path">/api/v1/fraud/decisions</span></div>
      <div class="route"><span class="method get">GET</span><span class="path">/api/v1/fraud/stats</span></div>
      <div class="route"><span class="method get">GET</span><span class="path">/api/v1/risk/config</span></div>
      <div class="route"><span class="method patch">PATCH</span><span class="path">/api/v1/risk/config</span></div>
    </div>

    <div class="section">
      <div class="section-title">Payments &amp; Subscriptions</div>
      <div class="route"><span class="method get">GET</span><span class="path">/api/payments/publishable-key</span></div>
      <div class="route"><span class="method post">POST</span><span class="path">/api/payments/create-intent</span></div>
      <div class="route"><span class="method post">POST</span><span class="path">/api/payments/webhook</span></div>
      <div class="route"><span class="method get">GET</span><span class="path">/api/payments/subscription</span></div>
      <div class="route"><span class="method post">POST</span><span class="path">/api/payments/setup-intent</span></div>
      <div class="route"><span class="method post">POST</span><span class="path">/api/payments/subscribe</span></div>
      <div class="route"><span class="method post">POST</span><span class="path">/api/payments/unsubscribe</span></div>
    </div>

    <div class="footer">Sumsuma · Admin API · ${new Date().getFullYear()}</div>
  </div>
</body>
</html>`);
});

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
// For any non-API route not matched above, serve the Expo web index.html so
// that React Navigation deep-links and refreshes work correctly.
app.use((req: Request, res: Response) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/health')) {
    res.status(404).json({ error: 'Endpoint not found' });
    return;
  }
  const indexPath = path.join(DIST_DIR, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      // dist not yet built — show a helpful message
      res.status(503).send(
        '<h2>App not built yet.</h2><p>The server is running but the Expo web bundle has not been compiled. The workflow will rebuild it on next start.</p>'
      );
    }
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[UnhandledError]', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Process Stability ────────────────────────────────────────────────────────
// Catch unhandled errors so they are logged but don't silently crash the server.

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// ─── Stripe Initialisation ────────────────────────────────────────────────────
// Runs the stripe-replit-sync schema migration and registers the managed webhook.
// The syncBackfill is intentionally NOT called on startup — it opens a persistent
// pg connection pool whose idle-timeout teardown can drain the Node event loop
// and crash the server process. Payments work correctly without the backfill.

async function initStripe(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn('[Stripe] DATABASE_URL not set — skipping stripe-replit-sync setup.');
    return;
  }
  try {
    await runMigrations({ databaseUrl });
    console.log('[Stripe] Schema ready.');

    const stripeSync = await getStripeSync();

    const webhookBaseUrl = `https://${(process.env.REPLIT_DOMAINS ?? '').split(',')[0]}`;
    await stripeSync.findOrCreateManagedWebhook(`${webhookBaseUrl}/api/payments/webhook`);
    console.log('[Stripe] Managed webhook configured.');
  } catch (err: any) {
    console.error('[Stripe] Initialisation error (non-fatal):', err.message);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

initStripe().then(() => {
  /* no-op — init is fire-and-forget, server already listening */
}).catch(() => { /* already logged */ });

// Keep the Node.js event loop alive even if all pg pool connections become idle.
// Without this, certain pg Pool implementations unref() their sockets, which
// allows the process to exit despite the HTTP server still listening.
const _keepAlive = setInterval(() => {}, 1000 * 60 * 60);
_keepAlive.unref === undefined || void 0; // never unref this timer

app.listen(PORT, () => {
  console.log(`✓ Sumsuma Admin API running on port ${PORT}`);
  console.log(`  Health:  http://localhost:${PORT}/health`);
  console.log('  Routes:');
  console.log(`    GET  ${API_PREFIX}/payouts`);
  console.log(`    GET  ${API_PREFIX}/fraud-alerts`);
  console.log(`    POST ${API_PREFIX}/fraud-action`);
  console.log(`    GET  ${API_PREFIX}/support-tickets`);
  console.log(`    POST ${API_PREFIX}/support-action`);
  console.log(`    GET  ${API_PREFIX}/disputes`);
  console.log(`    POST ${API_PREFIX}/dispute-action`);
  console.log(`    GET  ${API_PREFIX}/liquidity`);
  console.log(`    GET  ${API_PREFIX}/reconciliation`);
  console.log(`    GET  ${API_PREFIX}/reconciliation/runs`);
  console.log(`    GET  ${API_PREFIX}/reconciliation/run/:runId`);
  console.log(`    GET  ${API_PREFIX}/reconciliation/alerts`);
  console.log(`    POST ${API_PREFIX}/reconciliation/run`);
  console.log(`    POST ${API_PREFIX}/reconciliation/alert-action`);
  console.log('  Risk Controls:');
  console.log(`    GET  ${API_PREFIX}/system-controls`);
  console.log(`    POST ${API_PREFIX}/system-controls/:key`);
  console.log(`    GET  ${API_PREFIX}/risk-limits`);
  console.log(`    POST ${API_PREFIX}/risk-limits/:key`);
  console.log(`    GET  ${API_PREFIX}/risk-flags`);
  console.log(`    GET  ${API_PREFIX}/risk-flags/:userId`);
  console.log(`    POST ${API_PREFIX}/risk-flags/:userId/freeze`);
  console.log(`    POST ${API_PREFIX}/risk-flags/:userId/unfreeze`);
  console.log(`    POST ${API_PREFIX}/risk-flags/:userId/review`);
  console.log(`    POST ${API_PREFIX}/risk-flags/:userId/active`);
  console.log(`    GET  ${API_PREFIX}/risk-summary`);
  console.log(`    GET  ${API_PREFIX}/risk-blocked-metrics`);
  console.log('  Dashboard:');
  console.log(`    GET  ${API_PREFIX}/dashboard/transfers  (stuck txns, state summary, recent failures)`);
  console.log(`    GET  ${API_PREFIX}/dashboard/agents     (roster, city stats, low-float warnings)`);
  console.log(`    GET  ${API_PREFIX}/dashboard/alerts     (all actionable alerts, severity-sorted)`);
  console.log('  System Config:');
  console.log(`    GET  ${API_PREFIX}/system-config`);
  console.log(`    POST ${API_PREFIX}/system-config`);
  console.log(`    POST ${API_PREFIX}/system-config/refresh`);
  console.log('  User Management:');
  console.log(`    POST ${API_PREFIX}/users/bootstrap  (ADMIN_BOOTSTRAP_SECRET — first admin only)`);
  console.log(`    POST ${API_PREFIX}/users/promote    (requires existing admin)`);
  console.log(`    POST ${API_PREFIX}/users/demote     (requires existing admin)`);
  console.log(`    GET  ${API_PREFIX}/users/:uid/claims`);
  console.log('  Payments (Stripe):');
  console.log(`    GET  /api/payments/publishable-key`);
  console.log(`    POST /api/payments/create-intent`);
  console.log(`    POST /api/payments/webhook`);
  console.log('  Simulation API (v1):');
  console.log(`    GET  /api/v1/health`);
  console.log(`    POST /api/v1/fx/quote                (lock quote, 90s TTL + 30s buffer)`);
  console.log(`    GET  /api/v1/fx/quotes`);
  console.log(`    POST /api/v1/wallet/topup`);
  console.log(`    GET  /api/v1/wallet/:userId`);
  console.log(`    POST /api/v1/remittance/initiate     (Idempotency-Key header | user-balance | liquidity | circuit-breaker)`);
  console.log(`    GET  /api/v1/remittance/:txId`);
  console.log(`    POST /api/v1/campaign/contribute     (AML compliance metadata required)`);
  console.log(`    POST /api/v1/recurring/process       (scheduleId-based idempotency)`);
  console.log(`    GET  /api/v1/liquidity               (auto-replenish enabled)`);
  console.log(`    GET  /api/v1/circuit-breaker/status`);
  console.log(`    POST /api/v1/circuit-breaker/trip/:provider  (stripe|chapa|telebirr)`);
  console.log(`    POST /api/v1/circuit-breaker/reset           (restore all to CLOSED)`);
  console.log(`    POST /api/v1/simulation/reset                (full state wipe; pass { seed: true } to pre-fund wallets)`);
  console.log(`    POST /api/v1/simulation/seed                 (pre-fund test wallets — idempotent)`);
  console.log(`    POST /api/v1/simulation/drain                (drain all provider pools → PENDING_LIQUIDITY test setup)`);
  console.log('  RESTful Campaign API:');
  console.log(`    POST /api/campaigns/:campaignId/contribute   (RESTful alias, campaignId in URL)`);

  const simBase = `https://${(process.env.REPLIT_DOMAINS ?? 'localhost:5000').split(',')[0]}`;
  console.log(`  Sim base URL: ${simBase}/api/v1  (X-API-Key required if SIMULATION_API_KEY is set)`);
});

export default app;

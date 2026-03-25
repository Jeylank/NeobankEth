/**
 * server/index.ts
 * ───────────────
 * Habeshare Admin Operations API
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

import payoutsRouter        from './routes/payouts';
import fraudAlertsRouter    from './routes/fraudAlerts';
import supportTicketsRouter from './routes/supportTickets';
import disputesRouter       from './routes/disputes';
import liquidityRouter      from './routes/liquidity';
import reconciliationRouter from './routes/reconciliation';
import riskControlsRouter   from './routes/adminRiskControls';

const app  = express();
const PORT = parseInt(process.env.ADMIN_API_PORT ?? '4000', 10);

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

// ─── Health Check (public) ────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'habeshare-admin-api', timestamp: new Date().toISOString() });
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

// ─── 404 Handler ──────────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[UnhandledError]', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✓ Habeshare Admin API running on port ${PORT}`);
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
  console.log(`    GET  ${API_PREFIX}/risk-summary`);
});

export default app;

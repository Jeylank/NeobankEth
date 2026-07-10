import express from 'express';
import request from 'supertest';

const searchTransfers = jest.fn();
const getTransferDetail = jest.fn();
const retryTransferReconciliation = jest.fn();
const moveTransferToRecovery = jest.fn();
const initiatePermittedRefund = jest.fn();
const searchUsers = jest.fn();
const getUserDetail = jest.fn();
const getBetaRiskDashboard = jest.fn();
const queryAuditLogs = jest.fn();

jest.mock('../middleware/auth', () => ({
  verifyAdmin: (req: any, res: any, next: any) => req.headers.authorization === 'Bearer admin'
    ? next()
    : res.status(req.headers.authorization ? 403 : 401).json({ error: 'UNAUTHORIZED' }),
}));
jest.mock('../middleware/apiKeyAuth', () => ({
  requireApiKey: (req: any, res: any, next: any) => req.headers['x-api-key'] === 'qa-key'
    ? next()
    : res.status(401).json({ error: 'INVALID_API_KEY' }),
}));
jest.mock('../middleware/rateLimiter', () => ({ readLimiter: (_r: any, _s: any, n: any) => n(), writeLimiter: (_r: any, _s: any, n: any) => n() }));
jest.mock('../services/adminTransfersService', () => ({
  searchTransfers, getTransferDetail, retryTransferReconciliation, moveTransferToRecovery, initiatePermittedRefund,
  TransferRetryError: class TransferRetryError extends Error { constructor(message: string, public status = 409) { super(message); } },
}));
jest.mock('../services/adminUsersService', () => ({ searchUsers, getUserDetail }));
jest.mock('../services/betaRiskSummaryService', () => ({ getBetaRiskSummary: getBetaRiskDashboard }));
jest.mock('../services/dashboardService', () => ({
  getTransfersDashboard: jest.fn(), getAgentsDashboard: jest.fn(), getAlertsDashboard: jest.fn(), getDashboardSummary: jest.fn(),
  AGENT_RESPONSE_TIMEOUT_MS: 1, OTP_FLOW_TIMEOUT_MS: 1, STUCK_UNASSIGNED_THRESHOLD_MS: 1, LOW_FLOAT_THRESHOLD_ETB: 1,
}));
jest.mock('../services/betaRiskService', () => ({ getBetaRiskSummary: jest.fn() }));
jest.mock('../services/auditLogService', () => ({
  queryAuditLogs,
  AUDIT_EVENT_TYPES: ['LOGIN', 'SEND_MONEY', 'AGENT_ASSIGNED', 'OTP_GENERATED', 'PAYOUT_COMPLETED', 'KYC_CHANGE', 'ADMIN_ACTION'],
}));
jest.mock('../firebaseAdmin', () => ({ adminAuth: {}, adminDb: {} }));
jest.mock('../middleware/auditLog', () => ({ writeAuditLog: jest.fn() }));

import transfersRouter from '../routes/adminTransfers';
import usersRouter from '../routes/adminUsers';
import dashboardRouter from '../routes/dashboard';
import auditRouter from '../routes/auditLogs';

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin', transfersRouter, usersRouter, dashboardRouter, auditRouter);
  return instance;
}

describe('new admin route registration and authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    '/api/admin/transfers', '/api/admin/users', '/api/admin/audit-logs', '/api/admin/dashboard/beta-risk-summary',
  ])('registers %s and rejects missing auth without a 404/500', async (path) => {
    const response = await request(app()).get(path);
    expect(response.status).toBe(401);
  });

  it('serves the beta-risk aggregate to an admin', async () => {
    getBetaRiskDashboard.mockResolvedValueOnce({ users: { totalBetaUsers: 4, activeToday: 2 }, health: { status: 'degraded' }, alerts: { recent: [] } });
    const response = await request(app()).get('/api/admin/dashboard/beta-risk-summary').set('Authorization', 'Bearer admin');
    expect(response.status).toBe(200);
    expect(response.body.users).toEqual({ totalBetaUsers: 4, activeToday: 2 });
  });

  it('passes transfer list search parameters to the service', async () => {
    searchTransfers.mockResolvedValueOnce({ results: [], totalScanned: 0 });
    const response = await request(app()).get('/api/admin/transfers?txId=tx-1&q=sender&status=FAILED&limit=25').set('Authorization', 'Bearer admin');
    expect(response.status).toBe(200);
    expect(searchTransfers).toHaveBeenCalledWith({ txId: 'tx-1', query: 'sender', status: 'FAILED', limit: 25 });
  });

  it('returns transfer detail and preserves retry idempotency results', async () => {
    getTransferDetail.mockResolvedValueOnce({ txId: 'tx-1', timeline: [], ledgerEntries: [], otp: { value: undefined } });
    retryTransferReconciliation.mockResolvedValue({ action: 'already_retried', idempotent: true });
    const detail = await request(app()).get('/api/admin/transfers/tx-1').set('Authorization', 'Bearer admin');
    const first = await request(app()).post('/api/admin/transfers/tx-1/retry').set('Authorization', 'Bearer admin');
    const duplicate = await request(app()).post('/api/admin/transfers/tx-1/retry').set('Authorization', 'Bearer admin');
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toMatch(/otp[^}]*value[^}]*\d{4,}/i);
    expect(first.body.idempotent).toBe(true);
    expect(duplicate.body).toEqual(first.body);
  });

  it('supports intentionally configured QA API-key reads', async () => {
    searchUsers.mockResolvedValueOnce({ results: [] });
    const response = await request(app()).get('/api/admin/users').set('X-API-Key', 'qa-key');
    expect(response.status).toBe(200);
  });

  it('rejects API keys for recovery/refund writes and accepts Firebase admins', async () => {
    moveTransferToRecovery.mockResolvedValueOnce({ action: 'recovery', status: 'RECOVERY_PENDING', duplicate: false });
    initiatePermittedRefund.mockResolvedValueOnce({ action: 'refund', status: 'REFUNDED', duplicate: false });
    expect((await request(app()).post('/api/admin/transfers/tx-1/recovery').set('X-API-Key', 'qa-key')).status).toBe(401);
    expect((await request(app()).post('/api/admin/transfers/tx-1/refund').set('X-API-Key', 'qa-key')).status).toBe(401);
    expect((await request(app()).post('/api/admin/transfers/tx-1/retry').set('X-API-Key', 'qa-key')).status).toBe(401);
    expect((await request(app()).post('/api/admin/transfers/tx-1/recovery').set('Authorization', 'Bearer admin')).status).toBe(200);
    expect((await request(app()).post('/api/admin/transfers/tx-1/refund').set('Authorization', 'Bearer admin')).status).toBe(200);
  });

  it.each([
    '/api/admin/transfers?limit=0',
    '/api/admin/transfers?limit=201',
    '/api/admin/transfers?status=MADE_UP',
    '/api/admin/transfers/bad%20id',
    '/api/admin/users?limit=0',
    '/api/admin/audit-logs?limit=501',
    '/api/admin/audit-logs?startDate=2026-02-02&endDate=2026-01-01',
  ])('validates unsafe admin input on %s', async (path) => {
    const response = await request(app()).get(path).set('Authorization', 'Bearer admin');
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/^INVALID_/);
  });

  it('keeps audit logs read-only and supports filters', async () => {
    queryAuditLogs.mockResolvedValueOnce({ events: [], count: 0 });
    const response = await request(app()).get('/api/admin/audit-logs?type=LOGIN,OTP_GENERATED&userId=u1&startDate=2026-01-01&endDate=2026-02-01&limit=20').set('Authorization', 'Bearer admin');
    expect(response.status).toBe(200);
    expect(queryAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ types: ['LOGIN', 'OTP_GENERATED'], userId: 'u1', limit: 20 }));
    expect((await request(app()).post('/api/admin/audit-logs').set('Authorization', 'Bearer admin')).status).toBe(404);
  });
});

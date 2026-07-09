import express from 'express';
import request from 'supertest';

process.env.SIMULATION_API_KEY = 'test-api-key';

jest.mock('../middleware/rateLimiter', () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { readLimiter: pass, writeLimiter: pass, destructiveLimiter: pass };
});

const mockGetAgent = jest.fn();
const mockListAssignmentsForAgent = jest.fn();

jest.mock('../services/agentPayoutService', () => {
  class AgentPayoutError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly httpStatus: number,
    ) {
      super(message);
    }
  }
  return {
    AgentPayoutError,
    createAgent: jest.fn(),
    listAgents: jest.fn(),
    getAgent: (...args: unknown[]) => mockGetAgent(...args),
    assignBestAgent: jest.fn(),
    respondToAssignment: jest.fn(),
    checkAndReassignStaleAssignment: jest.fn(),
    scanStaleAssignments: jest.fn(),
    sendOtp: jest.fn(),
    verifyOtp: jest.fn(),
    markPaid: jest.fn(),
    getTimeline: jest.fn(),
    listAssignmentsForAgent: (...args: unknown[]) => mockListAssignmentsForAgent(...args),
    AGENT_RESPONSE_TIMEOUT_MS: 300_000,
    MAX_ASSIGNMENT_ATTEMPTS: 3,
    MAX_OTP_ATTEMPTS: 3,
  };
});

import agentPayoutRouter from '../routes/agentPayout';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', agentPayoutRouter);
  return app;
}

describe('GET /api/v1/agents/:id/assignments', () => {
  beforeEach(() => {
    mockGetAgent.mockReset();
    mockListAssignmentsForAgent.mockReset();
  });

  it('rejects requests missing a valid X-API-Key', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/v1/agents/agent-1/assignments');
    expect(res.status).toBe(401);
  });

  it('returns 404 when the agent does not exist', async () => {
    mockGetAgent.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/agents/missing-agent/assignments')
      .set('X-API-Key', 'test-api-key');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('AGENT_NOT_FOUND');
  });

  it('returns the agent summary and its assignments enriched with transfer status', async () => {
    mockGetAgent.mockResolvedValue({
      id: 'agent-1',
      full_name: 'Abebe Kebede',
      city: 'Addis Ababa',
      status: 'online',
      available_float: 10_000,
      score: 100,
    });
    mockListAssignmentsForAgent.mockResolvedValue([
      {
        assignment_id: 'assign-1',
        transfer_id: 'tx-1',
        assignment_status: 'assigned',
        transfer_status: 'OTP_SENT',
        amount: 500,
        currency: 'ETB',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:05:00.000Z',
      },
    ]);

    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/agents/agent-1/assignments')
      .set('X-API-Key', 'test-api-key');

    expect(res.status).toBe(200);
    expect(res.body.agent).toMatchObject({ id: 'agent-1', full_name: 'Abebe Kebede', city: 'Addis Ababa' });
    expect(res.body.count).toBe(1);
    expect(res.body.assignments[0]).toMatchObject({
      transfer_id: 'tx-1',
      transfer_status: 'OTP_SENT',
      amount: 500,
    });
    expect(mockListAssignmentsForAgent).toHaveBeenCalledWith('agent-1');
  });

  it('returns 500 with INTERNAL_ERROR when the service throws unexpectedly', async () => {
    mockGetAgent.mockResolvedValue({ id: 'agent-1', full_name: 'Agent', city: 'Addis Ababa' });
    mockListAssignmentsForAgent.mockRejectedValue(new Error('boom'));

    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/agents/agent-1/assignments')
      .set('X-API-Key', 'test-api-key');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('INTERNAL_ERROR');
  });
});

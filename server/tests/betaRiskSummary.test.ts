const listUsers = jest.fn();
const collection = jest.fn();
const getAgentsDashboard = jest.fn();
const getAlertsDashboard = jest.fn();

jest.mock('../firebaseAdmin', () => ({
  adminAuth: { listUsers },
  adminDb: { collection },
}));
jest.mock('../services/agentPayoutService', () => ({ AGENT_COL: { txns: 'sim_transactions' } }));
jest.mock('../services/fraudEngine', () => ({ FRAUD_COL: { decisions: 'fraud_decisions' } }));
jest.mock('../services/dashboardService', () => ({
  getAgentsDashboard,
  getAlertsDashboard,
  LOW_FLOAT_THRESHOLD_ETB: 500,
}));

import { getBetaRiskSummary } from '../services/betaRiskSummaryService';

describe('Beta Risk Summary partial-source resilience', () => {
  it('returns a complete degraded response when independent sources fail', async () => {
    listUsers.mockRejectedValueOnce(new Error('auth unavailable'));
    getAgentsDashboard.mockRejectedValueOnce(new Error('agents unavailable'));
    getAlertsDashboard.mockRejectedValueOnce(new Error('alerts unavailable'));
    collection.mockImplementation(() => {
      const query: any = {
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        get: jest.fn().mockRejectedValue(new Error('firestore unavailable')),
      };
      return query;
    });

    const result = await getBetaRiskSummary();

    expect(result.users).toEqual({ totalBetaUsers: 0, activeToday: 0 });
    expect(result.kyc.pending).toBe(0);
    expect(result.fraud).toEqual({ pendingReview: 0, blockedLast24h: 0 });
    expect(result.transfers).toEqual({ blocked: 0, failed: 0 });
    expect(result.reconciliation).toEqual({ queueLength: 0, mismatched: 0, lastRunAt: null });
    expect(result.liquidity).toEqual({ lowFloatAgents: 0, offlineAgents: 0, thresholdETB: 500 });
    expect(result.health.firestore).toBe('unreachable');
    expect(result.alerts).toEqual({
      recent: [], total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    });
  });
});

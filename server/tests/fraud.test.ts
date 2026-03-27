/**
 * server/tests/fraud.test.ts
 * ───────────────────────────
 * Unit tests for server/services/fraudEngine.ts
 *
 * All Firestore calls are mocked — no real Firebase connection required.
 *
 * Key behavioral rules:
 *   - NEW_DEVICE / GEO_MISMATCH only fire when the user HAS an established
 *     history but the current device/IP is NOT in that list (deviation model).
 *     If the user has no history at all, these rules return 0.
 *   - checkVelocitySpike uses snap.docs.filter() — mocks must include { docs: [] }.
 *   - checkNewRecipient uses snap.docs.some(d => d.data().recipientId === …)
 *     — mocks must include objects with a data() method.
 *   - checkAmountAnomaly: filters docs by status in-memory, then maps amount.
 *
 * Run: npx jest server/tests/fraud.test.ts
 */

// ── Firebase Admin mock ───────────────────────────────────────────────────────

const mockAdd  = jest.fn().mockResolvedValue({ id: 'mock_decision_id' });
const mockGet  = jest.fn();
const mockSet  = jest.fn().mockResolvedValue(undefined);

const docMock  = () => ({ get: mockGet, set: mockSet });
const colMock  = () => ({
  doc: jest.fn(docMock),
  add: mockAdd,
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: mockGet,
});

jest.mock('firebase-admin', () => ({
  firestore: {
    Timestamp: {
      now:        jest.fn(() => ({ seconds: 0, nanoseconds: 0 })),
      fromMillis: jest.fn((ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 })),
    },
    FieldValue: { arrayUnion: jest.fn((...args: unknown[]) => args) },
  },
}));

jest.mock('../firebaseAdmin', () => ({
  adminDb: { collection: jest.fn(colMock) },
}));

// ── Module under test ─────────────────────────────────────────────────────────

import {
  evaluateFraud,
  FRAUD_SCORES,
  SCORE_BLOCK,
  SCORE_REVIEW,
  type FraudContext,
} from '../services/fraudEngine';

// ─── Shared mock factories ────────────────────────────────────────────────────

/** Returns a QuerySnapshot mock with no documents (skips all downstream logic). */
const EMPTY_SNAP = { empty: true, size: 0, docs: [] };

/** Returns a DocumentSnapshot mock representing a missing document. */
const NO_DOC = { exists: false };

/** A mock transaction document that was COMPLETED recently. */
const recentCompletedTx = (amount: number, recipientId = 'recip_test') => ({
  data: () => ({
    amount,
    status:    'COMPLETED',
    recipientId,
    createdAt: { toMillis: () => Date.now() - 1_000 }, // 1 second ago
  }),
});

/** A mock transaction document in PROCESSING state, created very recently. */
const recentActiveTx = (recipientId = 'recip_test') => ({
  data: () => ({
    amount:    100,
    status:    'PROCESSING',
    recipientId,
    createdAt: { toMillis: () => Date.now() - 2_000 }, // 2 seconds ago
  }),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal valid FraudContext. Defaults to a clean/safe profile. */
function ctx(overrides: Partial<FraudContext> = {}): FraudContext {
  return {
    userId:      'user_test',
    recipientId: 'recip_test',
    amount:      100,
    currency:    'USD',
    type:        'standard',
    ...overrides,
  };
}

// ─── Suite 1: BLOCK — high-risk input, wallet must not be touched ─────────────
//
// Rules triggered:
//   NEW_RECIPIENT (+15): no matching tx found in history
//   AMOUNT_ANOMALY (+25): avg = 10, sending 5000 (> 2.5×)
//   VELOCITY_SPIKE (+30): 4 active transactions in the last 10 min
//   Total: 70 → BLOCK
//
// ctx has no deviceId or ipAddress → NEW_DEVICE and GEO_MISMATCH are skipped.

describe('fraud — BLOCK decision (score ≥ 60)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdd.mockResolvedValue({ id: 'decision_block_001' });

    mockGet
      // checkNewRecipient: single userId query — no prior txs with this recipient
      .mockResolvedValueOnce(EMPTY_SNAP)
      // checkAmountAnomaly: userId query returns 3 low-amount completed txs
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          recentCompletedTx(10),
          recentCompletedTx(10),
          recentCompletedTx(10),
        ],
      })
      // checkVelocitySpike: 4 active txs in the last 10 min (> threshold of 3)
      .mockResolvedValueOnce({
        docs: [recentActiveTx(), recentActiveTx(), recentActiveTx(), recentActiveTx()],
      })
      // checkFailedLoginBurst: no login attempts doc
      .mockResolvedValueOnce(NO_DOC)
      // checkGeoMismatch: no ipAddress in ctx → rule short-circuits (no get() call)
      ;
  });

  it('returns BLOCK when score ≥ 60', async () => {
    const result = await evaluateFraud(ctx({ amount: 5_000 }));
    expect(result.decision).toBe('BLOCK');
    expect(result.score).toBeGreaterThanOrEqual(SCORE_BLOCK);
  });

  it('persists a fraud_decisions document', async () => {
    await evaluateFraud(ctx({ amount: 5_000 }));
    expect(mockAdd).toHaveBeenCalledTimes(1);
    const persisted = mockAdd.mock.calls[0][0];
    expect(persisted.decision).toBe('BLOCK');
    expect(persisted.userId).toBe('user_test');
    expect(typeof persisted.score).toBe('number');
    expect(Array.isArray(persisted.rulesTriggered)).toBe(true);
  });

  it('includes decisionId in the returned result', async () => {
    const result = await evaluateFraud(ctx({ amount: 5_000 }));
    expect(result.decisionId).toBe('decision_block_001');
  });

  it('includes the triggered rule names', async () => {
    const result = await evaluateFraud(ctx({ amount: 5_000 }));
    expect(result.rulesTriggered).toContain('VELOCITY_SPIKE');
    expect(result.rulesTriggered).toContain('AMOUNT_ANOMALY');
    expect(result.rulesTriggered).toContain('NEW_RECIPIENT');
  });
});

// ─── Suite 2: REVIEW — medium risk, no wallet debit ──────────────────────────
//
// Rules triggered:
//   NEW_DEVICE (+20): user HAS known devices [device_known], but requesting device_new_abc
//   NEW_RECIPIENT (+15): empty history
//   Total: 35 → REVIEW
//
// ctx has deviceId='device_new_abc', no ipAddress.

describe('fraud — REVIEW decision (30 ≤ score < 60)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdd.mockResolvedValue({ id: 'decision_review_001' });

    mockGet
      // checkNewDevice: user has an established device list, but device_new_abc is not in it
      .mockResolvedValueOnce({ exists: true, data: () => ({ deviceIds: ['device_known'] }) })
      // checkNewRecipient: no prior txs → recipient is new → +15
      .mockResolvedValueOnce(EMPTY_SNAP)
      // checkAmountAnomaly: no history → skip → 0
      .mockResolvedValueOnce(EMPTY_SNAP)
      // checkVelocitySpike: 0 active txs → 0
      .mockResolvedValueOnce({ docs: [] })
      // checkFailedLoginBurst: no doc → 0
      .mockResolvedValueOnce(NO_DOC)
      // checkGeoMismatch: no ipAddress → skips (no get() call)
      ;
  });

  it('returns REVIEW when 30 ≤ score < 60', async () => {
    const result = await evaluateFraud(ctx({ deviceId: 'device_new_abc', amount: 50 }));
    expect(result.decision).toBe('REVIEW');
    expect(result.score).toBeGreaterThanOrEqual(SCORE_REVIEW);
    expect(result.score).toBeLessThan(SCORE_BLOCK);
  });

  it('still persists a fraud_decisions document', async () => {
    await evaluateFraud(ctx({ deviceId: 'device_new_abc', amount: 50 }));
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0].decision).toBe('REVIEW');
  });

  it('returns NEW_DEVICE and NEW_RECIPIENT in rulesTriggered', async () => {
    const result = await evaluateFraud(ctx({ deviceId: 'device_new_abc', amount: 50 }));
    expect(result.rulesTriggered).toContain('NEW_DEVICE');
    expect(result.rulesTriggered).toContain('NEW_RECIPIENT');
    expect(result.rulesTriggered).not.toContain('VELOCITY_SPIKE');
  });
});

// ─── Suite 3: ALLOW — established, clean profile ──────────────────────────────
//
// Rules triggered: none (score = 0 → ALLOW)
//
// ctx has trusted deviceId and known ipAddress, known recipient, normal amount.

describe('fraud — ALLOW decision (score < 30)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdd.mockResolvedValue({ id: 'decision_allow_001' });

    mockGet
      // checkNewDevice: user has ['device_trusted'], request uses 'device_trusted' → 0
      .mockResolvedValueOnce({ exists: true, data: () => ({ deviceIds: ['device_trusted'] }) })
      // checkNewRecipient: userId query returns a tx with recipientId='recip_test' → seen → 0
      .mockResolvedValueOnce({
        empty: false,
        docs: [recentCompletedTx(200)], // recipientId defaults to 'recip_test'
      })
      // checkAmountAnomaly: avg=200, sending 150 (< 2.5×200=500) → 0
      .mockResolvedValueOnce({
        empty: false,
        docs: [recentCompletedTx(200), recentCompletedTx(200)],
      })
      // checkVelocitySpike: 1 tx in window → 0
      .mockResolvedValueOnce({ docs: [recentActiveTx()] })
      // checkFailedLoginBurst: empty failedAt → 0
      .mockResolvedValueOnce({ exists: true, data: () => ({ failedAt: [] }) })
      // checkGeoMismatch: user has ['1.2.3.4'], request uses '1.2.3.4' → 0
      .mockResolvedValueOnce({ exists: true, data: () => ({ ipAddresses: ['1.2.3.4'] }) })
      ;
  });

  it('returns ALLOW for a clean profile', async () => {
    const result = await evaluateFraud(ctx({
      deviceId: 'device_trusted',
      ipAddress: '1.2.3.4',
      amount: 150,
    }));
    expect(result.decision).toBe('ALLOW');
    expect(result.score).toBeLessThan(SCORE_REVIEW);
  });

  it('triggers no rules', async () => {
    const result = await evaluateFraud(ctx({
      deviceId: 'device_trusted',
      ipAddress: '1.2.3.4',
      amount: 150,
    }));
    expect(result.rulesTriggered).toHaveLength(0);
  });

  it('still persists a fraud_decisions document for audit', async () => {
    await evaluateFraud(ctx({
      deviceId: 'device_trusted',
      ipAddress: '1.2.3.4',
      amount: 150,
    }));
    expect(mockAdd).toHaveBeenCalledTimes(1);
    const persisted = mockAdd.mock.calls[0][0];
    expect(persisted.decision).toBe('ALLOW');
    expect(persisted.score).toBe(0);
  });
});

// ─── Suite 4: Individual rule score constants ─────────────────────────────────

describe('fraud — individual rule score constants', () => {
  it('FRAUD_SCORES values match the spec', () => {
    expect(FRAUD_SCORES.NEW_DEVICE).toBe(20);
    expect(FRAUD_SCORES.NEW_RECIPIENT).toBe(15);
    expect(FRAUD_SCORES.AMOUNT_ANOMALY).toBe(25);
    expect(FRAUD_SCORES.VELOCITY_SPIKE).toBe(30);
    expect(FRAUD_SCORES.FAILED_LOGIN_BURST).toBe(20);
    expect(FRAUD_SCORES.GEO_MISMATCH).toBe(25);
  });

  it('SCORE_BLOCK is 60, SCORE_REVIEW is 30', () => {
    expect(SCORE_BLOCK).toBe(60);
    expect(SCORE_REVIEW).toBe(30);
  });

  it('VELOCITY_SPIKE alone (30) triggers REVIEW, not BLOCK', () => {
    expect(FRAUD_SCORES.VELOCITY_SPIKE).toBeGreaterThanOrEqual(SCORE_REVIEW);
    expect(FRAUD_SCORES.VELOCITY_SPIKE).toBeLessThan(SCORE_BLOCK);
  });

  it('VELOCITY_SPIKE + AMOUNT_ANOMALY (55) triggers REVIEW, not BLOCK', () => {
    const combined = FRAUD_SCORES.VELOCITY_SPIKE + FRAUD_SCORES.AMOUNT_ANOMALY;
    expect(combined).toBeGreaterThanOrEqual(SCORE_REVIEW);
    expect(combined).toBeLessThan(SCORE_BLOCK);
  });

  it('VELOCITY_SPIKE + AMOUNT_ANOMALY + NEW_RECIPIENT (70) triggers BLOCK', () => {
    const combined = FRAUD_SCORES.VELOCITY_SPIKE + FRAUD_SCORES.AMOUNT_ANOMALY + FRAUD_SCORES.NEW_RECIPIENT;
    expect(combined).toBeGreaterThanOrEqual(SCORE_BLOCK);
  });
});

// ─── Suite 5: GEO_MISMATCH / FAILED_LOGIN_BURST / deviation model edge cases ──

describe('fraud — GEO_MISMATCH and FAILED_LOGIN_BURST rules', () => {
  beforeEach(() => { jest.clearAllMocks(); mockAdd.mockResolvedValue({ id: 'x' }); });

  it('GEO_MISMATCH fires (+25) when IP deviates from established history', async () => {
    // ctx has no deviceId → checkNewDevice short-circuits.
    // Mock sequence starts at checkNewRecipient.
    mockGet
      .mockResolvedValueOnce(EMPTY_SNAP)   // checkNewRecipient: no prior txs → +15
      .mockResolvedValueOnce(EMPTY_SNAP)   // checkAmountAnomaly: no history → 0
      .mockResolvedValueOnce({ docs: [] }) // checkVelocitySpike: 0 → 0
      .mockResolvedValueOnce(NO_DOC)       // checkFailedLoginBurst: no doc → 0
      .mockResolvedValueOnce({             // checkGeoMismatch: user HAS known IPs, ours is new → +25
        exists: true,
        data: () => ({ ipAddresses: ['10.0.0.1'] }),
      });

    const result = await evaluateFraud(ctx({ ipAddress: '192.168.1.99' }));
    expect(result.rulesTriggered).toContain('GEO_MISMATCH');
    expect(result.rulesTriggered).toContain('NEW_RECIPIENT');
    // 15 + 25 = 40 → REVIEW
    expect(result.decision).toBe('REVIEW');
  });

  it('GEO_MISMATCH does NOT fire for a user with no established IP history', async () => {
    // ctx has no deviceId → checkNewDevice short-circuits.
    mockGet
      .mockResolvedValueOnce(EMPTY_SNAP)   // checkNewRecipient: → +15
      .mockResolvedValueOnce(EMPTY_SNAP)   // checkAmountAnomaly: 0
      .mockResolvedValueOnce({ docs: [] }) // checkVelocitySpike: 0
      .mockResolvedValueOnce(NO_DOC)       // checkFailedLoginBurst: 0
      .mockResolvedValueOnce(NO_DOC);      // checkGeoMismatch: no IP doc → 0 (deviation model)

    const result = await evaluateFraud(ctx({ ipAddress: '1.2.3.4' }));
    expect(result.rulesTriggered).not.toContain('GEO_MISMATCH');
    // score = 15 (NEW_RECIPIENT only) → ALLOW
    expect(result.decision).toBe('ALLOW');
  });

  it('NEW_DEVICE does NOT fire for a user with no established device history', async () => {
    // ctx HAS deviceId, but user has no device doc.
    mockGet
      .mockResolvedValueOnce(NO_DOC)       // checkNewDevice: no doc → 0 (deviation model)
      .mockResolvedValueOnce(EMPTY_SNAP)   // checkNewRecipient: → +15
      .mockResolvedValueOnce(EMPTY_SNAP)   // checkAmountAnomaly: 0
      .mockResolvedValueOnce({ docs: [] }) // checkVelocitySpike: 0
      .mockResolvedValueOnce(NO_DOC);      // checkFailedLoginBurst: 0
    // no ipAddress → GEO_MISMATCH skips

    const result = await evaluateFraud(ctx({ deviceId: 'brand_new_device' }));
    expect(result.rulesTriggered).not.toContain('NEW_DEVICE');
    // score = 15 (NEW_RECIPIENT only) → ALLOW
    expect(result.decision).toBe('ALLOW');
  });

  it('FAILED_LOGIN_BURST fires (+20) when >3 failures in window', async () => {
    // ctx has no deviceId or ipAddress → both skip without get().
    const recentTs = [Date.now() - 1000, Date.now() - 2000, Date.now() - 3000, Date.now() - 4000];
    mockGet
      .mockResolvedValueOnce(EMPTY_SNAP)   // checkNewRecipient: → +15
      .mockResolvedValueOnce(EMPTY_SNAP)   // checkAmountAnomaly: 0
      .mockResolvedValueOnce({ docs: [] }) // checkVelocitySpike: 0
      .mockResolvedValueOnce({             // checkFailedLoginBurst: 4 recent failures → +20
        exists: true,
        data: () => ({ failedAt: recentTs }),
      });
    // checkGeoMismatch: no ipAddress → skips

    const result = await evaluateFraud(ctx());
    expect(result.rulesTriggered).toContain('FAILED_LOGIN_BURST');
    expect(result.rulesTriggered).toContain('NEW_RECIPIENT');
    // 15 + 20 = 35 → REVIEW
    expect(result.decision).toBe('REVIEW');
  });

  it('GEO_MISMATCH skipped entirely when no ipAddress provided', async () => {
    // ctx has no deviceId or ipAddress → both signal rules skip without get().
    mockGet
      .mockResolvedValueOnce({             // checkNewRecipient: known recipient → 0
        empty: false,
        docs: [recentCompletedTx(100)],    // recipientId='recip_test' matches ctx
      })
      .mockResolvedValueOnce({             // checkAmountAnomaly: avg=100, sending 100 (no anomaly)
        empty: false,
        docs: [recentCompletedTx(100), recentCompletedTx(100)],
      })
      .mockResolvedValueOnce({ docs: [] }) // checkVelocitySpike: 0
      .mockResolvedValueOnce(NO_DOC);      // checkFailedLoginBurst: 0
    // checkGeoMismatch: no ipAddress → returns 0 without get()

    const result = await evaluateFraud(ctx());
    expect(result.rulesTriggered).not.toContain('GEO_MISMATCH');
    expect(result.decision).toBe('ALLOW');
  });
});

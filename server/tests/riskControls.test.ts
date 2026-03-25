/**
 * server/tests/riskControls.test.ts
 * ───────────────────────────────────
 * Unit tests for the client-side Risk Controls layer.
 *
 * All Firestore / Firebase SDK calls are mocked via jest.config.js moduleNameMapper:
 *   - 'firebase/firestore'  → __mocks__/firestore.ts  (jest.fn() stubs)
 *   - '../firebase'         → __mocks__/firebase.ts   (re-exports firestore.ts)
 *
 * Both clientRiskService AND this test file therefore share the same jest.fn() instances.
 *
 * Scenarios covered:
 *   1. Frozen user is blocked by checkUserRiskState
 *   2. Kill switch blocks the remittance feature
 *   3. Single-transaction limit exceeded
 *   4. Review-required flag blocks payout
 *   5. Velocity limit exceeded after multiple rapid transfers
 *   6. Convenience wrappers enforce the correct kill switch per feature
 *
 * Run: npm run test:risk
 */

import {
  clientRiskService,
  FeatureDisabledError,
  LimitExceededError,
  VelocityLimitExceededError,
  ReviewRequiredError,
  UserFrozenError,
} from '../../src/services/riskControls/clientRiskService';

// getDoc / getDocs come from 'firebase/firestore' which the moduleNameMapper
// routes to __mocks__/firestore.ts — same jest.fn() instances used by clientRiskService.
import { getDoc, getDocs } from 'firebase/firestore';

const mockGetDoc  = getDoc  as jest.Mock;
const mockGetDocs = getDocs as jest.Mock;

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupDocExists(data: Record<string, unknown>) {
  mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => data });
}
function setupDocMissing() {
  mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => ({}) });
}
function setupDocsResult(docs: Array<Record<string, unknown>>) {
  mockGetDocs.mockResolvedValueOnce({ docs: docs.map(d => ({ data: () => d })), size: docs.length });
}
function countDocs(n: number) {
  mockGetDocs.mockResolvedValueOnce({ size: n, docs: Array(n).fill({ data: () => ({}) }) });
}

// Shorthand helpers for common states
const killSwitchOn  = () => setupDocExists({ enabled: true });
const killSwitchOff = () => setupDocExists({ enabled: false });
const userClean     = () => setupDocExists({ isFrozen: false, isBlocked: false, reviewRequired: false, reason: null });
const userFrozen    = (reason = 'AML hold') => setupDocExists({ isFrozen: true,  isBlocked: false, reviewRequired: false, reason });
const userBlocked   = (reason = 'Admin')    => setupDocExists({ isFrozen: false, isBlocked: true,  reviewRequired: false, reason });
const userInReview  = (reason = 'Pattern')  => setupDocExists({ isFrozen: false, isBlocked: false, reviewRequired: true,  reason });
const limitDoc      = (value: number)       => setupDocExists({ value, enabled: true });
const limitMissing  = () => setupDocMissing();
const limitOff      = () => setupDocExists({ value: 1, enabled: false });
const sumDocs       = (amounts: number[], currency = 'USD') =>
  setupDocsResult(amounts.map(amount => ({ amount, fromCurrency: currency })));

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // resetAllMocks clears queued mockResolvedValueOnce values between tests.
  // clearAllMocks does NOT do this, which causes mock bleed-over between tests.
  jest.resetAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Risk Controls Layer — clientRiskService', () => {

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario 1: Frozen user is blocked
  // ══════════════════════════════════════════════════════════════════════════
  describe('Scenario 1: Frozen user is blocked', () => {

    it('throws UserFrozenError when isFrozen=true', async () => {
      userFrozen('Compliance hold');
      await expect(clientRiskService.checkUserRiskState('frozen-user-123')).rejects.toThrow(UserFrozenError);
    });

    it('UserFrozenError has code=USER_FROZEN and correct userId detail', async () => {
      userFrozen();
      let caught: any;
      try { await clientRiskService.checkUserRiskState('frozen-user-abc'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(UserFrozenError);
      expect(caught.code).toBe('USER_FROZEN');
      expect(caught.details.userId).toBe('frozen-user-abc');
    });

    it('throws UserFrozenError when isBlocked=true', async () => {
      userBlocked('Admin block');
      await expect(clientRiskService.checkUserRiskState('blocked-user-999')).rejects.toThrow(UserFrozenError);
    });

    it('resolves for a clean user', async () => {
      userClean();
      await expect(clientRiskService.checkUserRiskState('normal-user')).resolves.toBeUndefined();
    });

    it('fails open on Firestore error (does NOT throw)', async () => {
      mockGetDoc.mockRejectedValueOnce(new Error('Firestore unavailable'));
      await expect(clientRiskService.checkUserRiskState('any-user')).resolves.toBeUndefined();
    });

    it('runRemittanceChecks blocks frozen user at the user-state step', async () => {
      killSwitchOn();
      userFrozen();
      await expect(clientRiskService.runRemittanceChecks('frozen-user', 100, 'USD')).rejects.toThrow(UserFrozenError);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario 2: Kill switch blocks all transactions
  // ══════════════════════════════════════════════════════════════════════════
  describe('Scenario 2: Kill switch blocks transactions', () => {

    it('throws FeatureDisabledError when enabled=false', async () => {
      killSwitchOff();
      await expect(clientRiskService.checkKillSwitch('remittance_enabled')).rejects.toThrow(FeatureDisabledError);
    });

    it('FeatureDisabledError has code=FEATURE_DISABLED and correct feature', async () => {
      killSwitchOff();
      let caught: any;
      try { await clientRiskService.checkKillSwitch('fx_marketplace_enabled'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(FeatureDisabledError);
      expect(caught.code).toBe('FEATURE_DISABLED');
      expect(caught.details.feature).toBe('fx_marketplace_enabled');
    });

    it('fails open when document does not exist', async () => {
      setupDocMissing();
      await expect(clientRiskService.checkKillSwitch('remittance_enabled')).resolves.toBeUndefined();
    });

    it('fails open on Firestore error', async () => {
      mockGetDoc.mockRejectedValueOnce(new Error('Network error'));
      await expect(clientRiskService.checkKillSwitch('remittance_enabled')).resolves.toBeUndefined();
    });

    it('each of the 6 kill switch keys can individually block their feature', async () => {
      const features: Array<Parameters<typeof clientRiskService.checkKillSwitch>[0]> = [
        'remittance_enabled', 'wallet_topup_enabled', 'recurring_support_enabled',
        'campaign_payout_enabled', 'fx_marketplace_enabled', 'referral_rewards_enabled',
      ];
      for (const feature of features) {
        killSwitchOff();
        await expect(clientRiskService.checkKillSwitch(feature)).rejects.toThrow(FeatureDisabledError);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario 3: Limit exceeded
  // ══════════════════════════════════════════════════════════════════════════
  describe('Scenario 3: Limit exceeded', () => {

    it('throws LimitExceededError when amount > single limit', async () => {
      limitDoc(500);
      await expect(clientRiskService.checkRemittanceLimits('user-001', 1000, 'USD')).rejects.toThrow(LimitExceededError);
    });

    it('LimitExceededError has code=LIMIT_EXCEEDED and correct details', async () => {
      limitDoc(500);
      let caught: any;
      try { await clientRiskService.checkRemittanceLimits('user-001', 750, 'USD'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(LimitExceededError);
      expect(caught.code).toBe('LIMIT_EXCEEDED');
      expect(caught.details.limit).toBe(500);
      expect(caught.details.current).toBe(750);
      expect(caught.details.currency).toBe('USD');
    });

    it('throws when accumulated daily total would exceed limit', async () => {
      limitDoc(2000);        // single: 300 < 2000 ✓
      limitDoc(3000);        // daily cap: 3000
      sumDocs([1400, 1400]); // already sent 2800 today → 2800+300=3100 > 3000 ✗
      await expect(clientRiskService.checkRemittanceLimits('user-001', 300, 'USD')).rejects.toThrow(LimitExceededError);
    });

    it('resolves when amount is within all limits', async () => {
      limitDoc(2000);    // single: 100 ✓
      limitDoc(5000);  sumDocs([200]);  // daily: 300 ✓
      limitDoc(10000); sumDocs([500]);  // weekly: 600 ✓
      limitDoc(25000); sumDocs([1000]); // monthly: 1100 ✓
      await expect(clientRiskService.checkRemittanceLimits('user-001', 100, 'USD')).resolves.toBeUndefined();
    });

    it('skips enforcement when all limit docs are disabled', async () => {
      limitOff(); // single: disabled
      limitOff(); // daily:  disabled
      limitOff(); // weekly: disabled
      limitOff(); // monthly: disabled
      // No getDocs mocks needed — enabled=false skips sumTransactions calls
      await expect(clientRiskService.checkRemittanceLimits('user-001', 50000, 'USD')).resolves.toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario 4: Review required blocks payout
  // ══════════════════════════════════════════════════════════════════════════
  describe('Scenario 4: Review required blocks payout', () => {

    it('throws ReviewRequiredError when reviewRequired=true', async () => {
      userInReview('Large transaction pattern');
      await expect(clientRiskService.checkUserRiskState('review-user-777')).rejects.toThrow(ReviewRequiredError);
    });

    it('ReviewRequiredError has code=REVIEW_REQUIRED and preserves reason', async () => {
      const reason = 'Unusual activity detected';
      userInReview(reason);
      let caught: any;
      try { await clientRiskService.checkUserRiskState('review-user-777'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(ReviewRequiredError);
      expect(caught.code).toBe('REVIEW_REQUIRED');
      expect(caught.details.reason).toBe(reason);
    });

    it('runRemittanceChecks surfaces ReviewRequiredError through full chain', async () => {
      killSwitchOn();
      userInReview('Manual review');
      await expect(clientRiskService.runRemittanceChecks('review-user', 500, 'USD')).rejects.toThrow(ReviewRequiredError);
    });

    it('runCampaignChecks also blocks review-required users', async () => {
      killSwitchOn();
      userInReview('Pattern');
      await expect(clientRiskService.runCampaignChecks('review-user', 50, 'USD')).rejects.toThrow(ReviewRequiredError);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario 5: Velocity limit exceeded (multiple rapid transfers)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Scenario 5: Velocity limit exceeded after rapid transfers', () => {

    it('throws VelocityLimitExceededError when hourly count >= limit', async () => {
      limitDoc(5); countDocs(5);
      await expect(clientRiskService.checkVelocity('power-user')).rejects.toThrow(VelocityLimitExceededError);
    });

    it('VelocityLimitExceededError has code=VELOCITY_LIMIT_EXCEEDED and correct counts', async () => {
      limitDoc(5); countDocs(7);
      let caught: any;
      try { await clientRiskService.checkVelocity('power-user'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(VelocityLimitExceededError);
      expect(caught.code).toBe('VELOCITY_LIMIT_EXCEEDED');
      expect(caught.details.current).toBe(7);
      expect(caught.details.limit).toBe(5);
    });

    it('resolves when count is below limit', async () => {
      limitDoc(5); countDocs(2);
      await expect(clientRiskService.checkVelocity('normal-user')).resolves.toBeUndefined();
    });

    it('fails open on Firestore error', async () => {
      mockGetDoc.mockRejectedValueOnce(new Error('Firestore error'));
      await expect(clientRiskService.checkVelocity('any-user')).resolves.toBeUndefined();
    });

    it('runRemittanceChecks blocks at velocity step after all other checks pass', async () => {
      killSwitchOn();                               // kill switch ✓
      userClean();                                  // user risk clean ✓
      limitDoc(2000);                               // single limit: 100 ✓
      limitDoc(5000);  sumDocs([200]);              // daily: 300 ✓
      limitDoc(10000); sumDocs([500]);              // weekly: 600 ✓
      limitDoc(25000); sumDocs([1000]);             // monthly: 1100 ✓
      limitDoc(5); countDocs(6);                    // velocity: 6 ≥ 5 → BLOCK
      await expect(
        clientRiskService.runRemittanceChecks('power-user', 100, 'USD'),
      ).rejects.toThrow(VelocityLimitExceededError);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario 6: Convenience wrappers enforce the correct kill switch per feature
  // ══════════════════════════════════════════════════════════════════════════
  describe('Scenario 6: Convenience wrappers enforce correct kill switch', () => {

    it('runTopupChecks blocks on wallet_topup_enabled=false', async () => {
      killSwitchOff();
      let caught: any;
      try { await clientRiskService.runTopupChecks('user', 100, 'USD'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(FeatureDisabledError);
      expect(caught.details.feature).toBe('wallet_topup_enabled');
    });

    it('runFxMarketplaceChecks blocks on fx_marketplace_enabled=false', async () => {
      killSwitchOff();
      let caught: any;
      try { await clientRiskService.runFxMarketplaceChecks('user'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(FeatureDisabledError);
      expect(caught.details.feature).toBe('fx_marketplace_enabled');
    });

    it('runCampaignChecks blocks on campaign_payout_enabled=false', async () => {
      killSwitchOff();
      let caught: any;
      try { await clientRiskService.runCampaignChecks('user', 50, 'USD'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(FeatureDisabledError);
      expect(caught.details.feature).toBe('campaign_payout_enabled');
    });

    it('runReferralRewardChecks blocks on referral_rewards_enabled=false', async () => {
      killSwitchOff();
      let caught: any;
      try { await clientRiskService.runReferralRewardChecks('user'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(FeatureDisabledError);
      expect(caught.details.feature).toBe('referral_rewards_enabled');
    });

    it('runRecurringSupportChecks blocks on recurring_support_enabled=false', async () => {
      killSwitchOff();
      let caught: any;
      try { await clientRiskService.runRecurringSupportChecks('user', 200, 'USD'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(FeatureDisabledError);
      expect(caught.details.feature).toBe('recurring_support_enabled');
    });
  });
});

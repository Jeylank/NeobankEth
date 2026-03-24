/**
 * fraudRiskScoringService.ts
 * ───────────────────────────
 * Transaction risk scoring for Habeshare fraud detection.
 *
 * Calculates a risk score (0–100) based on multiple signals:
 *   - Large transaction amount (+30)
 *   - Rapid consecutive transactions within 1 hour (+25)
 *   - Recent failed transaction attempts (+20)
 *   - New user account (< 7 days old) (+25)
 *
 * Decision thresholds:
 *   0–39   → ALLOW            (proceed normally)
 *   40–69  → REVIEW_REQUIRED  (hold for admin review)
 *   70+    → BLOCK            (reject immediately)
 *
 * On REVIEW_REQUIRED or BLOCK:
 *   - Score and factors written to `fraud_risk_scores`
 *   - Fraud alert created in `fraud_alerts` for admin console
 *
 * Usage:
 *   const assessment = await fraudRiskScoringService.scoreTransaction({ ... });
 *   if (assessment.decision === 'BLOCK') throw new FraudBlockError(assessment.score);
 */

import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from './firebase';
import { FraudBlockError } from '../middleware/errorHandler';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskDecision = 'ALLOW' | 'REVIEW_REQUIRED' | 'BLOCK';

export interface RiskFactor {
  name: string;
  triggered: boolean;
  score: number;
  detail: string;
}

export interface RiskAssessment {
  score: number;
  decision: RiskDecision;
  factors: RiskFactor[];
  transactionId: string;
  userId: string;
  assessedAt: string;
}

export interface ScoreTransactionParams {
  transactionId: string;
  userId: string;
  amountEtb: number;
  accountCreatedAt: string;
  currency?: string;
  provider?: string;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

const LARGE_TXN_THRESHOLD_ETB = 50_000;
const RAPID_TXN_COUNT_THRESHOLD = 3;
const RAPID_TXN_WINDOW_MS = 60 * 60 * 1000;   // 1 hour
const FAILED_ATTEMPTS_THRESHOLD = 2;
const FAILED_ATTEMPTS_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const NEW_ACCOUNT_DAYS = 7;

const SCORE_LARGE_TXN = 30;
const SCORE_RAPID_TXN = 25;
const SCORE_FAILED_ATTEMPTS = 20;
const SCORE_NEW_ACCOUNT = 25;

const REVIEW_THRESHOLD = 40;
const BLOCK_THRESHOLD  = 70;

const PAYOUT_COL    = 'payout_transactions';
const RISK_SCORE_COL = 'fraud_risk_scores';
const FRAUD_ALERT_COL = 'fraud_alerts';

function now(): string {
  return new Date().toISOString();
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const fraudRiskScoringService = {
  /**
   * scoreTransaction — evaluate risk and return a full assessment.
   * Writes to Firestore and optionally creates fraud alert.
   */
  async scoreTransaction(params: ScoreTransactionParams): Promise<RiskAssessment> {
    const factors: RiskFactor[] = [];
    let totalScore = 0;

    // ── Factor 1: Large Transaction ──────────────────────────────────────────
    const isLargeTxn = params.amountEtb >= LARGE_TXN_THRESHOLD_ETB;
    const largeScore = isLargeTxn ? SCORE_LARGE_TXN : 0;
    totalScore += largeScore;
    factors.push({
      name: 'LARGE_TRANSACTION',
      triggered: isLargeTxn,
      score: largeScore,
      detail: isLargeTxn
        ? `Amount ${params.amountEtb.toLocaleString()} ETB exceeds ${LARGE_TXN_THRESHOLD_ETB.toLocaleString()} ETB threshold`
        : `Amount within normal range`,
    });

    // ── Factor 2: Rapid Transactions ─────────────────────────────────────────
    let rapidCount = 0;
    try {
      const windowStart = new Date(Date.now() - RAPID_TXN_WINDOW_MS).toISOString();
      const recentSnap = await getDocs(
        query(
          collection(db, PAYOUT_COL),
          where('userId', '==', params.userId),
          where('createdAt', '>=', windowStart),
          orderBy('createdAt', 'desc'),
          limit(20),
        ),
      );
      rapidCount = recentSnap.size;
    } catch {
      rapidCount = 0;
    }

    const isRapid = rapidCount >= RAPID_TXN_COUNT_THRESHOLD;
    const rapidScore = isRapid ? SCORE_RAPID_TXN : 0;
    totalScore += rapidScore;
    factors.push({
      name: 'RAPID_TRANSACTIONS',
      triggered: isRapid,
      score: rapidScore,
      detail: isRapid
        ? `${rapidCount} transactions in the last hour (threshold: ${RAPID_TXN_COUNT_THRESHOLD})`
        : `${rapidCount} recent transactions — within normal rate`,
    });

    // ── Factor 3: Failed Attempts ─────────────────────────────────────────────
    let failedCount = 0;
    try {
      const failWindowStart = new Date(Date.now() - FAILED_ATTEMPTS_WINDOW_MS).toISOString();
      const failedSnap = await getDocs(
        query(
          collection(db, PAYOUT_COL),
          where('userId', '==', params.userId),
          where('status', '==', 'FAILED'),
          where('createdAt', '>=', failWindowStart),
          limit(20),
        ),
      );
      failedCount = failedSnap.size;
    } catch {
      failedCount = 0;
    }

    const hasFailedAttempts = failedCount >= FAILED_ATTEMPTS_THRESHOLD;
    const failedScore = hasFailedAttempts ? SCORE_FAILED_ATTEMPTS : 0;
    totalScore += failedScore;
    factors.push({
      name: 'FAILED_ATTEMPTS',
      triggered: hasFailedAttempts,
      score: failedScore,
      detail: hasFailedAttempts
        ? `${failedCount} failed transactions in last 24h (threshold: ${FAILED_ATTEMPTS_THRESHOLD})`
        : `${failedCount} failed attempts — within normal range`,
    });

    // ── Factor 4: New Account ─────────────────────────────────────────────────
    const accountAgeDays = params.accountCreatedAt
      ? Math.floor((Date.now() - new Date(params.accountCreatedAt).getTime()) / 86_400_000)
      : 999;

    const isNewAccount = accountAgeDays < NEW_ACCOUNT_DAYS;
    const newAccountScore = isNewAccount ? SCORE_NEW_ACCOUNT : 0;
    totalScore += newAccountScore;
    factors.push({
      name: 'NEW_ACCOUNT',
      triggered: isNewAccount,
      score: newAccountScore,
      detail: isNewAccount
        ? `Account is ${accountAgeDays} day(s) old — threshold: ${NEW_ACCOUNT_DAYS} days`
        : `Account is ${accountAgeDays} days old — established account`,
    });

    // ── Decision ──────────────────────────────────────────────────────────────
    const score = Math.min(100, totalScore);
    const decision: RiskDecision =
      score >= BLOCK_THRESHOLD  ? 'BLOCK' :
      score >= REVIEW_THRESHOLD ? 'REVIEW_REQUIRED' :
      'ALLOW';

    const assessment: RiskAssessment = {
      score,
      decision,
      factors,
      transactionId: params.transactionId,
      userId: params.userId,
      assessedAt: now(),
    };

    // ── Persist + Alert ───────────────────────────────────────────────────────
    if (decision !== 'ALLOW') {
      await this._persistAssessment(assessment, params);
    }

    return assessment;
  },

  async _persistAssessment(assessment: RiskAssessment, params: ScoreTransactionParams): Promise<void> {
    try {
      // Write risk score record
      await addDoc(collection(db, RISK_SCORE_COL), {
        ...assessment,
        amountEtb: params.amountEtb,
        currency: params.currency ?? 'ETB',
        provider: params.provider ?? null,
      });

      // Create fraud alert for admin review
      await addDoc(collection(db, FRAUD_ALERT_COL), {
        transactionId: params.transactionId,
        userId: params.userId,
        riskScore: assessment.score,
        decision: assessment.decision,
        status: 'review_required',
        triggeredFactors: assessment.factors.filter(f => f.triggered).map(f => f.name),
        amountEtb: params.amountEtb,
        currency: params.currency ?? 'ETB',
        provider: params.provider ?? null,
        createdAt: now(),
        notes: null,
        reviewedBy: null,
        reviewedAt: null,
      });
    } catch (err: any) {
      console.warn('[FraudRiskScoring] Persist failed (non-fatal):', err.message);
    }
  },

  /**
   * guardTransaction — convenience wrapper.
   * Scores the transaction and throws FraudBlockError if BLOCK decision.
   * Returns the assessment regardless.
   */
  async guardTransaction(params: ScoreTransactionParams): Promise<RiskAssessment> {
    const assessment = await this.scoreTransaction(params);

    if (assessment.decision === 'BLOCK') {
      throw new FraudBlockError(assessment.score);
    }

    return assessment;
  },
};

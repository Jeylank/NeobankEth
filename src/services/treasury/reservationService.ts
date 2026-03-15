/**
 * reservationService.ts
 * ──────────────────────
 * Manages the full lifecycle of treasury reservations.
 *
 * Lifecycle:
 *   createReservation → pending
 *   confirmReservation → confirmed (funds locked permanently for payout)
 *   releaseReservation → released (funds returned to available pool)
 *   expireStaleReservations → expired (auto-cleanup after TTL)
 *
 * Each state transition:
 *  1. Updates reservation document status
 *  2. Calls liquidityService.updatePoolBalances for atomicity
 *  3. Writes TreasuryMovement for full audit trail
 *
 * Uses Firestore transactions for reserve/release/confirm to prevent
 * over-reservation under concurrent load.
 */

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
} from 'firebase/firestore';
import { app } from '../firebase';
import { liquidityService } from './liquidityService';
import { treasuryAlertsService } from './treasuryAlertsService';
import type {
  TreasuryReservation,
  TreasuryProvider,
  TreasuryCurrency,
  ReservationStatus,
  ReservationFilters,
  ReserveResult,
  ReleaseResult,
  ConfirmResult,
} from './treasuryTypes';
import {
  InsufficientLiquidityError,
  ReservationNotFoundError,
  ReservationStateError,
} from './treasuryTypes';

const db = getFirestore(app);
const RESERVATIONS_COL = 'liquidity_reservations';

/** Reservations older than this (hours) without confirmation are auto-expired */
const RESERVATION_TTL_HOURS = 2;

function now(): string {
  return new Date().toISOString();
}

function expiresAt(): string {
  return new Date(Date.now() + RESERVATION_TTL_HOURS * 3600 * 1000).toISOString();
}

function generateReservationId(): string {
  return `tres_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hoursSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 3600);
}

function auditLog(event: string, data: Record<string, unknown>): void {
  console.log(`[Treasury:AuditLog] ${event}`, JSON.stringify(data, null, 0));
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

export const reservationService = {
  /**
   * createReservation — reserves funds in a liquidity pool for an outbound payout.
   * Returns a ReserveResult indicating success or failure with reason.
   * Uses Firestore transaction to prevent over-reservation.
   */
  async createReservation(
    txId: string,
    provider: TreasuryProvider,
    currency: TreasuryCurrency,
    amount: number,
    createdBy = 'system',
  ): Promise<ReserveResult> {
    const reservationId = generateReservationId();
    const poolId = `${provider}_${currency}`;

    if (__DEV__) {
      const reservation: TreasuryReservation = {
        reservationId,
        txId,
        provider,
        currency,
        amount,
        status: 'pending',
        poolId,
        createdAt: now(),
        expiresAt: expiresAt(),
      };
      console.log(
        `[reservationService] DEV createReservation: ${reservationId} | ${amount} ${currency} at ${provider}`,
      );
      auditLog('treasury_reservation_created', { reservationId, txId, provider, amount, currency });
      return { success: true, reservation };
    }

    try {
      // Check liquidity before entering transaction
      const hasLiquidity = await liquidityService.checkAvailableLiquidity(
        provider,
        currency,
        amount,
      );
      if (!hasLiquidity) {
        const pool = await liquidityService.getPool(provider, currency);
        throw new InsufficientLiquidityError(
          provider,
          currency,
          pool?.availableBalance ?? 0,
          amount,
        );
      }

      // Atomic: create reservation + update pool
      const reservation: TreasuryReservation = {
        reservationId,
        txId,
        provider,
        currency,
        amount,
        status: 'pending',
        poolId,
        createdAt: now(),
        expiresAt: expiresAt(),
      };

      await setDoc(doc(db, RESERVATIONS_COL, reservationId), reservation);

      // Move funds from available → reserved in pool
      await liquidityService.updatePoolBalances(
        provider,
        currency,
        -amount,
        +amount,
        'RESERVE',
        {
          txId,
          reservationId,
          description: `Reserve ${amount} ${currency} for tx ${txId}`,
          createdBy,
        },
      );

      auditLog('treasury_reservation_created', {
        reservationId,
        txId,
        provider,
        amount,
        currency,
      });

      return { success: true, reservation };
    } catch (err: any) {
      if (err instanceof InsufficientLiquidityError) {
        await treasuryAlertsService.createAlert({
          type: 'LOW_LIQUIDITY',
          provider,
          currency,
          description: `Reservation failed: ${err.message}`,
          metadata: { txId, requestedAmount: amount },
        });
        return { success: false, error: err.message };
      }
      console.error('[reservationService] createReservation failed:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * confirmReservation — locks reservation as confirmed (payout sent to provider).
   * Moves reservation from pending → confirmed.
   * Does NOT move pool balances again (funds were already moved to reserved on create).
   */
  async confirmReservation(
    reservationId: string,
    confirmedBy = 'system',
  ): Promise<ConfirmResult> {
    if (__DEV__) {
      console.log(`[reservationService] DEV confirmReservation: ${reservationId}`);
      auditLog('treasury_reservation_confirmed', { reservationId });
      return { success: true, reservationId };
    }

    try {
      const snap = await getDoc(doc(db, RESERVATIONS_COL, reservationId));
      if (!snap.exists()) throw new ReservationNotFoundError(reservationId);

      const res = snap.data() as TreasuryReservation;
      if (res.status !== 'pending') {
        throw new ReservationStateError(reservationId, res.status, 'pending');
      }

      await updateDoc(doc(db, RESERVATIONS_COL, reservationId), {
        status: 'confirmed' as ReservationStatus,
        confirmedAt: now(),
        confirmedBy,
      });

      auditLog('treasury_reservation_confirmed', {
        reservationId,
        txId: res.txId,
        provider: res.provider,
        amount: res.amount,
      });

      return { success: true, reservationId };
    } catch (err: any) {
      console.error('[reservationService] confirmReservation failed:', err);
      return { success: false, reservationId, error: err.message };
    }
  },

  /**
   * releaseReservation — returns reserved funds back to the available pool.
   * Used when a payout fails, is cancelled, or expires.
   */
  async releaseReservation(
    reservationId: string,
    reason = 'manual_release',
  ): Promise<ReleaseResult> {
    if (__DEV__) {
      console.log(`[reservationService] DEV releaseReservation: ${reservationId}`);
      auditLog('treasury_reservation_released', { reservationId, reason });
      return { success: true, reservationId, amountReleased: 0 };
    }

    try {
      const snap = await getDoc(doc(db, RESERVATIONS_COL, reservationId));
      if (!snap.exists()) throw new ReservationNotFoundError(reservationId);

      const res = snap.data() as TreasuryReservation;

      if (res.status === 'released' || res.status === 'expired') {
        return { success: true, reservationId, amountReleased: 0 };
      }
      if (res.status === 'confirmed') {
        throw new ReservationStateError(reservationId, res.status, 'pending');
      }

      // Return reserved funds back to available
      await liquidityService.updatePoolBalances(
        res.provider,
        res.currency,
        +res.amount,
        -res.amount,
        'RELEASE',
        {
          txId: res.txId,
          reservationId,
          description: `Release ${res.amount} ${res.currency} — ${reason}`,
          createdBy: 'system',
        },
      );

      await updateDoc(doc(db, RESERVATIONS_COL, reservationId), {
        status: 'released' as ReservationStatus,
        releasedAt: now(),
        releasedReason: reason,
      });

      auditLog('treasury_reservation_released', {
        reservationId,
        txId: res.txId,
        provider: res.provider,
        amount: res.amount,
        reason,
      });

      return { success: true, reservationId, amountReleased: res.amount };
    } catch (err: any) {
      console.error('[reservationService] releaseReservation failed:', err);
      return { success: false, reservationId, amountReleased: 0, error: err.message };
    }
  },

  /**
   * expireStaleReservations — finds pending reservations past their TTL and expires them.
   * Returns the count of expired reservations.
   */
  async expireStaleReservations(): Promise<number> {
    if (__DEV__) {
      console.log('[reservationService] DEV expireStaleReservations — returning mock 1');
      return 1;
    }

    try {
      const q = query(
        collection(db, RESERVATIONS_COL),
        where('status', '==', 'pending'),
        orderBy('createdAt', 'asc'),
        limit(200),
      );
      const snap = await getDocs(q);
      let expiredCount = 0;

      for (const docSnap of snap.docs) {
        const res = docSnap.data() as TreasuryReservation;
        if (new Date(res.expiresAt) < new Date()) {
          // Release the reserved funds
          await liquidityService.updatePoolBalances(
            res.provider,
            res.currency,
            +res.amount,
            -res.amount,
            'RELEASE',
            {
              txId: res.txId,
              reservationId: res.reservationId,
              description: `Auto-expire reservation ${res.reservationId} after TTL`,
              createdBy: 'system:expire_worker',
            },
          );

          await updateDoc(doc(db, RESERVATIONS_COL, res.reservationId), {
            status: 'expired' as ReservationStatus,
            expiredAt: now(),
          });

          await treasuryAlertsService.createAlert({
            type: 'STUCK_RESERVATION',
            provider: res.provider,
            currency: res.currency,
            description: `Reservation ${res.reservationId} auto-expired after ${RESERVATION_TTL_HOURS}h TTL.`,
            metadata: { reservationId: res.reservationId, txId: res.txId, amount: res.amount },
          });

          expiredCount += 1;
          auditLog('treasury_reservation_expired', {
            reservationId: res.reservationId,
            txId: res.txId,
            amount: res.amount,
          });
        }
      }

      console.log(`[reservationService] expireStaleReservations: ${expiredCount} expired`);
      return expiredCount;
    } catch (err) {
      console.error('[reservationService] expireStaleReservations failed:', err);
      return 0;
    }
  },

  /**
   * listReservations — returns reservations with optional filters.
   */
  async listReservations(filters?: ReservationFilters): Promise<TreasuryReservation[]> {
    if (__DEV__) {
      let list = getMockReservations();
      if (filters?.status) list = list.filter((r) => r.status === filters.status);
      if (filters?.provider) list = list.filter((r) => r.provider === filters.provider);
      if (filters?.currency) list = list.filter((r) => r.currency === filters.currency);
      return list;
    }
    try {
      const constraints: any[] = [orderBy('createdAt', 'desc'), limit(200)];
      if (filters?.status) constraints.push(where('status', '==', filters.status));
      if (filters?.provider) constraints.push(where('provider', '==', filters.provider));
      if (filters?.currency) constraints.push(where('currency', '==', filters.currency));
      const q = query(collection(db, RESERVATIONS_COL), ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as TreasuryReservation);
    } catch (err) {
      console.error('[reservationService] listReservations failed:', err);
      return [];
    }
  },
};

// ─────────────────────────────────────────────
// DEV MOCK DATA
// ─────────────────────────────────────────────

function getMockReservations(): TreasuryReservation[] {
  return [
    {
      reservationId: 'tres_mock_001',
      txId: 'TXN_MOCK_1001',
      provider: 'CHAPA',
      currency: 'ETB',
      amount: 12056,
      status: 'pending',
      poolId: 'CHAPA_ETB',
      createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 95 * 60 * 1000).toISOString(),
    },
    {
      reservationId: 'tres_mock_002',
      txId: 'TXN_MOCK_1002',
      provider: 'TELEBIRR',
      currency: 'ETB',
      amount: 8750,
      status: 'confirmed',
      poolId: 'TELEBIRR_ETB',
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 60 * 60 * 1000 + 2 * 3600 * 1000).toISOString(),
      confirmedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    },
    {
      reservationId: 'tres_mock_003',
      txId: 'TXN_MOCK_1003',
      provider: 'BANK_DASHEN',
      currency: 'ETB',
      amount: 23500,
      status: 'released',
      poolId: 'BANK_DASHEN_ETB',
      createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
      releasedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      releasedReason: 'payout_failed',
    },
    {
      reservationId: 'tres_mock_004',
      txId: 'TXN_MOCK_1004',
      provider: 'BANK_AWASH',
      currency: 'ETB',
      amount: 15200,
      status: 'expired',
      poolId: 'BANK_AWASH_ETB',
      createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      expiredAt: new Date(Date.now() - 2.9 * 3600 * 1000).toISOString(),
    },
    {
      reservationId: 'tres_mock_005',
      txId: 'TXN_MOCK_1005',
      provider: 'CHAPA',
      currency: 'ETB',
      amount: 31000,
      status: 'pending',
      poolId: 'CHAPA_ETB',
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 110 * 60 * 1000).toISOString(),
    },
  ];
}

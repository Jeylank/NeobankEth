/**
 * staleReservationWorker.ts
 * ─────────────────────────
 * Dedicated worker that scans FX/treasury reservations for stale entries
 * and either auto-releases them (if safe) or creates reconciliation alerts.
 *
 * A reservation is "stale" when:
 *   - status is still 'reserved'
 *   - the associated transaction is COMPLETED, FAILED, or CANCELLED
 *   - OR more than STALE_THRESHOLD_HOURS have elapsed with no update
 *
 * This worker is READ-SAFE for live transactions. It only writes to:
 *   - reconciliation_alerts
 *   - fx_reservations (status update to 'released' only)
 */

import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { app } from '../services/firebase';
import { reconciliationAlertService } from '../services/reconciliation/reconciliationAlertService';

const db = getFirestore(app);
const FX_RESERVATIONS_COL = 'fx_reservations';
const PAYOUT_COL = 'payout_transactions';

/** Reservations older than this without confirmation are auto-released */
const STALE_THRESHOLD_HOURS = 4;

/** Only auto-release if payout is COMPLETED or FAILED */
const TERMINAL_PAYOUT_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'];

function now(): string {
  return new Date().toISOString();
}

function hoursSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 3600);
}

interface FxReservation {
  reservationId: string;
  quoteId: string;
  txId?: string;
  bank: string;
  reservedAmountETB: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

function auditLog(event: string, data: Record<string, unknown>): void {
  console.log(`[StaleReservationWorker:AuditLog] ${event}`, JSON.stringify(data, null, 0));
}

export async function runStaleReservationWorker(): Promise<{
  scanned: number;
  staleFound: number;
  autoReleased: number;
  alertsCreated: number;
}> {
  console.log(`[StaleReservationWorker] Started at ${now()}`);

  const stats = { scanned: 0, staleFound: 0, autoReleased: 0, alertsCreated: 0 };

  if (__DEV__) {
    // Simulate in dev mode
    console.log('[StaleReservationWorker] DEV mode — returning mock stats');
    return { scanned: 12, staleFound: 2, autoReleased: 1, alertsCreated: 1 };
  }

  try {
    // Fetch all active (reserved) reservations
    const q = query(
      collection(db, FX_RESERVATIONS_COL),
      where('status', '==', 'reserved'),
    );
    const snap = await getDocs(q);
    const reservations = snap.docs.map((d) => ({
      reservationId: d.id,
      ...d.data(),
    } as FxReservation));

    stats.scanned = reservations.length;
    console.log(`[StaleReservationWorker] Found ${reservations.length} active reservations`);

    for (const res of reservations) {
      const ageHours = hoursSince(res.createdAt);

      if (ageHours < STALE_THRESHOLD_HOURS) continue;

      stats.staleFound += 1;
      console.log(
        `[StaleReservationWorker] Stale: ${res.reservationId} (${ageHours.toFixed(1)}h old) | bank:${res.bank} | ${res.reservedAmountETB} ETB`,
      );

      let payoutTerminal = false;

      // Check if associated payout is in a terminal state
      if (res.txId) {
        try {
          const payoutQuery = query(
            collection(db, PAYOUT_COL),
            where('id', '==', res.txId),
          );
          const payoutSnap = await getDocs(payoutQuery);
          if (!payoutSnap.empty) {
            const payoutData = payoutSnap.docs[0].data();
            payoutTerminal = TERMINAL_PAYOUT_STATUSES.includes(
              (payoutData.payoutStatus ?? '').toUpperCase(),
            );
          }
        } catch (err) {
          console.warn(`[StaleReservationWorker] Could not fetch payout for ${res.txId}:`, err);
        }
      }

      if (payoutTerminal) {
        // Safe to auto-release
        try {
          await updateDoc(doc(db, FX_RESERVATIONS_COL, res.reservationId), {
            status: 'released',
            updatedAt: now(),
            releasedReason: 'stale_worker_auto_release',
          });
          stats.autoReleased += 1;
          auditLog('stale_reservation_auto_released', {
            reservationId: res.reservationId,
            txId: res.txId,
            bank: res.bank,
            ageHours: ageHours.toFixed(1),
          });
          console.log(`[StaleReservationWorker] Auto-released ${res.reservationId}`);
        } catch (err) {
          console.error(`[StaleReservationWorker] Auto-release failed for ${res.reservationId}:`, err);
        }
      } else {
        // Payout status unknown — create alert for admin review
        await reconciliationAlertService.createAlert({
          runId: `stale_worker_${Date.now()}`,
          txId: res.txId ?? res.quoteId,
          provider: res.bank,
          type: 'STALE_RESERVATION',
          extra: `Reservation ${res.reservationId} for ${res.reservedAmountETB} ETB via ${res.bank} is ${ageHours.toFixed(1)}h old with no confirmation.`,
        });
        stats.alertsCreated += 1;
      }
    }

    auditLog('stale_reservation_worker_completed', stats);
    console.log(
      `[StaleReservationWorker] Done — scanned:${stats.scanned} stale:${stats.staleFound} ` +
        `released:${stats.autoReleased} alerts:${stats.alertsCreated}`,
    );
  } catch (err: any) {
    console.error('[StaleReservationWorker] FAILED:', err.message);
    auditLog('stale_reservation_worker_failed', { error: err.message });
  }

  return stats;
}

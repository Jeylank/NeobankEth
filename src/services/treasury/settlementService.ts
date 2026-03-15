/**
 * settlementService.ts
 * ─────────────────────
 * Manages settlement obligations between Habeshare and its payout partners.
 *
 * A settlement obligation is opened when a confirmed payout is dispatched
 * to a provider. The obligation tracks that Habeshare has utilized that
 * provider's liquidity and needs to settle (wire funds back) within the
 * agreed window (default: 48 hours).
 *
 * Lifecycle:
 *   openObligation → open
 *   partial payment  → partially_settled
 *   full settlement  → settled
 *   >48h without settlement → overdue (auto-detected)
 *   admin dispute    → disputed
 *
 * Firestore: settlement_obligations/{obligationId}
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
} from 'firebase/firestore';
import { app } from '../firebase';
import { treasuryAlertsService } from './treasuryAlertsService';
import { liquidityService } from './liquidityService';
import type {
  SettlementObligation,
  SettlementObligationStatus,
  TreasuryProvider,
  TreasuryCurrency,
  SettlementFilters,
} from './treasuryTypes';

const db = getFirestore(app);
const OBLIGATIONS_COL = 'settlement_obligations';

/** Default settlement window in hours */
const DEFAULT_SETTLEMENT_WINDOW_HOURS = 48;

function now(): string {
  return new Date().toISOString();
}

function dueDate(windowHours = DEFAULT_SETTLEMENT_WINDOW_HOURS): string {
  return new Date(Date.now() + windowHours * 3600 * 1000).toISOString();
}

function generateObligationId(): string {
  return `sett_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hoursSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 3600);
}

function isOverdue(obligation: SettlementObligation): boolean {
  return (
    (obligation.status === 'open' || obligation.status === 'partially_settled') &&
    new Date(obligation.dueDate) < new Date()
  );
}

function auditLog(event: string, data: Record<string, unknown>): void {
  console.log(`[Treasury:AuditLog] ${event}`, JSON.stringify(data, null, 0));
}

export const settlementService = {
  /**
   * openObligation — creates a new settlement obligation after a payout is executed.
   * Also debits the pool balance (funds were used for the payout).
   */
  async openObligation(
    txId: string,
    provider: TreasuryProvider,
    currency: TreasuryCurrency,
    amount: number,
    reservationId?: string,
    createdBy = 'system',
  ): Promise<SettlementObligation> {
    const obligationId = generateObligationId();

    const obligation: SettlementObligation = {
      obligationId,
      txId,
      provider,
      currency,
      amount,
      status: 'open',
      dueDate: dueDate(),
      openedAt: now(),
    };

    if (__DEV__) {
      console.log(
        `[settlementService] DEV openObligation: ${obligationId} | ${amount} ${currency} at ${provider}`,
      );
      auditLog('treasury_settlement_opened', {
        obligationId,
        txId,
        provider,
        amount,
        dueDate: obligation.dueDate,
      });
      return obligation;
    }

    await setDoc(doc(db, OBLIGATIONS_COL, obligationId), obligation);

    // Debit the pool — funds have left the pool as a payout
    await liquidityService.updatePoolBalances(
      provider,
      currency,
      0,
      -amount,
      'POOL_DEBIT',
      {
        txId,
        reservationId,
        obligationId,
        description: `Pool debit for payout tx ${txId} — settlement obligation ${obligationId}`,
        createdBy,
      },
    );

    auditLog('treasury_settlement_opened', {
      obligationId,
      txId,
      provider,
      amount,
      dueDate: obligation.dueDate,
    });

    return obligation;
  },

  /**
   * closeObligation — marks an obligation as settled.
   * Also credits the pool (funds replenished after settlement wire).
   */
  async closeObligation(
    obligationId: string,
    settledAmount?: number,
    closedBy = 'system',
  ): Promise<void> {
    if (__DEV__) {
      console.log(`[settlementService] DEV closeObligation: ${obligationId}`);
      auditLog('treasury_settlement_closed', { obligationId });
      return;
    }

    const snap = await getDoc(doc(db, OBLIGATIONS_COL, obligationId));
    if (!snap.exists()) {
      throw new Error(`Settlement obligation ${obligationId} not found`);
    }

    const obligation = snap.data() as SettlementObligation;
    const amount = settledAmount ?? obligation.amount;

    await updateDoc(doc(db, OBLIGATIONS_COL, obligationId), {
      status: 'settled' as SettlementObligationStatus,
      settledAt: now(),
      settledAmount: amount,
      notes: closedBy !== 'system' ? `Closed by ${closedBy}` : undefined,
    });

    // Credit the pool — settlement wire received
    await liquidityService.updatePoolBalances(
      obligation.provider,
      obligation.currency,
      +amount,
      0,
      'POOL_CREDIT',
      {
        txId: obligation.txId,
        obligationId,
        description: `Pool credit: settlement ${obligationId} cleared — ${amount} ${obligation.currency}`,
        createdBy: closedBy,
      },
    );

    auditLog('treasury_settlement_closed', {
      obligationId,
      txId: obligation.txId,
      amount,
      provider: obligation.provider,
    });
  },

  /**
   * detectOverdueObligations — scans open obligations past their due date
   * and creates alerts. Returns count of overdue found.
   */
  async detectOverdueObligations(): Promise<number> {
    const obligations = await this.listObligations({ status: 'open' });
    let count = 0;
    for (const ob of obligations) {
      if (isOverdue(ob)) {
        count += 1;
        await updateDoc(doc(db, OBLIGATIONS_COL, ob.obligationId), {
          status: 'open' as SettlementObligationStatus,
          notes: `Overdue as of ${now()}`,
        });
        await treasuryAlertsService.createAlert({
          type: 'OVERDUE_SETTLEMENT',
          provider: ob.provider,
          currency: ob.currency,
          description: `Settlement obligation ${ob.obligationId} is overdue. Was due ${ob.dueDate}. Amount: ${ob.amount} ${ob.currency}.`,
          metadata: {
            obligationId: ob.obligationId,
            txId: ob.txId,
            amount: ob.amount,
            overdueHours: hoursSince(ob.dueDate).toFixed(1),
          },
        });
        auditLog('treasury_settlement_overdue', {
          obligationId: ob.obligationId,
          txId: ob.txId,
          provider: ob.provider,
          overdueHours: hoursSince(ob.dueDate).toFixed(1),
        });
      }
    }
    console.log(`[settlementService] detectOverdueObligations: ${count} overdue found`);
    return count;
  },

  /**
   * listObligations — returns obligations with optional filters.
   */
  async listObligations(filters?: SettlementFilters): Promise<SettlementObligation[]> {
    if (__DEV__) {
      let list = getMockObligations();
      if (filters?.status) list = list.filter((o) => o.status === filters.status);
      if (filters?.provider) list = list.filter((o) => o.provider === filters.provider);
      if (filters?.overdue) list = list.filter(isOverdue);
      return list;
    }
    try {
      const constraints: any[] = [orderBy('openedAt', 'desc'), limit(200)];
      if (filters?.status) constraints.push(where('status', '==', filters.status));
      if (filters?.provider) constraints.push(where('provider', '==', filters.provider));
      const q = query(collection(db, OBLIGATIONS_COL), ...constraints);
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => d.data() as SettlementObligation);
      if (filters?.overdue) return list.filter(isOverdue);
      return list;
    } catch (err) {
      console.error('[settlementService] listObligations failed:', err);
      return [];
    }
  },
};

// ─────────────────────────────────────────────
// DEV MOCK DATA
// ─────────────────────────────────────────────

function getMockObligations(): SettlementObligation[] {
  return [
    {
      obligationId: 'sett_mock_001',
      txId: 'TXN_MOCK_2001',
      provider: 'CHAPA',
      currency: 'ETB',
      amount: 125_000,
      status: 'open',
      dueDate: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
      openedAt: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
    },
    {
      obligationId: 'sett_mock_002',
      txId: 'TXN_MOCK_2002',
      provider: 'TELEBIRR',
      currency: 'ETB',
      amount: 89_500,
      status: 'open',
      dueDate: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
      openedAt: new Date(Date.now() - 54 * 3600 * 1000).toISOString(),
      notes: 'Overdue as of 6h ago',
    },
    {
      obligationId: 'sett_mock_003',
      txId: 'TXN_MOCK_2003',
      provider: 'BANK_DASHEN',
      currency: 'ETB',
      amount: 230_000,
      status: 'settled',
      dueDate: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      openedAt: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
      settledAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
      settledAmount: 230_000,
    },
    {
      obligationId: 'sett_mock_004',
      txId: 'TXN_MOCK_2004',
      provider: 'BANK_CBE',
      currency: 'ETB',
      amount: 410_000,
      status: 'partially_settled',
      dueDate: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
      openedAt: new Date(Date.now() - 44 * 3600 * 1000).toISOString(),
      settledAmount: 200_000,
      notes: 'Partial: 200,000 ETB received. Remaining: 210,000 ETB.',
    },
    {
      obligationId: 'sett_mock_005',
      txId: 'TXN_MOCK_2005',
      provider: 'BANK_AWASH',
      currency: 'ETB',
      amount: 54_800,
      status: 'disputed',
      dueDate: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
      openedAt: new Date(Date.now() - 60 * 3600 * 1000).toISOString(),
      notes: 'Disputed: Awash Bank claims settlement already wired. Under investigation.',
    },
  ];
}

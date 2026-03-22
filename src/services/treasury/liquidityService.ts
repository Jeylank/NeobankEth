/**
 * liquidityService.ts
 * ────────────────────
 * Manages liquidity pool state for all treasury providers.
 *
 * Each pool tracks:
 *  - availableBalance: funds that can be deployed for new payouts
 *  - reservedBalance: funds held for in-flight reservations
 *  - totalBalance: available + reserved
 *
 * Pool status is derived from watermark thresholds:
 *  - active: availableBalance > lowWatermarkAmount
 *  - low: availableBalance <= lowWatermarkAmount
 *  - critical: availableBalance <= criticalWatermarkAmount
 *  - suspended: manually set by admin or auto-suspended on negative balance
 *
 * All balance mutations go through updatePoolBalances which writes an
 * immutable TreasuryMovement for every change.
 */

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  LiquidityPool,
  TreasuryProvider,
  TreasuryCurrency,
  LiquidityPoolStatus,
  TreasuryMovementType,
  PoolSummary,
} from './treasuryTypes';

const POOLS_COL = 'liquidity_pools';
const MOVEMENTS_COL = 'treasury_movements';

function now(): string {
  return new Date().toISOString();
}

function buildPoolId(provider: TreasuryProvider, currency: TreasuryCurrency): string {
  return `${provider}_${currency}`;
}

function deriveStatus(
  available: number,
  low: number,
  critical: number,
  current: LiquidityPoolStatus,
): LiquidityPoolStatus {
  if (current === 'suspended') return 'suspended';
  if (available < 0) return 'critical';
  if (available <= critical) return 'critical';
  if (available <= low) return 'low';
  return 'active';
}

// ─────────────────────────────────────────────
// MOVEMENT WRITER (internal)
// ─────────────────────────────────────────────

async function writeMovement(params: {
  type: TreasuryMovementType;
  poolId: string;
  provider: TreasuryProvider;
  currency: TreasuryCurrency;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  txId?: string;
  reservationId?: string;
  obligationId?: string;
  description: string;
  createdBy?: string;
}): Promise<void> {
  if (__DEV__) {
    console.log(
      `[TreasuryMovement] ${params.type} | pool:${params.poolId} | ` +
        `amount:${params.amount} ${params.currency} | before:${params.balanceBefore} after:${params.balanceAfter}`,
    );
    return;
  }
  const movementId = `mv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(doc(db, MOVEMENTS_COL, movementId), {
    movementId,
    ...params,
    createdBy: params.createdBy ?? 'system',
    createdAt: now(),
  });
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

export const liquidityService = {
  /**
   * getPool — returns a single liquidity pool by provider + currency.
   */
  async getPool(
    provider: TreasuryProvider,
    currency: TreasuryCurrency,
  ): Promise<LiquidityPool | null> {
    const poolId = buildPoolId(provider, currency);

    if (__DEV__) {
      const mock = getMockPools().find((p) => p.poolId === poolId);
      return mock ?? getMockPools()[0];
    }

    try {
      const snap = await getDoc(doc(db, POOLS_COL, poolId));
      return snap.exists() ? (snap.data() as LiquidityPool) : null;
    } catch (err) {
      console.error('[liquidityService] getPool failed:', err);
      return null;
    }
  },

  /**
   * listPoolsByCurrency — returns all pools for a given currency.
   */
  async listPoolsByCurrency(currency: TreasuryCurrency): Promise<LiquidityPool[]> {
    if (__DEV__) {
      return getMockPools().filter((p) => p.currency === currency);
    }
    try {
      const q = query(
        collection(db, POOLS_COL),
        where('currency', '==', currency),
        orderBy('provider'),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as LiquidityPool);
    } catch (err) {
      console.error('[liquidityService] listPoolsByCurrency failed:', err);
      return [];
    }
  },

  /**
   * listAllPools — returns all pools across all providers and currencies.
   */
  async listAllPools(): Promise<LiquidityPool[]> {
    if (__DEV__) return getMockPools();
    try {
      const snap = await getDocs(collection(db, POOLS_COL));
      return snap.docs.map((d) => d.data() as LiquidityPool);
    } catch (err) {
      console.error('[liquidityService] listAllPools failed:', err);
      return [];
    }
  },

  /**
   * checkAvailableLiquidity — returns true if the pool has enough available balance.
   */
  async checkAvailableLiquidity(
    provider: TreasuryProvider,
    currency: TreasuryCurrency,
    amount: number,
  ): Promise<boolean> {
    const pool = await this.getPool(provider, currency);
    if (!pool) return false;
    return pool.availableBalance >= amount && pool.status !== 'suspended';
  },

  /**
   * updatePoolBalances — atomically updates pool available + reserved balances.
   * Writes an immutable TreasuryMovement for every change.
   * Uses Firestore transaction for atomicity.
   */
  async updatePoolBalances(
    provider: TreasuryProvider,
    currency: TreasuryCurrency,
    availableDelta: number,
    reservedDelta: number,
    movementType: TreasuryMovementType,
    context: {
      txId?: string;
      reservationId?: string;
      obligationId?: string;
      description: string;
      createdBy?: string;
    },
  ): Promise<LiquidityPool> {
    const poolId = buildPoolId(provider, currency);

    if (__DEV__) {
      const pool = getMockPools().find((p) => p.poolId === poolId) ?? getMockPools()[0];
      const updated = {
        ...pool,
        availableBalance: pool.availableBalance + availableDelta,
        reservedBalance: pool.reservedBalance + reservedDelta,
        totalBalance: pool.totalBalance + availableDelta + reservedDelta,
        lastUpdatedAt: now(),
      };
      updated.status = deriveStatus(
        updated.availableBalance,
        pool.lowWatermarkAmount,
        pool.criticalWatermarkAmount,
        pool.status,
      );
      await writeMovement({
        type: movementType,
        poolId,
        provider,
        currency,
        amount: Math.abs(availableDelta + reservedDelta),
        balanceBefore: pool.availableBalance,
        balanceAfter: updated.availableBalance,
        ...context,
      });
      return updated;
    }

    try {
      return await runTransaction(db, async (tx) => {
        const poolRef = doc(db, POOLS_COL, poolId);
        const snap = await tx.get(poolRef);

        if (!snap.exists()) {
          throw new Error(`Liquidity pool ${poolId} not found`);
        }

        const pool = snap.data() as LiquidityPool;
        const newAvailable = pool.availableBalance + availableDelta;
        const newReserved = pool.reservedBalance + reservedDelta;
        const newTotal = newAvailable + newReserved;
        const newStatus = deriveStatus(
          newAvailable,
          pool.lowWatermarkAmount,
          pool.criticalWatermarkAmount,
          pool.status,
        );

        const updated: LiquidityPool = {
          ...pool,
          availableBalance: newAvailable,
          reservedBalance: newReserved,
          totalBalance: newTotal,
          status: newStatus,
          lastUpdatedAt: now(),
        };

        tx.set(poolRef, updated);

        await writeMovement({
          type: movementType,
          poolId,
          provider,
          currency,
          amount: Math.abs(availableDelta + reservedDelta),
          balanceBefore: pool.availableBalance,
          balanceAfter: newAvailable,
          ...context,
        });

        return updated;
      });
    } catch (err) {
      console.error('[liquidityService] updatePoolBalances failed:', err);
      throw err;
    }
  },

  /**
   * ensurePool — creates a pool if it doesn't exist (idempotent init).
   */
  async ensurePool(
    provider: TreasuryProvider,
    currency: TreasuryCurrency,
    initialBalance = 0,
  ): Promise<LiquidityPool> {
    const poolId = buildPoolId(provider, currency);
    if (__DEV__) {
      return getMockPools()[0];
    }
    const existing = await this.getPool(provider, currency);
    if (existing) return existing;

    const pool: LiquidityPool = {
      poolId,
      provider,
      currency,
      availableBalance: initialBalance,
      reservedBalance: 0,
      totalBalance: initialBalance,
      lowWatermarkAmount: 500000,
      criticalWatermarkAmount: 100000,
      status: 'active',
      lastUpdatedAt: now(),
      createdAt: now(),
    };
    await setDoc(doc(db, POOLS_COL, poolId), pool);
    return pool;
  },

  /**
   * getPoolSummaries — returns PoolSummary for all pools with utilization rate.
   */
  async getPoolSummaries(): Promise<PoolSummary[]> {
    const pools = await this.listAllPools();
    return pools.map(
      (p): PoolSummary => ({
        poolId: p.poolId,
        provider: p.provider,
        currency: p.currency,
        availableBalance: p.availableBalance,
        reservedBalance: p.reservedBalance,
        totalBalance: p.totalBalance,
        status: p.status,
        utilizationRate:
          p.totalBalance > 0
            ? Math.round((p.reservedBalance / p.totalBalance) * 100)
            : 0,
      }),
    );
  },
};

// ─────────────────────────────────────────────
// DEV MOCK DATA
// ─────────────────────────────────────────────

export function getMockPools(): LiquidityPool[] {
  return [
    {
      poolId: 'CHAPA_ETB',
      provider: 'CHAPA',
      currency: 'ETB',
      availableBalance: 3_450_000,
      reservedBalance: 285_000,
      totalBalance: 3_735_000,
      lowWatermarkAmount: 500_000,
      criticalWatermarkAmount: 100_000,
      status: 'active',
      lastUpdatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    },
    {
      poolId: 'TELEBIRR_ETB',
      provider: 'TELEBIRR',
      currency: 'ETB',
      availableBalance: 1_890_000,
      reservedBalance: 412_000,
      totalBalance: 2_302_000,
      lowWatermarkAmount: 500_000,
      criticalWatermarkAmount: 100_000,
      status: 'active',
      lastUpdatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    },
    {
      poolId: 'BANK_DASHEN_ETB',
      provider: 'BANK_DASHEN',
      currency: 'ETB',
      availableBalance: 320_000,
      reservedBalance: 90_000,
      totalBalance: 410_000,
      lowWatermarkAmount: 500_000,
      criticalWatermarkAmount: 100_000,
      status: 'low',
      lastUpdatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
    },
    {
      poolId: 'BANK_AWASH_ETB',
      provider: 'BANK_AWASH',
      currency: 'ETB',
      availableBalance: 75_000,
      reservedBalance: 45_000,
      totalBalance: 120_000,
      lowWatermarkAmount: 500_000,
      criticalWatermarkAmount: 100_000,
      status: 'critical',
      lastUpdatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString(),
    },
    {
      poolId: 'BANK_CBE_ETB',
      provider: 'BANK_CBE',
      currency: 'ETB',
      availableBalance: 5_800_000,
      reservedBalance: 620_000,
      totalBalance: 6_420_000,
      lowWatermarkAmount: 500_000,
      criticalWatermarkAmount: 100_000,
      status: 'active',
      lastUpdatedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 25 * 24 * 3600 * 1000).toISOString(),
    },
    {
      poolId: 'BANK_ABYSSINIA_ETB',
      provider: 'BANK_ABYSSINIA',
      currency: 'ETB',
      availableBalance: 2_100_000,
      reservedBalance: 180_000,
      totalBalance: 2_280_000,
      lowWatermarkAmount: 500_000,
      criticalWatermarkAmount: 100_000,
      status: 'active',
      lastUpdatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
    },
  ];
}

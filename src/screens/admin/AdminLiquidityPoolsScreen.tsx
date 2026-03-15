import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';
import type { LiquidityPool } from '../../services/treasury/treasuryTypes';

const C = {
  primary: '#006633',
  white: '#FFFFFF',
  bg: '#F5F5F5',
  text: '#1F2937',
  sub: '#6B7280',
  green: '#10B981',
  greenL: '#D1FAE5',
  blue: '#3B82F6',
  blueL: '#DBEAFE',
  red: '#EF4444',
  redL: '#FEE2E2',
  amber: '#F59E0B',
  amberL: '#FEF3C7',
  border: '#E5E7EB',
  grey: '#F3F4F6',
};

const STATUS_CONFIG = {
  active: { color: C.green, bg: C.greenL, icon: 'checkmark-circle' as const },
  low: { color: C.amber, bg: C.amberL, icon: 'alert-circle' as const },
  critical: { color: C.red, bg: C.redL, icon: 'warning' as const },
  suspended: { color: '#6B7280', bg: '#F3F4F6', icon: 'pause-circle' as const },
};

function formatETB(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

function PoolCard({ pool }: { pool: LiquidityPool }) {
  const { t } = useTranslation();
  const cfg = STATUS_CONFIG[pool.status] ?? STATUS_CONFIG.active;
  const utilization = pool.totalBalance > 0
    ? Math.round((pool.reservedBalance / pool.totalBalance) * 100)
    : 0;
  const availablePct = pool.totalBalance > 0
    ? Math.round((pool.availableBalance / pool.totalBalance) * 100)
    : 0;

  const providerDisplay = pool.provider.replace('BANK_', '');

  return (
    <View style={[styles.poolCard, pool.status === 'critical' && styles.poolCardCritical]}>
      <View style={styles.poolHeader}>
        <View style={[styles.statusIcon, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon} size={18} color={cfg.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.poolName}>{providerDisplay}</Text>
          <Text style={styles.poolCurrency}>{pool.currency}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.statusText, { color: cfg.color }]}>
            {pool.status.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Balance breakdown */}
      <View style={styles.balanceRow}>
        <View style={styles.balanceItem}>
          <Text style={styles.balanceLabel}>{t('treasury.available')}</Text>
          <Text style={[styles.balanceVal, { color: cfg.color }]}>
            {formatETB(pool.availableBalance)}
          </Text>
        </View>
        <View style={[styles.balanceDivider]} />
        <View style={styles.balanceItem}>
          <Text style={styles.balanceLabel}>{t('treasury.reserved')}</Text>
          <Text style={[styles.balanceVal, { color: C.amber }]}>
            {formatETB(pool.reservedBalance)}
          </Text>
        </View>
        <View style={styles.balanceDivider} />
        <View style={styles.balanceItem}>
          <Text style={styles.balanceLabel}>{t('treasury.total')}</Text>
          <Text style={styles.balanceVal}>{formatETB(pool.totalBalance)}</Text>
        </View>
      </View>

      {/* Utilization bar */}
      <View style={styles.utilRow}>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${availablePct}%`, backgroundColor: cfg.color }]} />
          <View
            style={[
              styles.barReserved,
              {
                width: `${utilization}%`,
                backgroundColor: C.amber,
                position: 'absolute',
                right: 0,
              },
            ]}
          />
        </View>
        <Text style={styles.utilText}>{utilization}% {t('treasury.utilized')}</Text>
      </View>

      {/* Watermarks */}
      <View style={styles.watermarkRow}>
        <Text style={styles.watermarkText}>
          Low: {formatETB(pool.lowWatermarkAmount)} · Critical: {formatETB(pool.criticalWatermarkAmount)}
        </Text>
        <Text style={styles.watermarkText}>
          {t('treasury.updated')}: {new Date(pool.lastUpdatedAt).toLocaleTimeString()}
        </Text>
      </View>
    </View>
  );
}

function AdminLiquidityPoolsContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: pools = [], isLoading } = useQuery<LiquidityPool[]>({
    queryKey: ['treasury-pools'],
    queryFn: () => adminService.getTreasuryPools(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['treasury-pools'] });
    setRefreshing(false);
  }, [queryClient]);

  const critical = pools.filter((p) => p.status === 'critical').length;
  const low = pools.filter((p) => p.status === 'low').length;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.summaryRow}>
          <Text style={styles.pageTitle}>{t('treasury.liquidityPools')}</Text>
          <View style={styles.summaryBadges}>
            {critical > 0 && (
              <View style={[styles.badge, { backgroundColor: C.redL }]}>
                <Text style={[styles.badgeText, { color: C.red }]}>{critical} {t('treasury.critical')}</Text>
              </View>
            )}
            {low > 0 && (
              <View style={[styles.badge, { backgroundColor: C.amberL }]}>
                <Text style={[styles.badgeText, { color: C.amber }]}>{low} {t('treasury.low')}</Text>
              </View>
            )}
          </View>
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 60 }} />
        ) : (
          pools.map((pool) => <PoolCard key={pool.poolId} pool={pool} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminLiquidityPoolsScreen() {
  return (
    <AdminGuard>
      <AdminLiquidityPoolsContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  pageTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: C.text },
  summaryBadges: { flexDirection: 'row', gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  poolCard: {
    backgroundColor: C.white, borderRadius: 12, padding: 14, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  poolCardCritical: { borderWidth: 1.5, borderColor: C.red },
  poolHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  statusIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  poolName: { fontSize: 15, fontWeight: '700', color: C.text },
  poolCurrency: { fontSize: 12, color: C.sub },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '700' },
  balanceRow: { flexDirection: 'row', marginBottom: 12 },
  balanceItem: { flex: 1, alignItems: 'center' },
  balanceDivider: { width: 1, backgroundColor: C.border },
  balanceLabel: { fontSize: 10, color: C.sub, marginBottom: 3 },
  balanceVal: { fontSize: 16, fontWeight: '700', color: C.text },
  utilRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  barTrack: {
    flex: 1, height: 8, backgroundColor: C.border, borderRadius: 4,
    overflow: 'hidden', flexDirection: 'row',
  },
  barFill: { height: 8, borderRadius: 4 },
  barReserved: { height: 8 },
  utilText: { fontSize: 11, color: C.sub, width: 90, textAlign: 'right' },
  watermarkRow: { flexDirection: 'row', justifyContent: 'space-between' },
  watermarkText: { fontSize: 10, color: C.sub },
});

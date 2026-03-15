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
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';
import type { TreasuryOverview } from '../../services/treasury/treasuryTypes';

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
  purple: '#8B5CF6',
  purpleL: '#F5F3FF',
  border: '#E5E7EB',
  grey: '#F3F4F6',
};

function MetricCard({
  label,
  value,
  icon,
  color,
  bg,
  onPress,
}: {
  label: string;
  value: number | string;
  icon: string;
  color: string;
  bg: string;
  onPress?: () => void;
}) {
  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={[styles.metricCard, { borderLeftColor: color }]} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.metricIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <Text style={[styles.metricVal, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </Wrapper>
  );
}

function ProviderRow({ provider, available, reserved }: { provider: string; available: number; reserved: number }) {
  const total = available + reserved;
  const pct = total > 0 ? Math.round((available / total) * 100) : 0;
  const displayName = provider.replace('BANK_', '').charAt(0) + provider.replace('BANK_', '').slice(1).toLowerCase();

  return (
    <View style={styles.provRow}>
      <Text style={styles.provName}>{displayName}</Text>
      <View style={styles.provBar}>
        <View style={[styles.provBarFill, { width: `${pct}%` }]} />
      </View>
      <View style={styles.provAmounts}>
        <Text style={styles.provAvail}>{(available / 1000).toFixed(0)}k</Text>
        <Text style={styles.provReserved}>/ {(reserved / 1000).toFixed(0)}k</Text>
      </View>
    </View>
  );
}

function AdminTreasuryOverviewContent() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: overview, isLoading } = useQuery<TreasuryOverview>({
    queryKey: ['treasury-overview'],
    queryFn: () => adminService.getTreasuryOverview(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['treasury'] });
    setRefreshing(false);
  }, [queryClient]);

  const hasCritical = (overview?.criticalAlerts ?? 0) > 0 || (overview?.overdueObligations ?? 0) > 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <Ionicons name="shield-half-outline" size={28} color={C.white} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.headerTitle}>{t('treasury.overview')}</Text>
              <Text style={styles.headerSub}>{t('treasury.overviewSubtitle')}</Text>
            </View>
          </View>
          {hasCritical && (
            <View style={styles.criticalBanner}>
              <Ionicons name="warning" size={14} color={C.white} />
              <Text style={styles.criticalBannerText}>
                {t('treasury.criticalIssues')}
              </Text>
            </View>
          )}
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 40 }} />
        ) : overview ? (
          <>
            {/* Key Metrics */}
            <View style={styles.metricsGrid}>
              <MetricCard
                label={t('treasury.totalPools')}
                value={overview.totalPools}
                icon="layers-outline"
                color={C.blue}
                bg={C.blueL}
                onPress={() => navigation.navigate('AdminLiquidityPools')}
              />
              <MetricCard
                label={t('treasury.pendingReservations')}
                value={overview.pendingReservations}
                icon="hourglass-outline"
                color={C.amber}
                bg={C.amberL}
                onPress={() => navigation.navigate('AdminTreasuryReservations')}
              />
              <MetricCard
                label={t('treasury.openObligations')}
                value={overview.openObligations}
                icon="document-text-outline"
                color={C.purple}
                bg={C.purpleL}
                onPress={() => navigation.navigate('AdminSettlementObligations')}
              />
              <MetricCard
                label={t('treasury.openAlerts')}
                value={overview.openAlerts}
                icon="warning-outline"
                color={C.red}
                bg={C.redL}
                onPress={() => navigation.navigate('AdminTreasuryAlerts')}
              />
              <MetricCard
                label={t('treasury.overdueObligations')}
                value={overview.overdueObligations}
                icon="time-outline"
                color={overview.overdueObligations > 0 ? C.red : C.green}
                bg={overview.overdueObligations > 0 ? C.redL : C.greenL}
              />
              <MetricCard
                label={t('treasury.criticalAlerts')}
                value={overview.criticalAlerts}
                icon="alert-circle-outline"
                color={overview.criticalAlerts > 0 ? C.red : C.green}
                bg={overview.criticalAlerts > 0 ? C.redL : C.greenL}
              />
            </View>

            {/* Provider liquidity breakdown */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('treasury.liquidityByProvider')}</Text>
              <View style={styles.card}>
                <View style={styles.legendRow}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: C.primary }]} />
                    <Text style={styles.legendText}>{t('treasury.available')}</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: C.amber }]} />
                    <Text style={styles.legendText}>{t('treasury.reserved')}</Text>
                  </View>
                  <Text style={styles.legendText}>ETB (k)</Text>
                </View>
                {Object.entries(overview.totalAvailableByProvider).map(([provider, available]) => (
                  <ProviderRow
                    key={provider}
                    provider={provider}
                    available={available}
                    reserved={overview.totalReservedByProvider[provider] ?? 0}
                  />
                ))}
              </View>
            </View>

            {/* Quick navigation */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('treasury.manage')}</Text>
              {[
                { label: t('treasury.liquidityPools'), screen: 'AdminLiquidityPools', icon: 'layers-outline', color: C.blue },
                { label: t('treasury.reservations'), screen: 'AdminTreasuryReservations', icon: 'hourglass-outline', color: C.amber },
                { label: t('treasury.settlementObligations'), screen: 'AdminSettlementObligations', icon: 'document-text-outline', color: C.purple },
                { label: t('treasury.alerts'), screen: 'AdminTreasuryAlerts', icon: 'warning-outline', color: C.red },
              ].map((item) => (
                <TouchableOpacity
                  key={item.screen}
                  style={styles.navRow}
                  onPress={() => navigation.navigate(item.screen)}
                >
                  <Ionicons name={item.icon as any} size={20} color={item.color} />
                  <Text style={styles.navLabel}>{item.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={C.sub} />
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.updatedAt}>
              {t('treasury.lastUpdated')}: {new Date(overview.lastUpdatedAt).toLocaleTimeString()}
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminTreasuryOverviewScreen() {
  return (
    <AdminGuard>
      <AdminTreasuryOverviewContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  headerCard: { backgroundColor: C.primary, borderRadius: 14, padding: 16, marginBottom: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.white },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
  criticalBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(239,68,68,0.85)', borderRadius: 8, padding: 8, marginTop: 10,
  },
  criticalBannerText: { color: C.white, fontSize: 12, fontWeight: '600' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  metricCard: {
    flex: 1, minWidth: '45%', backgroundColor: C.white, borderRadius: 10,
    padding: 12, borderLeftWidth: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  metricIcon: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  metricVal: { fontSize: 22, fontWeight: '700' },
  metricLabel: { fontSize: 11, color: C.sub, marginTop: 2 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 10 },
  card: { backgroundColor: C.white, borderRadius: 12, padding: 14, gap: 10 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: C.sub },
  provRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  provName: { width: 72, fontSize: 12, color: C.text, fontWeight: '500' },
  provBar: { flex: 1, height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  provBarFill: { height: 8, backgroundColor: C.primary, borderRadius: 4 },
  provAmounts: { flexDirection: 'row', gap: 2, width: 60, justifyContent: 'flex-end' },
  provAvail: { fontSize: 11, color: C.primary, fontWeight: '600' },
  provReserved: { fontSize: 11, color: C.sub },
  navRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.white, borderRadius: 10, padding: 14, marginBottom: 8,
  },
  navLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: C.text },
  updatedAt: { fontSize: 11, color: C.sub, textAlign: 'center', marginTop: 8 },
});

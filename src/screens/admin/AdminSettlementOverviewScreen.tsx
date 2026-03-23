/**
 * AdminSettlementOverviewScreen.tsx
 * ────────────────────────────────────
 * Hub screen for the Settlement Engine — shows aggregate stats and provides
 * navigation links to all sub-screens (Obligations, Batches, Alerts, Reconciliation).
 */

import React, { useCallback, useState } from 'react';
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

const C = {
  primary: '#006633',
  white: '#FFFFFF',
  bg: '#F5F5F5',
  text: '#1F2937',
  sub: '#6B7280',
  green: '#10B981',  greenL: '#D1FAE5',
  red: '#EF4444',    redL: '#FEE2E2',
  blue: '#3B82F6',   blueL: '#DBEAFE',
  amber: '#F59E0B',  amberL: '#FEF3C7',
  purple: '#8B5CF6', purpleL: '#F5F3FF',
  cyan: '#0891B2',   cyanL: '#ECFEFF',
  border: '#E5E7EB',
  shadow: '#000',
};

function formatETB(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M ETB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k ETB`;
  return `${n.toLocaleString()} ETB`;
}

function StatCard({
  label, value, icon, color, bg,
}: {
  label: string; value: string | number; icon: string; color: string; bg: string;
}) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <View style={[styles.statIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function NavCard({
  label, icon, color, bg, screen,
}: {
  label: string; icon: string; color: string; bg: string; screen: string;
}) {
  const navigation = useNavigation<any>();
  return (
    <TouchableOpacity
      style={styles.navCard}
      onPress={() => navigation.navigate(screen)}
      activeOpacity={0.7}
    >
      <View style={[styles.navIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={24} color={color} />
      </View>
      <Text style={styles.navLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={C.sub} />
    </TouchableOpacity>
  );
}

function AdminSettlementOverviewContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: overview, isLoading } = useQuery({
    queryKey: ['settlement-overview'],
    queryFn: () => adminService.getSettlementOverview(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['settlement-overview'] });
    setRefreshing(false);
  }, [queryClient]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerIcon}>
            <Ionicons name="layers-outline" size={22} color={C.white} />
          </View>
          <View>
            <Text style={styles.headerTitle}>{t('settlementEngine.title')}</Text>
            <Text style={styles.headerSub}>{t('settlementEngine.subtitle')}</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : (
          <>
            {/* ── Summary stats ── */}
            <Text style={styles.sectionLabel}>{t('settlementEngine.overview')}</Text>
            <View style={styles.statsGrid}>
              <StatCard label={t('settlementEngine.openObligations')}  value={overview?.totalOpenObligations ?? 0}           icon="document-text-outline"     color={C.amber}  bg={C.amberL} />
              <StatCard label={t('settlementEngine.openAmount')}       value={formatETB(overview?.totalOpenAmount ?? 0)}      icon="cash-outline"              color={C.blue}   bg={C.blueL} />
              <StatCard label={t('settlementEngine.batchedAmount')}    value={formatETB(overview?.totalBatchedAmount ?? 0)}   icon="cube-outline"              color={C.purple} bg={C.purpleL} />
              <StatCard label={t('settlementEngine.settledToday')}     value={formatETB(overview?.totalSettledToday ?? 0)}    icon="checkmark-circle-outline"  color={C.green}  bg={C.greenL} />
              <StatCard label={t('settlementEngine.overdueAlerts')}    value={overview?.overdueAlertsCount ?? 0}              icon="warning-outline"           color={C.red}    bg={C.redL} />
              <StatCard label={t('settlementEngine.mismatchedReports')}value={overview?.mismatchedReportsCount ?? 0}          icon="git-compare-outline"       color={C.red}    bg={C.redL} />
            </View>

            {/* ── Active batches indicator ── */}
            {(overview?.openBatchesCount ?? 0) > 0 && (
              <View style={styles.batchBanner}>
                <Ionicons name="cube-outline" size={16} color={C.blue} />
                <Text style={styles.batchBannerText}>
                  {overview?.openBatchesCount} {t('settlementEngine.activeBatches')}
                </Text>
                <Ionicons name="arrow-forward" size={14} color={C.blue} />
              </View>
            )}

            {/* ── Navigation links ── */}
            <Text style={styles.sectionLabel}>{t('settlementEngine.manage')}</Text>
            <View style={styles.navGrid}>
              <NavCard label={t('settlementEngine.obligations')}    icon="document-text-outline" color={C.amber}  bg={C.amberL}  screen="AdminSettlementEngineObligations" />
              <NavCard label={t('settlementEngine.batches')}        icon="cube-outline"          color={C.blue}   bg={C.blueL}   screen="AdminSettlementBatches" />
              <NavCard label={t('settlementEngine.alerts')}         icon="warning-outline"       color={C.red}    bg={C.redL}    screen="AdminSettlementAlerts" />
              <NavCard label={t('settlementEngine.reconciliation')} icon="git-compare-outline"   color={C.purple} bg={C.purpleL} screen="AdminSettlementReconciliation" />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminSettlementOverviewScreen() {
  return (
    <AdminGuard>
      <AdminSettlementOverviewContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 16 },
  headerContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.white },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32, gap: 12 },
  loadingBox: { paddingVertical: 80, alignItems: 'center' },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: C.sub, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 2, marginTop: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    backgroundColor: C.white, borderRadius: 12, padding: 14, borderLeftWidth: 3,
    width: '47%', gap: 4,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  statIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800', marginTop: 4 },
  statLabel: { fontSize: 11, color: C.sub, flexWrap: 'wrap' },
  batchBanner: {
    backgroundColor: C.blueL, borderRadius: 10, padding: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  batchBannerText: { flex: 1, fontSize: 14, color: C.blue, fontWeight: '600' },
  navGrid: { gap: 10 },
  navCard: {
    backgroundColor: C.white, borderRadius: 12, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  navIcon: { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center' },
  navLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: C.text },
});

/**
 * AdminSettlementOverviewScreen.tsx
 * ────────────────────────────────────
 * Hub screen for the Settlement Engine.
 *
 * Features:
 *   • Aggregate stats (6 summary cards + 3 new dashboard widgets)
 *   • Overdue obligations count widget
 *   • Unresolved settlement alerts widget
 *   • Today's matched vs mismatched reconciliation mini-chart
 *   • "Run Scheduler" button (manual trigger)
 *   • Auto-runs scheduler on mount if it hasn't run today
 *   • Scheduler last-run status + error summary
 *   • Navigation grid to all 4 sub-screens
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';
import type { SchedulerRunResult, SchedulerStatus } from '../../services/settlement/settlementSchedulerService';

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
  grey: '#9CA3AF',   greyL: '#F3F4F6',
  border: '#E5E7EB',
  shadow: '#000',
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function formatETB(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M ETB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k ETB`;
  return `${n.toLocaleString()} ETB`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatCard({
  label, value, icon, color, bg,
}: { label: string; value: string | number; icon: string; color: string; bg: string }) {
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
}: { label: string; icon: string; color: string; bg: string; screen: string }) {
  const navigation = useNavigation<any>();
  return (
    <TouchableOpacity
      style={styles.navCard}
      onPress={() => navigation.navigate(screen)}
      activeOpacity={0.7}
    >
      <View style={[styles.navIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={22} color={color} />
      </View>
      <Text style={styles.navLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={C.sub} />
    </TouchableOpacity>
  );
}

/** Overdue + Alerts + Recon mini-row widget */
function DashboardWidgets({
  overdueObligations,
  unresolvedAlerts,
  matchedToday,
  mismatchedToday,
  totalReconToday,
}: {
  overdueObligations: number;
  unresolvedAlerts: number;
  matchedToday: number;
  mismatchedToday: number;
  totalReconToday: number;
}) {
  const { t } = useTranslation();
  const matchPct = totalReconToday > 0 ? Math.round((matchedToday / totalReconToday) * 100) : 0;
  const mismatchPct = totalReconToday > 0 ? Math.round((mismatchedToday / totalReconToday) * 100) : 0;

  return (
    <View style={styles.widgetsRow}>
      {/* Overdue obligations */}
      <View style={[styles.widget, { borderColor: overdueObligations > 0 ? C.red : C.border }]}>
        <View style={[styles.widgetIcon, { backgroundColor: overdueObligations > 0 ? C.redL : C.greyL }]}>
          <Ionicons name="hourglass-outline" size={16} color={overdueObligations > 0 ? C.red : C.grey} />
        </View>
        <Text style={[styles.widgetNum, { color: overdueObligations > 0 ? C.red : C.grey }]}>
          {overdueObligations}
        </Text>
        <Text style={styles.widgetLabel}>{t('settlementEngine.overdueObligations')}</Text>
      </View>

      {/* Unresolved alerts */}
      <View style={[styles.widget, { borderColor: unresolvedAlerts > 0 ? C.amber : C.border }]}>
        <View style={[styles.widgetIcon, { backgroundColor: unresolvedAlerts > 0 ? C.amberL : C.greyL }]}>
          <Ionicons name="warning-outline" size={16} color={unresolvedAlerts > 0 ? C.amber : C.grey} />
        </View>
        <Text style={[styles.widgetNum, { color: unresolvedAlerts > 0 ? C.amber : C.grey }]}>
          {unresolvedAlerts}
        </Text>
        <Text style={styles.widgetLabel}>{t('settlementEngine.unresolvedAlerts')}</Text>
      </View>

      {/* Reconciliation match rate today */}
      <View style={[styles.widget, { borderColor: mismatchedToday > 0 ? C.red : C.border }]}>
        <View style={[styles.widgetIcon, { backgroundColor: mismatchedToday > 0 ? C.redL : C.greenL }]}>
          <Ionicons name="git-compare-outline" size={16} color={mismatchedToday > 0 ? C.red : C.green} />
        </View>
        {totalReconToday > 0 ? (
          <>
            {/* Mini stacked bar */}
            <View style={styles.reconBar}>
              <View style={[styles.reconBarFill, { flex: matchPct, backgroundColor: C.green }]} />
              <View style={[styles.reconBarFill, { flex: mismatchPct, backgroundColor: C.red }]} />
            </View>
            <Text style={styles.reconStat}>
              <Text style={{ color: C.green }}>{matchedToday}✓</Text>
              {' / '}
              <Text style={{ color: C.red }}>{mismatchedToday}✗</Text>
            </Text>
          </>
        ) : (
          <Text style={[styles.widgetNum, { color: C.grey }]}>—</Text>
        )}
        <Text style={styles.widgetLabel}>{t('settlementEngine.reconToday')}</Text>
      </View>
    </View>
  );
}

/** Scheduler status bar */
function SchedulerStatusBar({
  status,
  lastResult,
  isRunning,
  onRun,
}: {
  status: SchedulerStatus | undefined;
  lastResult: SchedulerRunResult | null;
  isRunning: boolean;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  const hasErrors = (status?.lastRunErrors ?? []).length > 0;

  return (
    <View style={[styles.schedulerBar, hasErrors && styles.schedulerBarError]}>
      <View style={styles.schedulerBarLeft}>
        <Ionicons
          name={isRunning ? 'sync-outline' : 'time-outline'}
          size={15}
          color={hasErrors ? C.red : C.primary}
          style={isRunning ? styles.spin : undefined}
        />
        <View style={styles.schedulerBarText}>
          <Text style={styles.schedulerBarTitle}>
            {isRunning
              ? t('settlementEngine.schedulerRunning')
              : t('settlementEngine.schedulerLastRun')}{' '}
            {!isRunning && <Text style={styles.schedulerBarTime}>{timeAgo(status?.lastRunAt ?? null)}</Text>}
          </Text>
          {lastResult && !isRunning && (
            <Text style={styles.schedulerBarDetail}>
              {lastResult.batchingResult.filter((b) => b.batchId !== null).length} {t('settlementEngine.batchesCreated')}
              {' · '}
              {lastResult.overdueResult.detected} {t('settlementEngine.overdueFound')}
              {' · '}
              {lastResult.reconciliationResult.length} {t('settlementEngine.reconRan')}
              {lastResult.errors.length > 0 ? ` · ${lastResult.errors.length} ${t('settlementEngine.errors')}` : ''}
            </Text>
          )}
          {hasErrors && !isRunning && (
            <Text style={styles.schedulerBarError2}>
              {status?.lastRunErrors.join('; ')}
            </Text>
          )}
        </View>
      </View>
      <TouchableOpacity
        style={[styles.runBtn, isRunning && styles.runBtnDisabled]}
        onPress={onRun}
        disabled={isRunning}
        activeOpacity={0.7}
      >
        {isRunning ? (
          <ActivityIndicator size="small" color={C.white} />
        ) : (
          <>
            <Ionicons name="play-outline" size={14} color={C.white} />
            <Text style={styles.runBtnText}>{t('settlementEngine.runNow')}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

function AdminSettlementOverviewContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [lastResult, setLastResult] = useState<SchedulerRunResult | null>(null);
  const autoRunAttempted = useRef(false);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['settlement-dashboard-summary'],
    queryFn: () => adminService.getSettlementDashboardSummary(),
    staleTime: 60_000,
  });

  const { data: schedulerStatus } = useQuery({
    queryKey: ['scheduler-status'],
    queryFn: () => adminService.getSchedulerStatus(),
    staleTime: 30_000,
  });

  const schedulerMut = useMutation({
    mutationFn: (by: 'admin' | 'auto') => adminService.runSettlementScheduler(by),
    onSuccess: (result) => {
      setLastResult(result);
      queryClient.invalidateQueries({ queryKey: ['settlement-dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['scheduler-status'] });
      queryClient.invalidateQueries({ queryKey: ['settlement-overview'] });
    },
  });

  // Auto-run on mount if scheduler hasn't run today
  useEffect(() => {
    if (autoRunAttempted.current) return;
    autoRunAttempted.current = true;
    (async () => {
      const should = await adminService.shouldAutoRunScheduler().catch(() => false);
      if (should) {
        schedulerMut.mutate('auto');
      }
    })();
  }, []);

  const onRunScheduler = () =>
    Alert.alert(
      t('settlementEngine.runScheduler'),
      t('settlementEngine.runSchedulerConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settlementEngine.runNow'), onPress: () => schedulerMut.mutate('admin') },
      ],
    );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['settlement-dashboard-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['scheduler-status'] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  const isRunning = schedulerMut.isPending;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
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
        {/* Scheduler status + Run button */}
        <SchedulerStatusBar
          status={schedulerStatus}
          lastResult={lastResult}
          isRunning={isRunning}
          onRun={onRunScheduler}
        />

        {summaryLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : (
          <>
            {/* ── Summary stat cards ── */}
            <Text style={styles.sectionLabel}>{t('settlementEngine.overview')}</Text>
            <View style={styles.statsGrid}>
              <StatCard label={t('settlementEngine.openObligations')}   value={summary?.totalOpenObligations ?? 0}           icon="document-text-outline"     color={C.amber}  bg={C.amberL} />
              <StatCard label={t('settlementEngine.openAmount')}        value={formatETB(summary?.totalOpenAmount ?? 0)}      icon="cash-outline"              color={C.blue}   bg={C.blueL} />
              <StatCard label={t('settlementEngine.batchedAmount')}     value={formatETB(summary?.totalBatchedAmount ?? 0)}   icon="cube-outline"              color={C.purple} bg={C.purpleL} />
              <StatCard label={t('settlementEngine.settledToday')}      value={formatETB(summary?.totalSettledToday ?? 0)}    icon="checkmark-circle-outline"  color={C.green}  bg={C.greenL} />
              <StatCard label={t('settlementEngine.overdueAlerts')}     value={summary?.overdueAlertsCount ?? 0}              icon="warning-outline"           color={C.red}    bg={C.redL} />
              <StatCard label={t('settlementEngine.mismatchedReports')} value={summary?.mismatchedReportsCount ?? 0}          icon="git-compare-outline"       color={C.red}    bg={C.redL} />
            </View>

            {/* ── Dashboard widgets ── */}
            <Text style={styles.sectionLabel}>{t('settlementEngine.liveStatus')}</Text>
            <DashboardWidgets
              overdueObligations={summary?.totalOpenObligations ?? 0}
              unresolvedAlerts={summary?.unresolvedAlerts ?? 0}
              matchedToday={summary?.matchedToday ?? 0}
              mismatchedToday={summary?.mismatchedToday ?? 0}
              totalReconToday={summary?.totalReconToday ?? 0}
            />

            {/* ── Active batches banner ── */}
            {(summary?.openBatchesCount ?? 0) > 0 && (
              <TouchableOpacity
                style={styles.batchBanner}
                onPress={() => {}}
                activeOpacity={0.8}
              >
                <Ionicons name="cube-outline" size={16} color={C.blue} />
                <Text style={styles.batchBannerText}>
                  {summary?.openBatchesCount} {t('settlementEngine.activeBatches')}
                </Text>
                <Ionicons name="arrow-forward" size={14} color={C.blue} />
              </TouchableOpacity>
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

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 16 },
  headerContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.white },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },

  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 32, gap: 12 },
  loadingBox: { paddingVertical: 80, alignItems: 'center' },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.sub,
    textTransform: 'uppercase', letterSpacing: 0.6,
    paddingHorizontal: 2, marginTop: 4,
  },

  // Stat cards
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    backgroundColor: C.white, borderRadius: 12, padding: 14, borderLeftWidth: 3,
    width: '47%', gap: 4,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  statIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800', marginTop: 4 },
  statLabel: { fontSize: 11, color: C.sub, flexWrap: 'wrap' },

  // Dashboard widgets
  widgetsRow: { flexDirection: 'row', gap: 8 },
  widget: {
    flex: 1, backgroundColor: C.white, borderRadius: 12, padding: 12,
    alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: C.border,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1,
  },
  widgetIcon: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  widgetNum: { fontSize: 20, fontWeight: '800' },
  widgetLabel: { fontSize: 9, color: C.sub, textAlign: 'center', fontWeight: '600' },
  reconBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', width: '100%', backgroundColor: C.greyL },
  reconBarFill: { height: 6 },
  reconStat: { fontSize: 12, fontWeight: '700' },

  // Scheduler bar
  schedulerBar: {
    backgroundColor: C.white, borderRadius: 12, padding: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: C.border,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  schedulerBarError: { borderColor: C.red },
  schedulerBarLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  schedulerBarText: { flex: 1, gap: 2 },
  schedulerBarTitle: { fontSize: 13, fontWeight: '600', color: C.text },
  schedulerBarTime: { fontWeight: '400', color: C.sub },
  schedulerBarDetail: { fontSize: 11, color: C.sub },
  schedulerBarError2: { fontSize: 11, color: C.red },
  spin: {},
  runBtn: {
    backgroundColor: C.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 80, justifyContent: 'center',
  },
  runBtnDisabled: { opacity: 0.6 },
  runBtnText: { fontSize: 12, fontWeight: '700', color: C.white },

  // Batch banner
  batchBanner: {
    backgroundColor: C.blueL, borderRadius: 10, padding: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  batchBannerText: { flex: 1, fontSize: 14, color: C.blue, fontWeight: '600' },

  // Nav grid
  navGrid: { gap: 8 },
  navCard: {
    backgroundColor: C.white, borderRadius: 12, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  navIcon: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  navLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: C.text },
});

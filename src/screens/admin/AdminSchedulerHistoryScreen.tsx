/**
 * AdminSchedulerHistoryScreen.tsx
 * ─────────────────────────────────
 * View the full run history of backend settlement cron jobs.
 *
 * Features:
 *   • Filter chips: All | Settlement | Reconciliation | Overdue | Full
 *   • Per-run row: job badge, status badge, timestamp, duration, processed/error counts
 *   • Summary stat cards (total runs, success rate, last run per job type)
 *   • Pull-to-refresh
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
import { useTranslation } from 'react-i18next';
import AdminGuard from '../../components/AdminGuard';
import {
  schedulerHistoryService,
  type SchedulerRunRecord,
  type SchedulerJobName,
} from '../../services/settlement/schedulerHistoryService';

// ─── Constants ────────────────────────────────────────────────────────────────

const C = {
  primary: '#006633',
  white: '#FFFFFF',
  bg: '#F5F5F5',
  text: '#1F2937',
  sub: '#6B7280',
  green: '#10B981',   greenL: '#D1FAE5',
  red: '#EF4444',     redL: '#FEE2E2',
  amber: '#F59E0B',   amberL: '#FEF3C7',
  blue: '#3B82F6',    blueL: '#DBEAFE',
  purple: '#8B5CF6',  purpleL: '#F5F3FF',
  cyan: '#0891B2',    cyanL: '#ECFEFF',
  grey: '#9CA3AF',    greyL: '#F3F4F6',
  border: '#E5E7EB',
  shadow: '#000',
};

type FilterOption = 'all' | SchedulerJobName;

const FILTERS: { key: FilterOption; label: string }[] = [
  { key: 'all',            label: 'All' },
  { key: 'settlement',     label: 'Settlement' },
  { key: 'reconciliation', label: 'Reconciliation' },
  { key: 'overdue',        label: 'Overdue' },
  { key: 'full',           label: 'Full Run' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
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

function jobColor(job: SchedulerJobName): { color: string; bg: string } {
  switch (job) {
    case 'settlement':     return { color: C.blue,   bg: C.blueL };
    case 'reconciliation': return { color: C.purple, bg: C.purpleL };
    case 'overdue':        return { color: C.amber,  bg: C.amberL };
    case 'full':           return { color: C.primary, bg: '#E6F4EE' };
    default:               return { color: C.grey,   bg: C.greyL };
  }
}

function statusColor(status: SchedulerRunRecord['status']): { color: string; bg: string } {
  switch (status) {
    case 'SUCCESS': return { color: C.green, bg: C.greenL };
    case 'PARTIAL': return { color: C.amber, bg: C.amberL };
    case 'FAILED':  return { color: C.red,   bg: C.redL };
    default:        return { color: C.grey,  bg: C.greyL };
  }
}

function jobIcon(job: SchedulerJobName): string {
  switch (job) {
    case 'settlement':     return 'cash-outline';
    case 'reconciliation': return 'git-compare-outline';
    case 'overdue':        return 'warning-outline';
    case 'full':           return 'refresh-circle-outline';
    default:               return 'ellipse-outline';
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatSummaryCard({
  label, value, sub, color, bg,
}: { label: string; value: string | number; sub?: string; color: string; bg: string }) {
  return (
    <View style={[styles.summaryCard, { borderTopColor: color }]}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
      {sub ? <Text style={styles.summarySub}>{sub}</Text> : null}
    </View>
  );
}

function FilterChip({
  label, active, onPress,
}: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function RunRow({ record }: { record: SchedulerRunRecord }) {
  const jc = jobColor(record.job);
  const sc = statusColor(record.status);

  return (
    <View style={styles.runRow}>
      <View style={styles.runRowLeft}>
        {/* Job icon */}
        <View style={[styles.runIcon, { backgroundColor: jc.bg }]}>
          <Ionicons name={jobIcon(record.job) as any} size={16} color={jc.color} />
        </View>

        {/* Details */}
        <View style={styles.runDetails}>
          <View style={styles.runBadgeRow}>
            <View style={[styles.badge, { backgroundColor: jc.bg }]}>
              <Text style={[styles.badgeText, { color: jc.color }]}>
                {record.job.toUpperCase()}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.badgeText, { color: sc.color }]}>{record.status}</Text>
            </View>
            {record.errorCount > 0 && (
              <View style={[styles.badge, { backgroundColor: C.redL }]}>
                <Text style={[styles.badgeText, { color: C.red }]}>
                  {record.errorCount} err
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.runTime}>{formatTime(record.startedAt)}</Text>
          <View style={styles.runMeta}>
            <Text style={styles.runMetaText}>
              {record.processedCount} processed
            </Text>
            <Text style={styles.runMetaDot}>·</Text>
            <Text style={styles.runMetaText}>{formatDuration(record.durationMs)}</Text>
            {record.triggeredBy !== 'cron' && (
              <>
                <Text style={styles.runMetaDot}>·</Text>
                <Text style={[styles.runMetaText, { color: C.primary }]}>
                  {record.triggeredBy}
                </Text>
              </>
            )}
          </View>
        </View>
      </View>

      {/* Trigger indicator */}
      <View style={styles.runRowRight}>
        <Ionicons
          name={record.triggeredBy === 'cron' ? 'time-outline' : 'person-outline'}
          size={13}
          color={C.grey}
        />
      </View>
    </View>
  );
}

// ─── Main Content ─────────────────────────────────────────────────────────────

function AdminSchedulerHistoryContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterOption>('all');
  const [refreshing, setRefreshing] = useState(false);

  const historyQuery = useQuery({
    queryKey: ['schedulerHistory', filter],
    queryFn: () => schedulerHistoryService.getHistory({
      job: filter === 'all' ? undefined : filter,
      limit: 100,
    }),
    staleTime: 30_000,
  });

  const statsQuery = useQuery({
    queryKey: ['schedulerStats'],
    queryFn: () => schedulerHistoryService.getStats(),
    staleTime: 60_000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['schedulerHistory'] });
    await queryClient.invalidateQueries({ queryKey: ['schedulerStats'] });
    setRefreshing(false);
  }, [queryClient]);

  const records = historyQuery.data ?? [];
  const stats = statsQuery.data;
  const loading = historyQuery.isLoading;

  const successRate = stats && stats.totalRuns > 0
    ? Math.round((stats.successCount / stats.totalRuns) * 100)
    : 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerIcon}>
            <Ionicons name="time-outline" size={22} color={C.white} />
          </View>
          <View>
            <Text style={styles.headerTitle}>{t('schedulerHistory.title')}</Text>
            <Text style={styles.headerSub}>{t('schedulerHistory.subtitle')}</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
        }
      >
        {/* Summary cards */}
        {stats && (
          <View style={styles.summaryRow}>
            <StatSummaryCard
              label={t('schedulerHistory.totalRuns')}
              value={stats.totalRuns}
              color={C.primary}
              bg="#E6F4EE"
            />
            <StatSummaryCard
              label={t('schedulerHistory.successRate')}
              value={`${successRate}%`}
              sub={`${stats.successCount}✓ ${stats.partialCount}~ ${stats.failedCount}✗`}
              color={successRate >= 80 ? C.green : successRate >= 50 ? C.amber : C.red}
              bg={successRate >= 80 ? C.greenL : successRate >= 50 ? C.amberL : C.redL}
            />
            <StatSummaryCard
              label={t('schedulerHistory.lastSettlement')}
              value={timeAgo(stats.lastSettlementRun)}
              color={C.blue}
              bg={C.blueL}
            />
            <StatSummaryCard
              label={t('schedulerHistory.lastOverdue')}
              value={timeAgo(stats.lastOverdueRun)}
              color={C.amber}
              bg={C.amberL}
            />
          </View>
        )}

        {/* Schedule info banner */}
        <View style={styles.scheduleBanner}>
          <Ionicons name="information-circle-outline" size={16} color={C.cyan} />
          <Text style={styles.scheduleBannerText}>
            {t('schedulerHistory.scheduleInfo')}
          </Text>
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map(f => (
            <FilterChip
              key={f.key}
              label={f.label}
              active={filter === f.key}
              onPress={() => setFilter(f.key)}
            />
          ))}
        </ScrollView>

        {/* Run list */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {t('schedulerHistory.runLog')}
            {records.length > 0 ? ` (${records.length})` : ''}
          </Text>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={C.primary} />
            </View>
          ) : records.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="time-outline" size={40} color={C.grey} />
              <Text style={styles.emptyText}>{t('schedulerHistory.noRuns')}</Text>
              <Text style={styles.emptySub}>{t('schedulerHistory.noRunsSub')}</Text>
            </View>
          ) : (
            <View style={styles.runList}>
              {records.map(record => (
                <RunRow key={record.runId} record={record} />
              ))}
            </View>
          )}
        </View>

        {/* Legend */}
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>{t('schedulerHistory.legend')}</Text>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: C.green }]} />
            <Text style={styles.legendText}>{t('schedulerHistory.legendSuccess')}</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: C.amber }]} />
            <Text style={styles.legendText}>{t('schedulerHistory.legendPartial')}</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: C.red }]} />
            <Text style={styles.legendText}>{t('schedulerHistory.legendFailed')}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminSchedulerHistoryScreen() {
  return (
    <AdminGuard>
      <AdminSchedulerHistoryContent />
    </AdminGuard>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 16 },
  headerContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.white },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },

  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 32, gap: 12 },

  // Summary cards
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryCard: {
    flex: 1, minWidth: '45%',
    backgroundColor: C.white, borderRadius: 10,
    padding: 12, borderTopWidth: 3,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
    gap: 2,
  },
  summaryValue: { fontSize: 20, fontWeight: '800' },
  summaryLabel: { fontSize: 11, color: C.sub, fontWeight: '600' },
  summarySub: { fontSize: 10, color: C.grey },

  // Schedule banner
  scheduleBanner: {
    backgroundColor: C.cyanL, borderRadius: 10, padding: 10,
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
  },
  scheduleBannerText: { flex: 1, fontSize: 12, color: C.cyan, lineHeight: 18 },

  // Filter chips
  filterRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: C.white,
    borderWidth: 1, borderColor: C.border,
  },
  chipActive: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 13, color: C.text, fontWeight: '500' },
  chipTextActive: { color: C.white, fontWeight: '600' },

  // Section
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.sub,
    textTransform: 'uppercase', letterSpacing: 0.6,
    paddingHorizontal: 2,
  },

  loadingBox: { paddingVertical: 60, alignItems: 'center' },
  emptyBox: { paddingVertical: 48, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: C.text },
  emptySub: { fontSize: 13, color: C.sub, textAlign: 'center' },

  // Run list
  runList: {
    backgroundColor: C.white, borderRadius: 12,
    overflow: 'hidden', borderWidth: 1, borderColor: C.border,
  },
  runRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, borderBottomWidth: 1, borderBottomColor: C.border,
    gap: 10,
  },
  runRowLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  runRowRight: { justifyContent: 'center', alignItems: 'center' },
  runIcon: {
    width: 34, height: 34, borderRadius: 17,
    justifyContent: 'center', alignItems: 'center', marginTop: 2,
  },
  runDetails: { flex: 1, gap: 4 },
  runBadgeRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  badge: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: { fontSize: 10, fontWeight: '700' },
  runTime: { fontSize: 12, color: C.text, fontWeight: '500' },
  runMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  runMetaText: { fontSize: 11, color: C.sub },
  runMetaDot: { fontSize: 11, color: C.grey },

  // Legend
  legend: {
    backgroundColor: C.white, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.border, gap: 6,
  },
  legendTitle: { fontSize: 12, fontWeight: '700', color: C.sub, marginBottom: 2 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: C.text },
});

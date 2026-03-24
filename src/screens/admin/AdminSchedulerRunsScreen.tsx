/**
 * AdminSchedulerRunsScreen.tsx
 * ─────────────────────────────
 * Admin screen for recurring support scheduler run history.
 *
 * Shows:
 *   • Recent RECURRING_SUPPORT scheduler runs (from scheduler_runs)
 *   • Per-run stats: processedCount, successCount, failedCount, duration
 *   • Status badge: SUCCESS / PARTIAL / FAILED
 *   • Tap a run → drill into execution list (scheduled_support_executions)
 *   • Failed executions highlighted with failure reason
 *
 * Pull-to-refresh. All text is i18n-compatible.
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
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';
import type {
  RecurringSupportSchedulerRun,
  ScheduledSupportExecution,
} from '../../services/recurringSupport/scheduledSupportExecutionService';

// ─── Colors ───────────────────────────────────────────────────────────────────

const C = {
  primary: '#006633',
  white: '#FFFFFF',
  bg: '#F5F5F5',
  text: '#1F2937',
  sub: '#6B7280',
  green: '#10B981', greenL: '#D1FAE5',
  red: '#EF4444',   redL: '#FEE2E2',
  amber: '#F59E0B', amberL: '#FEF3C7',
  blue: '#3B82F6',  blueL: '#DBEAFE',
  border: '#E5E7EB',
  shadow: '#000',
  overlay: 'rgba(0,0,0,0.55)',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'SUCCESS' | 'PARTIAL' | 'FAILED' }) {
  const color = status === 'SUCCESS' ? C.green : status === 'PARTIAL' ? C.amber : C.red;
  const bg    = status === 'SUCCESS' ? C.greenL : status === 'PARTIAL' ? C.amberL : C.redL;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{status}</Text>
    </View>
  );
}

// ─── Execution Status Badge ───────────────────────────────────────────────────

function ExecBadge({ status }: { status: 'SUCCESS' | 'FAILED' | 'RETRYING' }) {
  const color = status === 'SUCCESS' ? C.green : status === 'RETRYING' ? C.amber : C.red;
  const bg    = status === 'SUCCESS' ? C.greenL : status === 'RETRYING' ? C.amberL : C.redL;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{status}</Text>
    </View>
  );
}

// ─── Run Card ─────────────────────────────────────────────────────────────────

function RunCard({
  run,
  onPress,
}: {
  run: RecurringSupportSchedulerRun;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.runCard} onPress={onPress} activeOpacity={0.8}>
      {/* Header row */}
      <View style={styles.runCardHeader}>
        <View style={styles.runCardLeft}>
          <Ionicons name="repeat-outline" size={16} color={C.primary} />
          <Text style={styles.runCardTitle} numberOfLines={1}>
            {fmtDate(run.startedAt)}
          </Text>
        </View>
        <StatusBadge status={run.status} />
      </View>

      {/* Stats row */}
      <View style={styles.runStats}>
        <StatPill label="Processed" value={run.processedCount} color={C.blue} bg={C.blueL} />
        <StatPill label="Success" value={run.successCount} color={C.green} bg={C.greenL} />
        <StatPill
          label="Failed"
          value={run.failedCount}
          color={run.failedCount > 0 ? C.red : C.green}
          bg={run.failedCount > 0 ? C.redL : C.greenL}
        />
        <StatPill label="Duration" value={fmtDuration(run.durationMs)} color={C.sub} bg={C.border} />
      </View>

      {/* Trigger */}
      <View style={styles.runMeta}>
        <Ionicons name="flash-outline" size={11} color={C.sub} />
        <Text style={styles.runMetaText}>{run.triggeredBy} · {fmtDate(run.finishedAt)}</Text>
      </View>

      {/* Error preview */}
      {run.errors && run.errors.length > 0 && (
        <View style={styles.errorPreview}>
          <Ionicons name="warning-outline" size={12} color={C.red} />
          <Text style={styles.errorPreviewText} numberOfLines={1}>
            {run.errors[0].reason}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function StatPill({ label, value, color, bg }: {
  label: string; value: number | string; color: string; bg: string;
}) {
  return (
    <View style={[styles.statPill, { backgroundColor: bg }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Run Detail Modal ─────────────────────────────────────────────────────────

function RunDetailModal({
  run,
  onClose,
}: {
  run: RecurringSupportSchedulerRun;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const detailQuery = useQuery({
    queryKey: ['schedulerRunDetail', run.runId],
    queryFn: () => adminService.getSchedulerRunDetails(run.runId),
    staleTime: 30_000,
  });

  const executions = detailQuery.data ?? [];
  const failed = executions.filter(e => e.status === 'FAILED');
  const succeeded = executions.filter(e => e.status === 'SUCCESS');

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>{t('schedulerRuns.runDetail')}</Text>
              <Text style={styles.modalSub}>{fmtDate(run.startedAt)}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={C.text} />
            </TouchableOpacity>
          </View>

          {/* Summary */}
          <View style={styles.modalSummary}>
            <StatusBadge status={run.status} />
            <Text style={styles.summaryDetail}>
              {run.processedCount} processed · {run.successCount} ok · {run.failedCount} failed · {fmtDuration(run.durationMs)}
            </Text>
          </View>

          {detailQuery.isLoading ? (
            <ActivityIndicator color={C.primary} style={{ marginTop: 24 }} />
          ) : (
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {/* Failed executions */}
              {failed.length > 0 && (
                <>
                  <Text style={styles.execSectionLabel}>{t('schedulerRuns.failedExecutions')} ({failed.length})</Text>
                  {failed.map(exec => (
                    <ExecutionItem key={exec.executionId} exec={exec} />
                  ))}
                </>
              )}

              {/* Successful executions */}
              {succeeded.length > 0 && (
                <>
                  <Text style={styles.execSectionLabel}>{t('schedulerRuns.successExecutions')} ({succeeded.length})</Text>
                  {succeeded.map(exec => (
                    <ExecutionItem key={exec.executionId} exec={exec} />
                  ))}
                </>
              )}

              {executions.length === 0 && (
                <Text style={styles.emptyDetail}>{t('schedulerRuns.noExecutions')}</Text>
              )}

              {/* Run-level errors */}
              {run.errors && run.errors.length > 0 && (
                <>
                  <Text style={styles.execSectionLabel}>{t('schedulerRuns.runErrors')}</Text>
                  {run.errors.map((err, idx) => (
                    <View key={idx} style={styles.runErrorItem}>
                      <Text style={styles.runErrorSchedule}>{err.scheduleId}</Text>
                      <Text style={styles.runErrorReason}>{err.reason}</Text>
                    </View>
                  ))}
                </>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ExecutionItem({ exec }: { exec: ScheduledSupportExecution }) {
  return (
    <View style={styles.execItem}>
      <View style={styles.execItemHeader}>
        <Text style={styles.execMemberName} numberOfLines={1}>{exec.memberName || exec.familyMemberId}</Text>
        <ExecBadge status={exec.status} />
      </View>
      <Text style={styles.execMeta}>
        {exec.currency} {exec.amount.toLocaleString()} · {exec.payoutMethod} · {fmtDate(exec.executedAt)}
      </Text>
      {exec.txId && (
        <Text style={styles.execTxId}>Tx: {exec.txId}</Text>
      )}
      {exec.failureReason && (
        <Text style={styles.execError}>{exec.failureReason}</Text>
      )}
    </View>
  );
}

// ─── Main Content ─────────────────────────────────────────────────────────────

function AdminSchedulerRunsContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RecurringSupportSchedulerRun | null>(null);

  const runsQuery = useQuery({
    queryKey: ['recurringSchedulerRuns'],
    queryFn: () => adminService.getSchedulerRuns(),
    staleTime: 30_000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['recurringSchedulerRuns'] });
    setRefreshing(false);
  }, [queryClient]);

  const runs = runsQuery.data ?? [];

  // ── Summary stats ──
  const total      = runs.length;
  const successful = runs.filter(r => r.status === 'SUCCESS').length;
  const partial    = runs.filter(r => r.status === 'PARTIAL').length;
  const failed     = runs.filter(r => r.status === 'FAILED').length;
  const totalProcessed = runs.reduce((acc, r) => acc + r.processedCount, 0);
  const totalFailed    = runs.reduce((acc, r) => acc + r.failedCount, 0);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerIcon}>
            <Ionicons name="repeat-outline" size={22} color={C.white} />
          </View>
          <View>
            <Text style={styles.headerTitle}>{t('schedulerRuns.title')}</Text>
            <Text style={styles.headerSub}>{t('schedulerRuns.subtitle')}</Text>
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
        {runsQuery.isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : (
          <>
            {/* Summary Cards */}
            <View style={styles.summaryRow}>
              <SummaryCard label={t('schedulerRuns.totalRuns')} value={total} color={C.blue} bg={C.blueL} icon="list-outline" />
              <SummaryCard label={t('schedulerRuns.successful')} value={successful} color={C.green} bg={C.greenL} icon="checkmark-circle-outline" />
              <SummaryCard label={t('schedulerRuns.failed')} value={failed + partial} color={failed > 0 ? C.red : C.amber} bg={failed > 0 ? C.redL : C.amberL} icon="warning-outline" />
            </View>
            <View style={styles.summaryRow}>
              <SummaryCard label={t('schedulerRuns.totalProcessed')} value={totalProcessed} color={C.primary} bg='#ECFDF5' icon="people-outline" />
              <SummaryCard label={t('schedulerRuns.totalFailed')} value={totalFailed} color={totalFailed > 0 ? C.red : C.green} bg={totalFailed > 0 ? C.redL : C.greenL} icon="close-circle-outline" />
            </View>

            {/* Run List */}
            <Text style={styles.sectionLabel}>{t('schedulerRuns.recentRuns')}</Text>

            {runs.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="repeat-outline" size={40} color={C.border} />
                <Text style={styles.emptyText}>{t('schedulerRuns.noRuns')}</Text>
                <Text style={styles.emptySub}>{t('schedulerRuns.noRunsHint')}</Text>
              </View>
            ) : (
              runs.map(run => (
                <RunCard
                  key={run.runId}
                  run={run}
                  onPress={() => setSelectedRun(run)}
                />
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Run Detail Modal */}
      {selectedRun && (
        <RunDetailModal
          run={selectedRun}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </SafeAreaView>
  );
}

function SummaryCard({ label, value, color, bg, icon }: {
  label: string; value: number | string; color: string; bg: string; icon: string;
}) {
  return (
    <View style={[styles.summaryCard, { borderLeftColor: color }]}>
      <View style={[styles.summaryIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={16} color={color} />
      </View>
      <View style={styles.summaryText}>
        <Text style={[styles.summaryValue, { color }]}>{value}</Text>
        <Text style={styles.summaryLabel}>{label}</Text>
      </View>
    </View>
  );
}

export default function AdminSchedulerRunsScreen() {
  return (
    <AdminGuard>
      <AdminSchedulerRunsContent />
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
  loadingBox: { paddingVertical: 80, alignItems: 'center' },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.sub,
    textTransform: 'uppercase', letterSpacing: 0.6,
    paddingHorizontal: 2,
  },

  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryCard: {
    flex: 1, backgroundColor: C.white, borderRadius: 10, padding: 10,
    borderLeftWidth: 3,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  summaryIcon: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  summaryText: { flex: 1 },
  summaryValue: { fontSize: 18, fontWeight: '800' },
  summaryLabel: { fontSize: 10, color: C.sub, marginTop: 1 },

  // Run card
  runCard: {
    backgroundColor: C.white, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border, gap: 8,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  runCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  runCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  runCardTitle: { fontSize: 14, fontWeight: '600', color: C.text, flex: 1 },

  runStats: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  statPill: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    alignItems: 'center',
  },
  statValue: { fontSize: 13, fontWeight: '700' },
  statLabel: { fontSize: 9, color: C.sub, marginTop: 1 },

  runMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  runMetaText: { fontSize: 11, color: C.sub },

  errorPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.redL, borderRadius: 6, padding: 6,
  },
  errorPreviewText: { fontSize: 11, color: C.red, flex: 1 },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 },
  badgeText: { fontSize: 10, fontWeight: '700' },

  // Empty state
  emptyBox: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyText: { fontSize: 15, fontWeight: '600', color: C.text },
  emptySub: { fontSize: 12, color: C.sub, textAlign: 'center' },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: C.overlay,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: C.white, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 16, paddingHorizontal: 16, paddingBottom: 32,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  modalSub: { fontSize: 12, color: C.sub, marginTop: 2 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center',
  },
  modalSummary: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.bg, borderRadius: 10, padding: 10, marginBottom: 12,
  },
  summaryDetail: { fontSize: 12, color: C.sub, flex: 1 },
  modalScroll: { flex: 1 },

  execSectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.sub,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 12, marginBottom: 6,
  },
  execItem: {
    backgroundColor: C.bg, borderRadius: 10, padding: 12,
    marginBottom: 8, gap: 4, borderWidth: 1, borderColor: C.border,
  },
  execItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  execMemberName: { fontSize: 13, fontWeight: '600', color: C.text, flex: 1 },
  execMeta: { fontSize: 11, color: C.sub },
  execTxId: { fontSize: 10, color: C.blue, fontFamily: 'monospace' },
  execError: { fontSize: 11, color: C.red, fontWeight: '500' },

  emptyDetail: { textAlign: 'center', color: C.sub, padding: 24, fontSize: 13 },
  runErrorItem: {
    backgroundColor: C.redL, borderRadius: 8, padding: 10, marginBottom: 6, gap: 2,
  },
  runErrorSchedule: { fontSize: 11, color: C.red, fontFamily: 'monospace' },
  runErrorReason: { fontSize: 12, color: C.text },
});

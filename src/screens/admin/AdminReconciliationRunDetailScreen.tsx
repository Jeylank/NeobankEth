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
import { useRoute, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';
import type { ReconciliationItem } from '../../services/reconciliation/reconciliationTypes';

const COLORS = {
  primary: '#006633',
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#1F2937',
  textSecondary: '#6B7280',
  green: '#10B981',
  greenLight: '#D1FAE5',
  blue: '#3B82F6',
  blueLight: '#DBEAFE',
  red: '#EF4444',
  redLight: '#FEE2E2',
  amber: '#F59E0B',
  amberLight: '#FEF3C7',
  purple: '#8B5CF6',
  purpleLight: '#F5F3FF',
  border: '#E5E7EB',
  greyLight: '#F3F4F6',
};

const RESULT_CONFIG: Record<
  string,
  { color: string; bg: string; icon: string; label: string }
> = {
  matched: { color: COLORS.green, bg: COLORS.greenLight, icon: 'checkmark-circle', label: 'Matched' },
  amount_mismatch: { color: COLORS.red, bg: COLORS.redLight, icon: 'cash-outline', label: 'Amount Mismatch' },
  status_mismatch: { color: COLORS.amber, bg: COLORS.amberLight, icon: 'sync-outline', label: 'Status Mismatch' },
  missing_external: { color: COLORS.red, bg: COLORS.redLight, icon: 'cloud-offline-outline', label: 'Missing External' },
  missing_internal: { color: COLORS.amber, bg: COLORS.amberLight, icon: 'search-outline', label: 'Missing Internal' },
  duplicate: { color: COLORS.purple, bg: COLORS.purpleLight, icon: 'copy-outline', label: 'Duplicate' },
  reservation_stale: { color: COLORS.amber, bg: COLORS.amberLight, icon: 'time-outline', label: 'Stale Reservation' },
  settlement_overdue: { color: COLORS.red, bg: COLORS.redLight, icon: 'hourglass-outline', label: 'Settlement Overdue' },
  ledger_inconsistency: { color: COLORS.red, bg: COLORS.redLight, icon: 'git-branch-outline', label: 'Ledger Inconsistency' },
};

type FilterResult = 'all' | 'matched' | 'issues';

function ItemCard({ item }: { item: ReconciliationItem }) {
  const config = RESULT_CONFIG[item.result] ?? RESULT_CONFIG.matched;

  return (
    <View style={[styles.itemCard, item.result !== 'matched' && styles.itemCardIssue]}>
      <View style={styles.itemHeader}>
        <View style={[styles.itemIcon, { backgroundColor: config.bg }]}>
          <Ionicons name={config.icon as any} size={14} color={config.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTxId} numberOfLines={1}>TX: {item.txId}</Text>
          <Text style={styles.itemProvider}>{item.provider} · {item.providerRef || '—'}</Text>
        </View>
        <View style={[styles.resultBadge, { backgroundColor: config.bg }]}>
          <Text style={[styles.resultText, { color: config.color }]}>{config.label}</Text>
        </View>
      </View>

      <View style={styles.amountRow}>
        <View style={styles.amountBlock}>
          <Text style={styles.amountLabel}>Internal</Text>
          <Text style={styles.amountValue}>
            {item.internalAmount.toLocaleString()} {item.currency}
          </Text>
          <Text style={styles.amountStatus}>{item.internalStatus || '—'}</Text>
        </View>
        <Ionicons
          name={item.result === 'matched' ? 'checkmark' : 'close'}
          size={18}
          color={item.result === 'matched' ? COLORS.green : COLORS.red}
        />
        <View style={[styles.amountBlock, { alignItems: 'flex-end' }]}>
          <Text style={styles.amountLabel}>External</Text>
          <Text style={styles.amountValue}>
            {item.externalAmount.toLocaleString()} {item.currency}
          </Text>
          <Text style={styles.amountStatus}>{item.externalStatus || '—'}</Text>
        </View>
      </View>

      {item.notes && (
        <View style={styles.notesBox}>
          <Ionicons name="information-circle-outline" size={13} color={COLORS.textSecondary} />
          <Text style={styles.notesText}>{item.notes}</Text>
        </View>
      )}
    </View>
  );
}

function AdminReconciliationRunDetailContent() {
  const { t } = useTranslation();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { runId } = route.params as { runId: string };
  const [filter, setFilter] = useState<FilterResult>('all');
  const [refreshing, setRefreshing] = useState(false);

  const { data: summary } = useQuery({
    queryKey: ['reconciliation-summary', runId],
    queryFn: () => adminService.getReconciliationRunSummary(runId),
  });

  const { data: items = [], isLoading } = useQuery<ReconciliationItem[]>({
    queryKey: ['reconciliation-items', runId],
    queryFn: () => adminService.getReconciliationItems(runId),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['reconciliation-summary', runId] }),
      queryClient.invalidateQueries({ queryKey: ['reconciliation-items', runId] }),
    ]);
    setRefreshing(false);
  }, [queryClient, runId]);

  const filtered = items.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'matched') return item.result === 'matched';
    return item.result !== 'matched';
  });

  const issueCount = items.filter((i) => i.result !== 'matched').length;
  const matchCount = items.filter((i) => i.result === 'matched').length;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Run ID header */}
        <View style={styles.headerCard}>
          <Text style={styles.headerRunId}>{runId}</Text>
          {summary && (
            <View style={styles.headerMeta}>
              <Text style={styles.headerMetaText}>{summary.status?.toUpperCase()}</Text>
              <Text style={styles.headerMetaText}>·</Text>
              <Text style={styles.headerMetaText}>
                {summary.completedAt
                  ? new Date(summary.completedAt).toLocaleString()
                  : t('reconciliation.running')}
              </Text>
            </View>
          )}
        </View>

        {/* Summary cards */}
        {summary && (
          <View style={styles.summaryGrid}>
            {[
              { label: t('reconciliation.checked'), value: summary.totalChecked, color: COLORS.blue, bg: COLORS.blueLight },
              { label: t('reconciliation.matched'), value: summary.totalMatched, color: COLORS.green, bg: COLORS.greenLight },
              { label: t('reconciliation.mismatched'), value: summary.totalMismatched, color: COLORS.amber, bg: COLORS.amberLight },
              { label: t('reconciliation.openAlerts'), value: summary.openAlerts, color: COLORS.red, bg: COLORS.redLight },
            ].map((s) => (
              <View key={s.label} style={[styles.summaryCard, { borderTopColor: s.color }]}>
                <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.summaryLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Filter tabs */}
        <View style={styles.filterRow}>
          {[
            { key: 'all' as FilterResult, label: `${t('reconciliation.all')} (${items.length})` },
            { key: 'issues' as FilterResult, label: `${t('reconciliation.issues')} (${issueCount})` },
            { key: 'matched' as FilterResult, label: `${t('reconciliation.matched')} (${matchCount})` },
          ].map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.filterTab, filter === tab.key && styles.filterTabActive]}
              onPress={() => setFilter(tab.key)}
            >
              <Text style={[styles.filterTabText, filter === tab.key && styles.filterTabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Item list */}
        {isLoading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-circle-outline" size={40} color={COLORS.textSecondary} />
            <Text style={styles.emptyText}>{t('reconciliation.noItems')}</Text>
          </View>
        ) : (
          filtered.map((item) => <ItemCard key={item.itemId} item={item} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminReconciliationRunDetailScreen() {
  return (
    <AdminGuard>
      <AdminReconciliationRunDetailContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  headerCard: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  headerRunId: { fontSize: 15, fontWeight: '700', color: COLORS.white, fontFamily: 'monospace' },
  headerMeta: { flexDirection: 'row', gap: 6, marginTop: 4 },
  headerMetaText: { fontSize: 11, color: 'rgba(255,255,255,0.75)' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  summaryCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
    borderTopWidth: 2,
    alignItems: 'center',
  },
  summaryValue: { fontSize: 22, fontWeight: '700' },
  summaryLabel: { fontSize: 10, color: COLORS.textSecondary, marginTop: 2, textAlign: 'center' },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: COLORS.greyLight,
  },
  filterTabActive: { backgroundColor: COLORS.primary },
  filterTabText: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '500' },
  filterTabTextActive: { color: COLORS.white, fontWeight: '700' },
  itemCard: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  itemCardIssue: { borderLeftWidth: 3, borderLeftColor: COLORS.amber },
  itemHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  itemIcon: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  itemTxId: { fontSize: 12, fontWeight: '700', color: COLORS.text },
  itemProvider: { fontSize: 10, color: COLORS.textSecondary, marginTop: 1 },
  resultBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  resultText: { fontSize: 9, fontWeight: '700' },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 8,
  },
  amountBlock: { flex: 1 },
  amountLabel: { fontSize: 10, color: COLORS.textSecondary },
  amountValue: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  amountStatus: { fontSize: 10, color: COLORS.textSecondary, marginTop: 1 },
  notesBox: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: COLORS.greyLight,
    borderRadius: 6,
    padding: 8,
  },
  notesText: { flex: 1, fontSize: 11, color: COLORS.textSecondary, lineHeight: 16 },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 13, color: COLORS.textSecondary, marginTop: 10 },
});

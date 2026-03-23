/**
 * AdminSettlementReconciliationScreen.tsx
 * ──────────────────────────────────────────
 * Shows settlement reconciliation reports comparing partner-reported amounts
 * vs internal obligation sums. Color-coded by MATCHED / MISMATCH / PENDING.
 */

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
import type {
  SettlementReconciliationReport,
  SettlementReconciliationStatus,
} from '../../services/settlement/settlementTypes';

const C = {
  primary: '#006633',
  white: '#FFFFFF',
  bg: '#F5F5F5',
  text: '#1F2937',
  sub: '#6B7280',
  green: '#10B981',  greenL: '#D1FAE5',
  red: '#EF4444',    redL: '#FEE2E2',
  amber: '#F59E0B',  amberL: '#FEF3C7',
  blue: '#3B82F6',   blueL: '#DBEAFE',
  grey: '#9CA3AF',   greyL: '#F3F4F6',
  border: '#E5E7EB',
  shadow: '#000',
};

const STATUS_CFG: Record<SettlementReconciliationStatus, { bg: string; color: string; icon: string }> = {
  MATCHED:  { bg: C.greenL,  color: C.green,  icon: 'checkmark-circle-outline' },
  MISMATCH: { bg: C.redL,    color: C.red,    icon: 'alert-circle-outline' },
  PENDING:  { bg: C.amberL,  color: C.amber,  icon: 'time-outline' },
};

type Filter = 'ALL' | SettlementReconciliationStatus;

function formatETB(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(3)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(2)}k`;
  return n.toLocaleString();
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function ReportCard({ report }: { report: SettlementReconciliationReport }) {
  const { t } = useTranslation();
  const cfg = STATUS_CFG[report.status] ?? STATUS_CFG.PENDING;
  const isMismatch = report.status === 'MISMATCH';
  const diffColor = report.difference === 0 ? C.green : report.difference > 0 ? C.blue : C.red;

  return (
    <View style={[styles.card, isMismatch && styles.cardMismatch]}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Text style={styles.provider}>{report.provider}</Text>
          <Text style={styles.dateText}>{formatDate(report.date)}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{report.status}</Text>
        </View>
      </View>

      {/* Amounts comparison */}
      <View style={styles.amountsRow}>
        <View style={styles.amountCol}>
          <Text style={styles.amountLabel}>{t('settlementEngine.expectedAmount')}</Text>
          <Text style={[styles.amountValue, { color: C.blue }]}>
            {formatETB(report.expectedAmount)} {report.currency}
          </Text>
        </View>
        <Ionicons name="swap-horizontal-outline" size={20} color={C.sub} />
        <View style={styles.amountCol}>
          <Text style={styles.amountLabel}>{t('settlementEngine.reportedAmount')}</Text>
          <Text style={[styles.amountValue, { color: isMismatch ? C.red : C.green }]}>
            {formatETB(report.reportedAmount)} {report.currency}
          </Text>
        </View>
      </View>

      {/* Difference */}
      <View style={[styles.diffRow, { backgroundColor: isMismatch ? C.redL : C.greenL }]}>
        <Ionicons
          name={report.difference === 0 ? 'checkmark-circle-outline' : 'alert-circle-outline'}
          size={15}
          color={diffColor}
        />
        <Text style={styles.diffLabel}>{t('settlementEngine.difference')}</Text>
        <Text style={[styles.diffValue, { color: diffColor }]}>
          {report.difference >= 0 ? '+' : ''}{formatETB(report.difference)} {report.currency}
        </Text>
      </View>

      <Text style={styles.createdAt}>{t('settlementEngine.created')}: {formatDate(report.createdAt)}</Text>
    </View>
  );
}

function AdminSettlementReconciliationContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [refreshing, setRefreshing] = useState(false);

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['settlement-reconciliation', filter],
    queryFn: () => adminService.getSettlementReconciliation(filter === 'ALL' ? {} : { status: filter as SettlementReconciliationStatus }),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['settlement-reconciliation'] });
    setRefreshing(false);
  }, [queryClient]);

  const mismatchCount = reports.filter((r) => r.status === 'MISMATCH').length;
  const matchedCount  = reports.filter((r) => r.status === 'MATCHED').length;
  const filters: Filter[] = ['ALL', 'MATCHED', 'MISMATCH', 'PENDING'];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerIcon}>
            <Ionicons name="git-compare-outline" size={20} color={C.white} />
          </View>
          <View>
            <Text style={styles.headerTitle}>{t('settlementEngine.reconciliation')}</Text>
            <Text style={styles.headerSub}>
              {matchedCount} {t('settlementEngine.matched')} · {mismatchCount} {t('settlementEngine.mismatched')}
            </Text>
          </View>
        </View>
      </View>

      {/* Filter tabs */}
      <View style={styles.tabRow}>
        {filters.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.tab, filter === f && styles.tabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {/* Summary row */}
        {reports.length > 0 && !isLoading && (
          <View style={styles.summaryRow}>
            <View style={[styles.summaryChip, { backgroundColor: C.greenL }]}>
              <Text style={[styles.summaryChipText, { color: C.green }]}>{matchedCount} {t('settlementEngine.matched')}</Text>
            </View>
            <View style={[styles.summaryChip, { backgroundColor: C.redL }]}>
              <Text style={[styles.summaryChipText, { color: C.red }]}>{mismatchCount} {t('settlementEngine.mismatched')}</Text>
            </View>
          </View>
        )}

        {isLoading ? (
          <View style={styles.loadingBox}><ActivityIndicator size="large" color={C.primary} /></View>
        ) : reports.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="document-outline" size={48} color={C.border} />
            <Text style={styles.emptyText}>{t('settlementEngine.noReports')}</Text>
          </View>
        ) : (
          reports.map((r) => <ReportCard key={r.reportId} report={r} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminSettlementReconciliationScreen() {
  return (
    <AdminGuard>
      <AdminSettlementReconciliationContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 14 },
  headerContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.white },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  tabRow: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.border, flexWrap: 'wrap' },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: C.greyL },
  tabActive: { backgroundColor: C.primary },
  tabText: { fontSize: 12, color: C.sub, fontWeight: '600' },
  tabTextActive: { color: C.white },
  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 32, gap: 10 },
  loadingBox: { paddingVertical: 80, alignItems: 'center' },
  emptyBox: { paddingVertical: 60, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: C.sub },
  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  summaryChipText: { fontSize: 13, fontWeight: '700' },
  card: {
    backgroundColor: C.white, borderRadius: 12, overflow: 'hidden',
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardMismatch: { borderWidth: 1, borderColor: C.red },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  cardHeaderLeft: { gap: 3 },
  provider: { fontSize: 15, fontWeight: '700', color: C.text },
  dateText: { fontSize: 12, color: C.sub },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusText: { fontSize: 11, fontWeight: '700' },
  amountsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 14 },
  amountCol: { flex: 1, gap: 4 },
  amountLabel: { fontSize: 10, color: C.sub, textTransform: 'uppercase' },
  amountValue: { fontSize: 15, fontWeight: '800' },
  diffRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  diffLabel: { flex: 1, fontSize: 13, color: C.text, fontWeight: '500' },
  diffValue: { fontSize: 14, fontWeight: '800' },
  createdAt: { fontSize: 11, color: C.sub, padding: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
});

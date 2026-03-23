/**
 * AdminReconciliationScreen.tsx
 * ──────────────────────────────
 * Shows daily reconciliation reports from partnerSettlementService.
 * Uses adminService.getReconciliationReports().
 *
 * Features:
 *  - Provider filter tabs (ALL / CHAPA / TELEBIRR / BANK)
 *  - Report cards with match/mismatch counts, net settlement
 *  - Expandable discrepancy list per report
 *  - Mini bar chart: mismatch count by day (last 7 reports)
 */

import React, { useState, useCallback, useMemo } from 'react';
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
import type { ReconciliationReport, ReconciliationDiscrepancy } from '../../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const C = {
  primary: '#006633',
  primaryLight: '#E8F5E9',
  white: '#FFFFFF',
  bg: '#F5F5F5',
  text: '#1F2937',
  sub: '#6B7280',
  green: '#10B981',
  greenL: '#D1FAE5',
  red: '#EF4444',
  redL: '#FEE2E2',
  blue: '#3B82F6',
  blueL: '#DBEAFE',
  amber: '#F59E0B',
  amberL: '#FEF3C7',
  purple: '#8B5CF6',
  purpleL: '#F5F3FF',
  border: '#E5E7EB',
  shadow: '#000',
};

type ProviderFilter = 'ALL' | 'CHAPA' | 'TELEBIRR' | 'BANK';
type DateFilter = '7d' | '30d';

const ISSUE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  AMOUNT_MISMATCH:      { label: 'Amount Mismatch',      color: C.red,    bg: C.redL,    icon: 'alert-circle-outline' },
  MISSING_TRANSACTION:  { label: 'Missing Transaction',   color: C.amber,  bg: C.amberL,  icon: 'help-circle-outline' },
  DUPLICATE_TRANSACTION:{ label: 'Duplicate Transaction', color: C.purple, bg: C.purpleL, icon: 'copy-outline' },
  STATUS_MISMATCH:      { label: 'Status Mismatch',       color: C.blue,   bg: C.blueL,   icon: 'swap-horizontal-outline' },
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function formatETB(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function maskTxId(txId: string): string {
  if (!txId || txId.length <= 8) return txId;
  return txId.slice(0, 6) + '…' + txId.slice(-4);
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function matchRate(report: ReconciliationReport): number {
  if (!report.totalTransactions) return 100;
  return Math.round((report.matched / report.totalTransactions) * 100);
}

function matchRateColor(rate: number): string {
  if (rate >= 98) return C.green;
  if (rate >= 90) return C.amber;
  return C.red;
}

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────

function ProviderFilterTabs({
  active,
  onChange,
}: {
  active: ProviderFilter;
  onChange: (f: ProviderFilter) => void;
}) {
  const { t } = useTranslation();
  const tabs: ProviderFilter[] = ['ALL', 'CHAPA', 'TELEBIRR', 'BANK'];

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabRow}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab}
          style={[styles.tab, active === tab && styles.tabActive]}
          onPress={() => onChange(tab)}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, active === tab && styles.tabTextActive]}>
            {tab === 'ALL' ? t('reconciliationReports.all') : tab}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function DateFilterRow({
  active,
  onChange,
}: {
  active: DateFilter;
  onChange: (d: DateFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.dateRow}>
      <Ionicons name="calendar-outline" size={15} color={C.sub} />
      <TouchableOpacity
        style={[styles.dateChip, active === '7d' && styles.dateChipActive]}
        onPress={() => onChange('7d')}
      >
        <Text style={[styles.dateChipText, active === '7d' && styles.dateChipTextActive]}>
          {t('reconciliationReports.last7Days')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.dateChip, active === '30d' && styles.dateChipActive]}
        onPress={() => onChange('30d')}
      >
        <Text style={[styles.dateChipText, active === '30d' && styles.dateChipTextActive]}>
          {t('reconciliationReports.last30Days')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function MismatchChart({ reports }: { reports: ReconciliationReport[] }) {
  const { t } = useTranslation();
  // Show last 7 reports
  const slice = reports.slice(0, 7).reverse();
  const maxMismatch = Math.max(...slice.map((r) => r.mismatched), 1);

  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>{t('reconciliationReports.mismatchByDay')}</Text>
      <View style={styles.chartArea}>
        {slice.map((r, i) => {
          const pct = (r.mismatched / maxMismatch) * 100;
          const barColor = r.mismatched === 0 ? C.green : r.mismatched < 5 ? C.amber : C.red;
          return (
            <View key={r.reportId + i} style={styles.chartCol}>
              <Text style={styles.chartBarValue}>{r.mismatched}</Text>
              <View style={styles.chartBarTrack}>
                <View
                  style={[
                    styles.chartBarFill,
                    { height: `${Math.max(pct, 4)}%` as any, backgroundColor: barColor },
                  ]}
                />
              </View>
              <Text style={styles.chartBarLabel}>
                {r.date ? r.date.slice(5) : `R${i + 1}`}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function DiscrepancyItem({ d }: { d: ReconciliationDiscrepancy }) {
  const { t } = useTranslation();
  const cfg = ISSUE_CONFIG[d.issue] ?? { label: d.issue, color: C.sub, bg: C.bg, icon: 'alert-outline' };
  const issueI18nKey = `reconciliationReports.issueCode.${d.issue}`;

  return (
    <View style={[styles.discItem, { borderLeftColor: cfg.color }]}>
      <View style={styles.discHeader}>
        <View style={[styles.issueBadge, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon as any} size={12} color={cfg.color} />
          <Text style={[styles.issueBadgeText, { color: cfg.color }]}>
            {t(issueI18nKey, cfg.label)}
          </Text>
        </View>
        {d.txId ? (
          <Text style={styles.discTxId}>{maskTxId(d.txId)}</Text>
        ) : null}
      </View>

      {(d.internalAmount !== undefined || d.providerAmount !== undefined) && (
        <View style={styles.discAmountRow}>
          <View style={styles.discAmountCol}>
            <Text style={styles.discAmountLabel}>{t('reconciliationReports.internalAmount')}</Text>
            <Text style={[styles.discAmountValue, { color: C.blue }]}>
              {d.internalAmount !== undefined ? formatETB(d.internalAmount) : '—'}
            </Text>
          </View>
          <Ionicons name="swap-horizontal-outline" size={16} color={C.sub} />
          <View style={styles.discAmountCol}>
            <Text style={styles.discAmountLabel}>{t('reconciliationReports.providerAmount')}</Text>
            <Text style={[styles.discAmountValue, { color: C.red }]}>
              {d.providerAmount !== undefined ? formatETB(d.providerAmount) : '—'}
            </Text>
          </View>
        </View>
      )}

      {(d.internalStatus || d.providerStatus) && (
        <View style={styles.discStatusRow}>
          <Text style={styles.discStatusLabel}>{t('reconciliationReports.internalStatus')}: </Text>
          <Text style={styles.discStatusValue}>{d.internalStatus ?? '—'}</Text>
          <Text style={styles.discStatusLabel}> → {t('reconciliationReports.providerStatus')}: </Text>
          <Text style={[styles.discStatusValue, { color: C.amber }]}>{d.providerStatus ?? '—'}</Text>
        </View>
      )}

      {d.notes ? (
        <Text style={styles.discNotes}>{d.notes}</Text>
      ) : null}
    </View>
  );
}

function ReportCard({ report }: { report: ReconciliationReport }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const rate = matchRate(report);
  const rateColor = matchRateColor(rate);
  const isPositiveNet = report.netSettlement >= 0;

  return (
    <View style={styles.card}>
      {/* ── Top row ── */}
      <View style={styles.cardTop}>
        <View style={styles.cardTopLeft}>
          <Text style={styles.reportProvider}>{report.provider}</Text>
          <Text style={styles.reportDate}>{formatDate(report.date)}</Text>
        </View>
        {/* Match rate badge */}
        <View style={[styles.rateBadge, { borderColor: rateColor }]}>
          <Text style={[styles.rateBadgeText, { color: rateColor }]}>{rate}% {t('reconciliationReports.matched')}</Text>
        </View>
      </View>

      {/* ── Stats row ── */}
      <View style={styles.statsRow}>
        <StatPill icon="checkmark-circle-outline" color={C.green} bg={C.greenL} value={report.matched} label={t('reconciliationReports.matched')} />
        <StatPill icon="close-circle-outline" color={C.red} bg={C.redL} value={report.mismatched} label={t('reconciliationReports.mismatched')} />
        <StatPill icon="warning-outline" color={C.amber} bg={C.amberL} value={report.discrepancies?.length ?? 0} label={t('reconciliationReports.discrepancies')} />
        <StatPill icon="list-outline" color={C.blue} bg={C.blueL} value={report.totalTransactions} label={t('reconciliationReports.totalTransactions')} />
      </View>

      {/* ── Net settlement row ── */}
      <View style={styles.netSettlementRow}>
        <Text style={styles.netSettlementLabel}>{t('reconciliationReports.netSettlement')}</Text>
        <Text style={[styles.netSettlementValue, { color: isPositiveNet ? C.green : C.red }]}>
          {formatETB(report.netSettlement)} {report.currency ?? 'ETB'}
        </Text>
      </View>

      {/* ── Expand for discrepancies ── */}
      {(report.discrepancies?.length ?? 0) > 0 && (
        <TouchableOpacity
          style={styles.expandRow}
          onPress={() => setExpanded((p) => !p)}
          activeOpacity={0.7}
        >
          <Ionicons name="alert-circle-outline" size={15} color={C.red} />
          <Text style={styles.expandLabel}>
            {expanded
              ? t('reconciliationReports.collapseDetails')
              : `${t('reconciliationReports.viewDetails')} (${report.discrepancies.length})`}
          </Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={C.sub} />
        </TouchableOpacity>
      )}

      {expanded && (
        <View style={styles.discList}>
          {report.discrepancies.map((d, i) => (
            <DiscrepancyItem key={d.txId + i} d={d} />
          ))}
        </View>
      )}

      {(report.discrepancies?.length ?? 0) === 0 && (
        <View style={styles.noDiscRow}>
          <Ionicons name="checkmark-circle-outline" size={15} color={C.green} />
          <Text style={styles.noDiscText}>{t('reconciliationReports.noDiscrepancies')}</Text>
        </View>
      )}
    </View>
  );
}

function StatPill({
  icon,
  color,
  bg,
  value,
  label,
}: {
  icon: string;
  color: string;
  bg: string;
  value: number;
  label: string;
}) {
  return (
    <View style={styles.statPill}>
      <View style={[styles.statPillIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={13} color={color} />
      </View>
      <Text style={[styles.statPillValue, { color }]}>{value.toLocaleString()}</Text>
      <Text style={styles.statPillLabel}>{label}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────
// MAIN CONTENT
// ─────────────────────────────────────────────

function AdminReconciliationContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('ALL');
  const [dateFilter, setDateFilter] = useState<DateFilter>('7d');

  const { data: allReports = [], isLoading } = useQuery({
    queryKey: ['reconciliation-reports'],
    queryFn: () => adminService.getReconciliationReports(60),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['reconciliation-reports'] });
    setRefreshing(false);
  }, [queryClient]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoffMs = dateFilter === '7d' ? 7 * 86_400_000 : 30 * 86_400_000;

    return allReports.filter((r) => {
      if (providerFilter !== 'ALL') {
        // BANK filter matches all BANK_* providers
        const matchesProvider =
          providerFilter === 'BANK'
            ? r.provider.startsWith('BANK')
            : r.provider === providerFilter;
        if (!matchesProvider) return false;
      }

      if (r.date) {
        const rTime = new Date(r.date).getTime();
        if (now - rTime > cutoffMs) return false;
      }

      return true;
    });
  }, [allReports, providerFilter, dateFilter]);

  const totalMismatched = filtered.reduce((s, r) => s + r.mismatched, 0);
  const totalMatched = filtered.reduce((s, r) => s + r.matched, 0);
  const overallRate = totalMatched + totalMismatched > 0
    ? Math.round((totalMatched / (totalMatched + totalMismatched)) * 100)
    : 100;

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={[styles.headerIcon, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
            <Ionicons name="git-compare-outline" size={22} color={C.white} />
          </View>
          <View>
            <Text style={styles.headerTitle}>{t('reconciliationReports.title')}</Text>
            <Text style={styles.headerSubtitle}>{t('reconciliationReports.subtitle')}</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {/* ── Filters ── */}
        <ProviderFilterTabs active={providerFilter} onChange={setProviderFilter} />
        <DateFilterRow active={dateFilter} onChange={setDateFilter} />

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : (
          <>
            {/* ── Aggregate summary ── */}
            <View style={styles.overallCard}>
              <View style={styles.overallRow}>
                <View style={styles.overallItem}>
                  <Text style={styles.overallValue}>{filtered.length}</Text>
                  <Text style={styles.overallLabel}>{t('reconciliationReports.totalTransactions')}</Text>
                </View>
                <View style={styles.overallDivider} />
                <View style={styles.overallItem}>
                  <Text style={[styles.overallValue, { color: C.red }]}>{totalMismatched.toLocaleString()}</Text>
                  <Text style={styles.overallLabel}>{t('reconciliationReports.mismatched')}</Text>
                </View>
                <View style={styles.overallDivider} />
                <View style={styles.overallItem}>
                  <Text style={[styles.overallValue, { color: matchRateColor(overallRate) }]}>{overallRate}%</Text>
                  <Text style={styles.overallLabel}>{t('reconciliationReports.matched')}</Text>
                </View>
              </View>
            </View>

            {/* ── Mismatch chart ── */}
            {filtered.length > 0 && <MismatchChart reports={filtered} />}

            {/* ── Report cards ── */}
            {filtered.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="document-outline" size={48} color={C.border} />
                <Text style={styles.emptyText}>{t('reconciliationReports.noReports')}</Text>
              </View>
            ) : (
              <>
                <Text style={styles.sectionLabel}>
                  {filtered.length} {t('reconciliationReports.title')}
                </Text>
                {filtered.map((r) => (
                  <ReportCard key={r.reportId} report={r} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminReconciliationScreen() {
  return (
    <AdminGuard>
      <AdminReconciliationContent />
    </AdminGuard>
  );
}

// ─────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.white,
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  loadingBox: {
    paddingVertical: 80,
    alignItems: 'center',
  },
  emptyBox: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: C.sub,
    textAlign: 'center',
  },
  tabScroll: {
    flexGrow: 0,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 2,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
  },
  tabActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  tabText: {
    fontSize: 13,
    color: C.sub,
    fontWeight: '500',
  },
  tabTextActive: {
    color: C.white,
    fontWeight: '700',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
  },
  dateChipActive: {
    backgroundColor: C.primaryLight,
    borderColor: C.primary,
  },
  dateChipText: {
    fontSize: 12,
    color: C.sub,
    fontWeight: '500',
  },
  dateChipTextActive: {
    color: C.primary,
    fontWeight: '700',
  },
  overallCard: {
    backgroundColor: C.white,
    borderRadius: 12,
    padding: 16,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  overallRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overallItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  overallDivider: {
    width: 1,
    height: 36,
    backgroundColor: C.border,
  },
  overallValue: {
    fontSize: 22,
    fontWeight: '800',
    color: C.text,
  },
  overallLabel: {
    fontSize: 11,
    color: C.sub,
    textAlign: 'center',
  },
  chartCard: {
    backgroundColor: C.white,
    borderRadius: 12,
    padding: 16,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  chartTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: C.sub,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  chartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 80,
    gap: 6,
  },
  chartCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    height: '100%',
    justifyContent: 'flex-end',
  },
  chartBarValue: {
    fontSize: 10,
    fontWeight: '600',
    color: C.text,
  },
  chartBarTrack: {
    width: '100%',
    height: 52,
    backgroundColor: C.bg,
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  chartBarFill: {
    width: '100%',
    borderRadius: 4,
    minHeight: 4,
  },
  chartBarLabel: {
    fontSize: 9,
    color: C.sub,
    textAlign: 'center',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.sub,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: C.white,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    paddingBottom: 10,
  },
  cardTopLeft: {
    gap: 2,
  },
  reportProvider: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
  },
  reportDate: {
    fontSize: 12,
    color: C.sub,
  },
  rateBadge: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  rateBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 8,
  },
  statPill: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statPillIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statPillValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  statPillLabel: {
    fontSize: 9,
    color: C.sub,
    textAlign: 'center',
  },
  netSettlementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  netSettlementLabel: {
    fontSize: 13,
    color: C.sub,
  },
  netSettlementValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  expandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  expandLabel: {
    flex: 1,
    fontSize: 13,
    color: C.sub,
    fontWeight: '500',
  },
  discList: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    padding: 12,
    gap: 10,
  },
  discItem: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    gap: 6,
  },
  discHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  issueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  issueBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  discTxId: {
    fontSize: 11,
    color: C.sub,
    fontFamily: 'monospace' as any,
  },
  discAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  discAmountCol: {
    flex: 1,
    gap: 2,
  },
  discAmountLabel: {
    fontSize: 10,
    color: C.sub,
  },
  discAmountValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  discStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  discStatusLabel: {
    fontSize: 11,
    color: C.sub,
  },
  discStatusValue: {
    fontSize: 11,
    fontWeight: '600',
    color: C.text,
  },
  discNotes: {
    fontSize: 11,
    color: C.sub,
    fontStyle: 'italic',
  },
  noDiscRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  noDiscText: {
    fontSize: 13,
    color: C.green,
    fontWeight: '500',
  },
});

/**
 * AdminSettlementsScreen.tsx
 * ───────────────────────────
 * Displays net settlement balances between Habeshare and each payout partner.
 * Uses partnerSettlementService via adminService.getPartnerSettlements().
 *
 * Color convention:
 *   positive netBalance (green) → partner owes Habeshare
 *   negative netBalance (red)   → Habeshare owes partner
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
import type { SettlementRecord } from '../../types';

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
  border: '#E5E7EB',
  cardShadow: '#000',
};

const PROVIDER_DISPLAY: Record<string, { label: string; icon: string; color: string }> = {
  CHAPA:           { label: 'Chapa',           icon: 'card-outline',          color: '#7C3AED' },
  TELEBIRR:        { label: 'Telebirr',         icon: 'phone-portrait-outline', color: '#0891B2' },
  BANK_DASHEN:     { label: 'Dashen Bank',      icon: 'business-outline',      color: '#059669' },
  BANK_AWASH:      { label: 'Awash Bank',       icon: 'business-outline',      color: '#DC2626' },
  BANK_CBE:        { label: 'CBE',              icon: 'business-outline',      color: '#2563EB' },
  BANK_ABYSSINIA:  { label: 'Bank of Abyssinia', icon: 'business-outline',     color: '#D97706' },
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

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────

function ProviderBalanceCard({ record }: { record: SettlementRecord }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const pInfo = PROVIDER_DISPLAY[record.provider] ?? {
    label: record.provider,
    icon: 'ellipse-outline',
    color: C.primary,
  };

  const isPositive = record.netBalance >= 0;
  const netColor = isPositive ? C.green : C.red;
  const netBg = isPositive ? C.greenL : C.redL;
  const netIcon = isPositive ? 'trending-up-outline' : 'trending-down-outline';

  // Visual bar: inflow vs outflow (max is larger of the two)
  const maxVal = Math.max(record.inflow, record.outflow, 1);
  const inflowPct = (record.inflow / maxVal) * 100;
  const outflowPct = (record.outflow / maxVal) * 100;

  return (
    <View style={styles.card}>
      {/* ── Header row ── */}
      <View style={styles.cardHeader}>
        <View style={[styles.providerIcon, { backgroundColor: pInfo.color + '18' }]}>
          <Ionicons name={pInfo.icon as any} size={22} color={pInfo.color} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.providerLabel}>{pInfo.label}</Text>
          <Text style={styles.currencyLabel}>{record.currency}</Text>
        </View>
        <View style={[styles.netBadge, { backgroundColor: netBg }]}>
          <Ionicons name={netIcon as any} size={14} color={netColor} />
          <Text style={[styles.netBadgeText, { color: netColor }]}>
            {formatETB(record.netBalance)}
          </Text>
        </View>
      </View>

      {/* ── Net balance meaning ── */}
      <View style={[styles.hintRow, { backgroundColor: netBg }]}>
        <Ionicons
          name={isPositive ? 'information-circle-outline' : 'alert-circle-outline'}
          size={14}
          color={netColor}
        />
        <Text style={[styles.hintText, { color: netColor }]}>
          {isPositive
            ? t('partnerSettlements.positiveHint')
            : t('partnerSettlements.negativeHint')}
        </Text>
      </View>

      {/* ── Flow bar chart ── */}
      <View style={styles.barSection}>
        <View style={styles.barRow}>
          <View style={styles.barLabelCol}>
            <Ionicons name="arrow-down-outline" size={12} color={C.green} />
            <Text style={styles.barLabel}>{t('partnerSettlements.inflow')}</Text>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${inflowPct}%` as any, backgroundColor: C.green }]} />
          </View>
          <Text style={[styles.barValue, { color: C.green }]}>
            {formatETB(record.inflow)}
          </Text>
        </View>
        <View style={styles.barRow}>
          <View style={styles.barLabelCol}>
            <Ionicons name="arrow-up-outline" size={12} color={C.red} />
            <Text style={styles.barLabel}>{t('partnerSettlements.outflow')}</Text>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${outflowPct}%` as any, backgroundColor: C.red }]} />
          </View>
          <Text style={[styles.barValue, { color: C.red }]}>
            {formatETB(record.outflow)}
          </Text>
        </View>
      </View>

      {/* ── Expand toggle ── */}
      <TouchableOpacity
        style={styles.expandRow}
        onPress={() => setExpanded((p) => !p)}
        activeOpacity={0.7}
      >
        <Text style={styles.expandLabel}>
          {expanded ? t('partnerSettlements.hideDetails') : t('partnerSettlements.viewDetails')}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={C.sub}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.detailTable}>
          <DetailRow label={t('partnerSettlements.netBalance')} value={`${formatETB(record.netBalance)} ${record.currency}`} valueColor={netColor} />
          <DetailRow label={t('partnerSettlements.inflow')} value={`${formatETB(record.inflow)} ${record.currency}`} valueColor={C.green} />
          <DetailRow label={t('partnerSettlements.outflow')} value={`${formatETB(record.outflow)} ${record.currency}`} valueColor={C.red} />
          <DetailRow label={t('partnerSettlements.lastUpdated')} value={formatTime(record.updatedAt)} />
        </View>
      )}
    </View>
  );
}

function DetailRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, valueColor ? { color: valueColor } : undefined]}>
        {value}
      </Text>
    </View>
  );
}

function SummaryBar({ records }: { records: SettlementRecord[] }) {
  const { t } = useTranslation();

  const totalInflow = records.reduce((s, r) => s + r.inflow, 0);
  const totalOutflow = records.reduce((s, r) => s + r.outflow, 0);
  const totalNet = records.reduce((s, r) => s + r.netBalance, 0);

  return (
    <View style={styles.summaryBar}>
      <SummaryItem label={t('partnerSettlements.inflow')} value={`${formatETB(totalInflow)} ETB`} color={C.green} icon="arrow-down-outline" />
      <View style={styles.summaryDivider} />
      <SummaryItem label={t('partnerSettlements.outflow')} value={`${formatETB(totalOutflow)} ETB`} color={C.red} icon="arrow-up-outline" />
      <View style={styles.summaryDivider} />
      <SummaryItem
        label={t('partnerSettlements.netBalance')}
        value={`${formatETB(totalNet)} ETB`}
        color={totalNet >= 0 ? C.green : C.red}
        icon={totalNet >= 0 ? 'trending-up-outline' : 'trending-down-outline'}
      />
    </View>
  );
}

function SummaryItem({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  return (
    <View style={styles.summaryItem}>
      <Ionicons name={icon as any} size={16} color={color} />
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────
// MAIN CONTENT
// ─────────────────────────────────────────────

function AdminSettlementsContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['partner-settlements'],
    queryFn: () => adminService.getPartnerSettlements(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['partner-settlements'] });
    setRefreshing(false);
  }, [queryClient]);

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={[styles.headerIcon, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
            <Ionicons name="swap-horizontal-outline" size={22} color={C.white} />
          </View>
          <View>
            <Text style={styles.headerTitle}>{t('partnerSettlements.title')}</Text>
            <Text style={styles.headerSubtitle}>{t('partnerSettlements.subtitle')}</Text>
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
        ) : records.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="swap-horizontal-outline" size={48} color={C.border} />
            <Text style={styles.emptyText}>{t('partnerSettlements.noData')}</Text>
          </View>
        ) : (
          <>
            {/* Aggregate summary */}
            <SummaryBar records={records} />

            {/* Legend */}
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: C.green }]} />
                <Text style={styles.legendText}>{t('partnerSettlements.positiveHint')}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: C.red }]} />
                <Text style={styles.legendText}>{t('partnerSettlements.negativeHint')}</Text>
              </View>
            </View>

            {/* Section label */}
            <Text style={styles.sectionLabel}>{t('partnerSettlements.balanceTrend')}</Text>

            {/* Provider cards */}
            {records.map((r) => (
              <ProviderBalanceCard key={r.settlementId} record={r} />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminSettlementsScreen() {
  return (
    <AdminGuard>
      <AdminSettlementsContent />
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
    paddingVertical: 80,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: C.sub,
    textAlign: 'center',
  },
  summaryBar: {
    backgroundColor: C.white,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: C.cardShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  summaryDivider: {
    width: 1,
    height: 36,
    backgroundColor: C.border,
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  summaryLabel: {
    fontSize: 10,
    color: C.sub,
    textAlign: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: C.sub,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.sub,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  card: {
    backgroundColor: C.white,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: C.cardShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  providerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardHeaderText: {
    flex: 1,
  },
  providerLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
  },
  currencyLabel: {
    fontSize: 12,
    color: C.sub,
    marginTop: 2,
  },
  netBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  netBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  hintText: {
    fontSize: 12,
    fontWeight: '500',
  },
  barSection: {
    padding: 14,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  barLabelCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    width: 72,
  },
  barLabel: {
    fontSize: 11,
    color: C.sub,
    flex: 1,
  },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: C.bg,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: 8,
    borderRadius: 4,
    minWidth: 4,
  },
  barValue: {
    fontSize: 12,
    fontWeight: '600',
    width: 56,
    textAlign: 'right',
  },
  expandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  expandLabel: {
    fontSize: 13,
    color: C.sub,
    fontWeight: '500',
  },
  detailTable: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 13,
    color: C.sub,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text,
  },
});

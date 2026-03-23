/**
 * AdminSettlementEngineObligationsScreen.tsx
 * ─────────────────────────────────────────────
 * Displays settlement engine obligations (se_obligations) with filtering
 * by provider, currency, status, and direction.
 *
 * Note: distinct from AdminSettlementObligationsScreen which shows treasury obligations.
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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';
import type { SettlementObligation, SettlementStatus } from '../../services/settlement/settlementTypes';

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
  grey: '#9CA3AF',   greyL: '#F3F4F6',
  border: '#E5E7EB',
  shadow: '#000',
};

const STATUS_CFG: Record<SettlementStatus, { bg: string; color: string; icon: string }> = {
  OPEN:       { bg: C.amberL,  color: C.amber,  icon: 'time-outline' },
  BATCHED:    { bg: C.blueL,   color: C.blue,   icon: 'cube-outline' },
  PROCESSING: { bg: C.purpleL, color: C.purple, icon: 'sync-outline' },
  SETTLED:    { bg: C.greenL,  color: C.green,  icon: 'checkmark-circle-outline' },
  FAILED:     { bg: C.redL,    color: C.red,    icon: 'close-circle-outline' },
  CANCELLED:  { bg: C.greyL,   color: C.grey,   icon: 'ban-outline' },
};

type FilterTab = 'ALL' | SettlementStatus;

function formatETB(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function maskId(id: string): string {
  if (!id || id.length <= 12) return id;
  return id.slice(0, 8) + '…' + id.slice(-4);
}

function isOverdue(ob: SettlementObligation): boolean {
  return ob.status === 'OPEN' && new Date(ob.dueAt) < new Date();
}

function ObligationCard({ ob }: { ob: SettlementObligation }) {
  const { t } = useTranslation();
  const overdue = isOverdue(ob);
  const cfg = STATUS_CFG[ob.status] ?? STATUS_CFG.OPEN;
  const isOwed = ob.direction === 'OWED_TO_PARTNER';

  return (
    <View style={[styles.card, overdue && styles.cardOverdue]}>
      <View style={styles.cardRow}>
        <View style={styles.cardLeft}>
          <Text style={styles.provider}>{ob.provider}</Text>
          <Text style={styles.refId}>{maskId(ob.referenceId)}</Text>
        </View>
        <View style={styles.cardRight}>
          <Text style={[styles.amount, { color: isOwed ? C.red : C.green }]}>
            {isOwed ? '−' : '+'}{formatETB(ob.amount)} {ob.currency}
          </Text>
          <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon as any} size={11} color={cfg.color} />
            <Text style={[styles.badgeText, { color: cfg.color }]}>{ob.status}</Text>
          </View>
        </View>
      </View>

      <View style={styles.detailRow}>
        <View style={[styles.dirBadge, { backgroundColor: isOwed ? C.redL : C.greenL }]}>
          <Ionicons name={isOwed ? 'arrow-up-outline' : 'arrow-down-outline'} size={11} color={isOwed ? C.red : C.green} />
          <Text style={[styles.dirText, { color: isOwed ? C.red : C.green }]}>
            {isOwed ? t('settlementEngine.owedToPartner') : t('settlementEngine.owedFromPartner')}
          </Text>
        </View>
        {ob.batchId ? (
          <Text style={styles.batchChip}>{maskId(ob.batchId)}</Text>
        ) : null}
        {overdue && (
          <View style={[styles.badge, { backgroundColor: C.redL }]}>
            <Ionicons name="hourglass-outline" size={11} color={C.red} />
            <Text style={[styles.badgeText, { color: C.red }]}>{t('settlementEngine.overdue')}</Text>
          </View>
        )}
      </View>

      <View style={styles.footerRow}>
        <Text style={styles.metaText}>{t('settlementEngine.created')}: {formatDate(ob.createdAt)}</Text>
        <Text style={styles.metaText}>{t('settlementEngine.due')}: {formatDate(ob.dueAt)}</Text>
      </View>
    </View>
  );
}

function AdminSettlementEngineObligationsContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>('ALL');
  const [refreshing, setRefreshing] = useState(false);

  const { data: obligations = [], isLoading } = useQuery({
    queryKey: ['settlement-engine-obligations', filter],
    queryFn: () => adminService.getSettlementObligations(filter === 'ALL' ? {} : { status: filter as SettlementStatus }),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['settlement-engine-obligations'] });
    setRefreshing(false);
  }, [queryClient]);

  const tabs: FilterTab[] = ['ALL', 'OPEN', 'BATCHED', 'PROCESSING', 'SETTLED', 'FAILED'];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerIcon}>
            <Ionicons name="document-text-outline" size={20} color={C.white} />
          </View>
          <View>
            <Text style={styles.headerTitle}>{t('settlementEngine.obligations')}</Text>
            <Text style={styles.headerSub}>{t('settlementEngine.obligationsSubtitle')}</Text>
          </View>
        </View>
      </View>

      {/* Filter tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabRow}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, filter === tab && styles.tabActive]}
            onPress={() => setFilter(tab)}
          >
            <Text style={[styles.tabText, filter === tab && styles.tabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {isLoading ? (
          <View style={styles.loadingBox}><ActivityIndicator size="large" color={C.primary} /></View>
        ) : obligations.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="document-outline" size={48} color={C.border} />
            <Text style={styles.emptyText}>{t('settlementEngine.noObligations')}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.countLabel}>{obligations.length} {t('settlementEngine.obligations')}</Text>
            {obligations.map((ob) => <ObligationCard key={ob.obligationId} ob={ob} />)}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminSettlementEngineObligationsScreen() {
  return (
    <AdminGuard>
      <AdminSettlementEngineObligationsContent />
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
  tabScroll: { flexGrow: 0, backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.border },
  tabRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 12, paddingVertical: 10 },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: C.greyL },
  tabActive: { backgroundColor: C.primary },
  tabText: { fontSize: 12, color: C.sub, fontWeight: '600' },
  tabTextActive: { color: C.white },
  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 32, gap: 10 },
  loadingBox: { paddingVertical: 80, alignItems: 'center' },
  emptyBox: { paddingVertical: 60, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: C.sub },
  countLabel: { fontSize: 12, color: C.sub, fontWeight: '600', paddingHorizontal: 2 },
  card: {
    backgroundColor: C.white, borderRadius: 12, padding: 14, gap: 8,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  cardOverdue: { borderWidth: 1, borderColor: C.red },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardLeft: { gap: 3 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  provider: { fontSize: 14, fontWeight: '700', color: C.text },
  refId: { fontSize: 11, color: C.sub, fontFamily: 'monospace' as any },
  amount: { fontSize: 16, fontWeight: '800' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  dirBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  dirText: { fontSize: 10, fontWeight: '600' },
  batchChip: { fontSize: 10, color: C.blue, backgroundColor: C.blueL, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, fontFamily: 'monospace' as any },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 },
  metaText: { fontSize: 10, color: C.sub },
});

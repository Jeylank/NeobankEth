/**
 * AdminSettlementBatchesScreen.tsx
 * ──────────────────────────────────
 * Lists settlement batches with Process / Mark Settled / Mark Failed admin actions.
 * All destructive actions show a confirmation alert before executing.
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
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';
import type { SettlementBatch, SettlementBatchStatus } from '../../services/settlement/settlementTypes';

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

const STATUS_CFG: Record<SettlementBatchStatus, { bg: string; color: string; icon: string }> = {
  OPEN:       { bg: C.amberL,  color: C.amber,  icon: 'time-outline' },
  PROCESSING: { bg: C.purpleL, color: C.purple, icon: 'sync-outline' },
  SETTLED:    { bg: C.greenL,  color: C.green,  icon: 'checkmark-circle-outline' },
  FAILED:     { bg: C.redL,    color: C.red,    icon: 'close-circle-outline' },
};

type FilterTab = 'ALL' | SettlementBatchStatus;

function formatETB(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M ETB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k ETB`;
  return `${n.toLocaleString()} ETB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function maskId(id: string): string {
  if (!id || id.length <= 16) return id;
  return id.slice(0, 12) + '…';
}

function BatchCard({
  batch,
  onProcess,
  onSettle,
  onFail,
  isPending,
}: {
  batch: SettlementBatch;
  onProcess: () => void;
  onSettle: () => void;
  onFail: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const cfg = STATUS_CFG[batch.status] ?? STATUS_CFG.OPEN;
  const canProcess = batch.status === 'OPEN';
  const canSettle  = batch.status === 'PROCESSING';
  const canFail    = batch.status === 'OPEN' || batch.status === 'PROCESSING';

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Text style={styles.batchId}>{maskId(batch.batchId)}</Text>
          <Text style={styles.providerText}>{batch.provider} · {batch.currency}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon as any} size={12} color={cfg.color} />
          <Text style={[styles.badgeText, { color: cfg.color }]}>{batch.status}</Text>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{formatETB(batch.totalAmount)}</Text>
          <Text style={styles.statLabel}>{t('settlementEngine.totalAmount')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{batch.obligationCount}</Text>
          <Text style={styles.statLabel}>{t('settlementEngine.obligations')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{formatDate(batch.settledAt)}</Text>
          <Text style={styles.statLabel}>{t('settlementEngine.settledAt')}</Text>
        </View>
      </View>

      <View style={styles.dateRow}>
        <Text style={styles.metaText}>{t('settlementEngine.created')}: {formatDate(batch.createdAt)}</Text>
      </View>

      {/* Actions */}
      {(canProcess || canSettle || canFail) && (
        <View style={styles.actions}>
          {canProcess && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: C.blueL }]} onPress={onProcess} disabled={isPending}>
              <Ionicons name="play-outline" size={14} color={C.blue} />
              <Text style={[styles.actionText, { color: C.blue }]}>{t('settlementEngine.process')}</Text>
            </TouchableOpacity>
          )}
          {canSettle && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: C.greenL }]} onPress={onSettle} disabled={isPending}>
              <Ionicons name="checkmark-outline" size={14} color={C.green} />
              <Text style={[styles.actionText, { color: C.green }]}>{t('settlementEngine.markSettled')}</Text>
            </TouchableOpacity>
          )}
          {canFail && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: C.redL }]} onPress={onFail} disabled={isPending}>
              <Ionicons name="close-outline" size={14} color={C.red} />
              <Text style={[styles.actionText, { color: C.red }]}>{t('settlementEngine.markFailed')}</Text>
            </TouchableOpacity>
          )}
          {isPending && <ActivityIndicator size="small" color={C.primary} />}
        </View>
      )}
    </View>
  );
}

function AdminSettlementBatchesContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>('ALL');
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['settlement-batches', filter],
    queryFn: () => adminService.getSettlementBatches(filter === 'ALL' ? {} : { status: filter as SettlementBatchStatus }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['settlement-batches'] });

  const processMut = useMutation({
    mutationFn: (id: string) => adminService.processSettlementBatch(id),
    onSuccess: () => { invalidate(); setPendingId(null); },
    onError: () => setPendingId(null),
  });
  const settleMut = useMutation({
    mutationFn: (id: string) => adminService.settleSettlementBatch(id),
    onSuccess: () => { invalidate(); setPendingId(null); },
    onError: () => setPendingId(null),
  });
  const failMut = useMutation({
    mutationFn: (id: string) => adminService.failSettlementBatch(id),
    onSuccess: () => { invalidate(); setPendingId(null); },
    onError: () => setPendingId(null),
  });

  const confirm = (title: string, msg: string, onOk: () => void) =>
    Alert.alert(title, msg, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), style: 'destructive', onPress: onOk },
    ]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await invalidate();
    setRefreshing(false);
  }, [queryClient]);

  const tabs: FilterTab[] = ['ALL', 'OPEN', 'PROCESSING', 'SETTLED', 'FAILED'];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerIcon}>
            <Ionicons name="cube-outline" size={20} color={C.white} />
          </View>
          <View>
            <Text style={styles.headerTitle}>{t('settlementEngine.batches')}</Text>
            <Text style={styles.headerSub}>{t('settlementEngine.batchesSubtitle')}</Text>
          </View>
        </View>
      </View>

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
        ) : batches.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="cube-outline" size={48} color={C.border} />
            <Text style={styles.emptyText}>{t('settlementEngine.noBatches')}</Text>
          </View>
        ) : (
          batches.map((b) => (
            <BatchCard
              key={b.batchId}
              batch={b}
              isPending={pendingId === b.batchId}
              onProcess={() => confirm(t('settlementEngine.process'), t('settlementEngine.processConfirm'), () => { setPendingId(b.batchId); processMut.mutate(b.batchId); })}
              onSettle={() => confirm(t('settlementEngine.markSettled'), t('settlementEngine.settleConfirm'), () => { setPendingId(b.batchId); settleMut.mutate(b.batchId); })}
              onFail={() => confirm(t('settlementEngine.markFailed'), t('settlementEngine.failConfirm'), () => { setPendingId(b.batchId); failMut.mutate(b.batchId); })}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminSettlementBatchesScreen() {
  return (
    <AdminGuard>
      <AdminSettlementBatchesContent />
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
  card: {
    backgroundColor: C.white, borderRadius: 12, overflow: 'hidden',
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  cardHeaderLeft: { gap: 3 },
  batchId: { fontSize: 13, fontWeight: '700', color: C.text, fontFamily: 'monospace' as any },
  providerText: { fontSize: 12, color: C.sub },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  statsRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 12, paddingHorizontal: 14 },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: C.border },
  statValue: { fontSize: 13, fontWeight: '700', color: C.text, textAlign: 'center' },
  statLabel: { fontSize: 10, color: C.sub, textAlign: 'center' },
  dateRow: { paddingHorizontal: 14, paddingBottom: 10 },
  metaText: { fontSize: 11, color: C.sub },
  actions: { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: C.border, alignItems: 'center', flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  actionText: { fontSize: 12, fontWeight: '700' },
});

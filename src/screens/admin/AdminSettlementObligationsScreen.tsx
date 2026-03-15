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
import { useAuth } from '../../hooks/useAuth';
import type {
  SettlementObligation,
  SettlementObligationStatus,
} from '../../services/treasury/treasuryTypes';

const C = {
  primary: '#006633',
  white: '#FFFFFF',
  bg: '#F5F5F5',
  text: '#1F2937',
  sub: '#6B7280',
  green: '#10B981',
  greenL: '#D1FAE5',
  blue: '#3B82F6',
  blueL: '#DBEAFE',
  red: '#EF4444',
  redL: '#FEE2E2',
  amber: '#F59E0B',
  amberL: '#FEF3C7',
  purple: '#8B5CF6',
  purpleL: '#F5F3FF',
  grey: '#9CA3AF',
  greyL: '#F3F4F6',
  border: '#E5E7EB',
};

const STATUS_CONFIG: Record<SettlementObligationStatus, { bg: string; text: string; icon: string }> = {
  open: { bg: C.amberL, text: C.amber, icon: 'time-outline' },
  partially_settled: { bg: C.blueL, text: C.blue, icon: 'git-merge-outline' },
  settled: { bg: C.greenL, text: C.green, icon: 'checkmark-circle-outline' },
  disputed: { bg: C.redL, text: C.red, icon: 'warning-outline' },
  overdue: { bg: C.redL, text: C.red, icon: 'hourglass-outline' },
};

type FilterTab = 'open' | 'overdue' | 'settled' | 'all';

function formatETB(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M ETB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k ETB`;
  return n.toLocaleString() + ' ETB';
}

function isOverdue(ob: SettlementObligation): boolean {
  return (
    (ob.status === 'open' || ob.status === 'partially_settled') &&
    new Date(ob.dueDate) < new Date()
  );
}

function ObligationCard({
  ob,
  onClose,
}: {
  ob: SettlementObligation;
  onClose: (id: string) => void;
}) {
  const { t } = useTranslation();
  const overdue = isOverdue(ob);
  const effectiveStatus = overdue ? 'overdue' : ob.status;
  const cfg = STATUS_CONFIG[effectiveStatus] ?? STATUS_CONFIG.open;
  const hoursUntilDue = (new Date(ob.dueDate).getTime() - Date.now()) / (1000 * 3600);

  return (
    <View style={[styles.card, overdue && styles.cardOverdue]}>
      <View style={styles.cardHeader}>
        <View style={[styles.statusIcon, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon as any} size={15} color={cfg.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.oblId} numberOfLines={1}>{ob.obligationId}</Text>
          <Text style={styles.oblTx}>TX: {ob.txId} · {ob.provider.replace('BANK_', '')}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.statusText, { color: cfg.text }]}>{effectiveStatus.toUpperCase()}</Text>
        </View>
      </View>

      {/* Amounts */}
      <View style={styles.amountRow}>
        <View>
          <Text style={styles.amountLabel}>{t('treasury.obligated')}</Text>
          <Text style={styles.amountVal}>{formatETB(ob.amount)}</Text>
        </View>
        {ob.settledAmount !== undefined && ob.settledAmount !== ob.amount && (
          <View>
            <Text style={styles.amountLabel}>{t('treasury.settled')}</Text>
            <Text style={[styles.amountVal, { color: C.green }]}>{formatETB(ob.settledAmount)}</Text>
          </View>
        )}
        {ob.settledAmount !== undefined && (
          <View>
            <Text style={styles.amountLabel}>{t('treasury.remaining')}</Text>
            <Text style={[styles.amountVal, { color: overdue ? C.red : C.amber }]}>
              {formatETB(ob.amount - ob.settledAmount)}
            </Text>
          </View>
        )}
      </View>

      {/* Due date */}
      <View style={styles.dueRow}>
        <Ionicons name={overdue ? 'warning-outline' : 'calendar-outline'} size={13} color={overdue ? C.red : C.sub} />
        <Text style={[styles.dueText, overdue && { color: C.red }]}>
          {overdue
            ? `${t('treasury.overdueBy')} ${Math.abs(hoursUntilDue).toFixed(0)}h`
            : `${t('treasury.dueIn')} ${hoursUntilDue.toFixed(0)}h`}
          {' · '}{new Date(ob.dueDate).toLocaleString()}
        </Text>
      </View>

      {ob.notes && (
        <View style={styles.notesBox}>
          <Text style={styles.notesText}>{ob.notes}</Text>
        </View>
      )}

      {(ob.status === 'open' || ob.status === 'partially_settled') && (
        <TouchableOpacity style={styles.closeBtn} onPress={() => onClose(ob.obligationId)}>
          <Ionicons name="checkmark-done-outline" size={14} color={C.green} />
          <Text style={styles.closeBtnText}>{t('treasury.markSettled')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function AdminSettlementObligationsContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [filter, setFilter] = useState<FilterTab>('open');
  const [refreshing, setRefreshing] = useState(false);

  const { data: obligations = [], isLoading } = useQuery<SettlementObligation[]>({
    queryKey: ['treasury-obligations', filter],
    queryFn: () =>
      adminService.getTreasurySettlements(
        filter === 'all' ? {} :
        filter === 'overdue' ? { overdue: true } :
        { status: filter },
      ),
  });

  const closeMutation = useMutation({
    mutationFn: (id: string) =>
      adminService.closeTreasuryObligation(id, undefined, user?.uid ?? 'admin'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['treasury-obligations'] }),
  });

  const handleClose = useCallback(
    (id: string) => {
      Alert.alert(t('treasury.markSettled'), t('treasury.markSettledConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('treasury.markSettled'), onPress: () => closeMutation.mutate(id) },
      ]);
    },
    [t, closeMutation],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['treasury-obligations'] });
    setRefreshing(false);
  }, [queryClient]);

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'open', label: t('treasury.open') },
    { key: 'overdue', label: t('treasury.overdue') },
    { key: 'settled', label: t('treasury.settled') },
    { key: 'all', label: t('reconciliation.all') },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, filter === tab.key && styles.tabActive]}
              onPress={() => setFilter(tab.key)}
            >
              <Text style={[styles.tabText, filter === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.count}>{obligations.length} {t('treasury.obligations')}</Text>
        {isLoading ? (
          <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 60 }} />
        ) : obligations.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={40} color={C.sub} />
            <Text style={styles.emptyText}>{t('treasury.noObligations')}</Text>
          </View>
        ) : (
          obligations.map((ob) => (
            <ObligationCard key={ob.obligationId} ob={ob} onClose={handleClose} />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminSettlementObligationsScreen() {
  return (
    <AdminGuard>
      <AdminSettlementObligationsContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  tabBar: { backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.border },
  tabContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: C.greyL },
  tabActive: { backgroundColor: C.primary },
  tabText: { fontSize: 13, color: C.sub, fontWeight: '500' },
  tabTextActive: { color: C.white, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 40 },
  count: { fontSize: 13, color: C.sub, marginBottom: 10 },
  card: {
    backgroundColor: C.white, borderRadius: 12, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  cardOverdue: { borderLeftWidth: 3, borderLeftColor: C.red },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  statusIcon: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  oblId: { fontSize: 11, fontWeight: '700', color: C.text, fontFamily: 'monospace' },
  oblTx: { fontSize: 10, color: C.sub, marginTop: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontWeight: '700' },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  amountLabel: { fontSize: 10, color: C.sub },
  amountVal: { fontSize: 15, fontWeight: '700', color: C.text, marginTop: 2 },
  dueRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8, marginBottom: 6,
  },
  dueText: { fontSize: 11, color: C.sub },
  notesBox: { backgroundColor: C.greyL, borderRadius: 6, padding: 8, marginBottom: 8 },
  notesText: { fontSize: 11, color: C.sub, lineHeight: 16 },
  closeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.greenL, borderRadius: 8, paddingVertical: 8,
  },
  closeBtnText: { fontSize: 12, color: C.green, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 13, color: C.sub, marginTop: 10 },
});

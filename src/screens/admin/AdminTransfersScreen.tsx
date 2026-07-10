import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';

const COLORS = {
  primary: '#006633',
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  green: '#10B981',
  blue: '#3B82F6',
  red: '#EF4444',
  amber: '#F59E0B',
  purple: '#8B5CF6',
};

const STATUS_FILTERS = [
  { key: undefined, label: 'all' },
  { key: 'PROCESSING', label: 'processing' },
  { key: 'AGENT_ASSIGNED', label: 'agentAssigned' },
  { key: 'OTP_SENT', label: 'otpSent' },
  { key: 'PAID_OUT', label: 'paidOut' },
  { key: 'COMPLETED', label: 'completed' },
  { key: 'FAILED', label: 'failed' },
  { key: 'REFUNDED', label: 'refunded' },
  { key: 'PENDING_LIQUIDITY', label: 'pendingLiquidity' },
] as const;

const RETRYABLE = new Set(['AGENT_ASSIGNED', 'PENDING_LIQUIDITY', 'PENDING_REQUOTE', 'FUNDS_RECEIVED']);

function statusColor(status: string): string {
  if (status === 'COMPLETED' || status === 'PAID_OUT') return COLORS.green;
  if (status === 'FAILED' || status === 'BLOCKED_FRAUD' || status === 'TIMED_OUT') return COLORS.red;
  if (status === 'REFUNDED') return COLORS.purple;
  if (status === 'PENDING_LIQUIDITY' || status === 'PENDING_REQUOTE') return COLORS.amber;
  return COLORS.blue;
}

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return '—';
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency ?? ''}`.trim();
}

function AdminTransfersContent() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();

  const [searchText, setSearchText] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

  const isTxIdLike = /^tx[_-]/i.test(activeQuery.trim());

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-transfers', activeQuery, statusFilter],
    queryFn: () =>
      adminService.searchTransfers({
        txId: isTxIdLike ? activeQuery.trim() : undefined,
        q: !isTxIdLike && activeQuery.trim() ? activeQuery.trim() : undefined,
        status: statusFilter,
        limit: 50,
      }),
  });

  const detailQuery = useQuery({
    queryKey: ['admin-transfer-detail', selectedTxId],
    queryFn: () => adminService.getTransferDetail(selectedTxId as string),
    enabled: Boolean(selectedTxId),
  });

  const retryMutation = useMutation({
    mutationFn: (txId: string) => adminService.retryTransfer(txId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['admin-transfer-detail', selectedTxId] });
      Alert.alert(t('admin.transfers.retrySuccess'));
    },
    onError: (err: any) => {
      Alert.alert(t('admin.transfers.retryFailed'), err?.response?.data?.message ?? err.message);
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({ txId, action }: { txId: string; action: 'recovery' | 'refund' }) =>
      action === 'recovery' ? adminService.moveTransferToRecovery(txId) : adminService.refundTransfer(txId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['admin-transfer-detail', selectedTxId] });
      Alert.alert(t('common.success'));
    },
    onError: () => Alert.alert(t('common.error')),
  });

  const confirmAction = (txId: string, action: 'recovery' | 'refund') => Alert.alert(
    action === 'recovery' ? 'Move to recovery' : 'Initiate refund',
    'Confirm this admin action?',
    [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), style: 'destructive', onPress: () => actionMutation.mutate({ txId, action }) },
    ],
  );

  const results = data?.results ?? [];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Ionicons name="swap-horizontal-outline" size={24} color={COLORS.white} />
          <Text style={styles.headerTitle}>{t('admin.transfers.title')}</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={COLORS.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('admin.transfers.searchPlaceholder')}
          placeholderTextColor={COLORS.textSecondary}
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={() => setActiveQuery(searchText)}
          returnKeyType="search"
          autoCapitalize="none"
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => { setSearchText(''); setActiveQuery(''); }}>
            <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterRowInner}>
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.label}
            style={[styles.filterChip, statusFilter === f.key && styles.filterChipActive]}
            onPress={() => setStatusFilter(f.key)}
          >
            <Text style={[styles.filterChipText, statusFilter === f.key && styles.filterChipTextActive]}>
              {t(`admin.transfers.filters.${f.label}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} colors={[COLORS.primary]} />}
      >
        {isLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : error ? (
          <View style={styles.centerBox}>
            <Ionicons name="alert-circle-outline" size={32} color={COLORS.red} />
            <Text style={styles.errorText}>{t('admin.transfers.loadError')}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : results.length === 0 ? (
          <View style={styles.centerBox}>
            <Ionicons name="file-tray-outline" size={32} color={COLORS.textSecondary} />
            <Text style={styles.errorText}>{t('admin.transfers.noResults')}</Text>
          </View>
        ) : (
          results.map((r: any) => (
            <TouchableOpacity key={r.txId} style={styles.row} onPress={() => setSelectedTxId(r.txId)}>
              <View style={styles.rowTop}>
                <Text style={styles.txId} numberOfLines={1}>{r.txId}</Text>
                <View style={[styles.statusPill, { backgroundColor: `${statusColor(r.status)}20` }]}>
                  <Text style={[styles.statusPillText, { color: statusColor(r.status) }]}>{r.status}</Text>
                </View>
              </View>
              <View style={styles.rowMid}>
                <Text style={styles.amount}>{formatAmount(r.amount, r.currency)}</Text>
                <Text style={styles.arrow}>→</Text>
                <Text style={styles.amount}>{formatAmount(r.destinationAmount, r.destinationCurrency)}</Text>
              </View>
              <View style={styles.rowBottom}>
                <Text style={styles.metaText} numberOfLines={1}>
                  {t('admin.transfers.sender')}: {r.senderId ?? '—'}
                </Text>
                <Text style={styles.metaText} numberOfLines={1}>
                  {t('admin.transfers.recipient')}: {r.recipientName ?? r.recipientId ?? '—'}
                </Text>
              </View>
              <View style={styles.rowBottom}>
                {r.fraudScore !== null && (
                  <View style={styles.badge}>
                    <Ionicons name="shield-outline" size={12} color={r.fraudScore >= 60 ? COLORS.red : r.fraudScore >= 30 ? COLORS.amber : COLORS.green} />
                    <Text style={styles.badgeText}>{t('admin.transfers.fraudScore')}: {r.fraudScore}</Text>
                  </View>
                )}
                <View style={styles.badge}>
                  <Ionicons name="person-circle-outline" size={12} color={COLORS.textSecondary} />
                  <Text style={styles.badgeText}>{t('admin.transfers.kyc')}: {r.kycStatus}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <Modal visible={Boolean(selectedTxId)} animationType="slide" onRequestClose={() => setSelectedTxId(null)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setSelectedTxId(null)} style={styles.backBtn}>
              <Ionicons name="close" size={24} color={COLORS.white} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle} numberOfLines={1}>{t('admin.transfers.detailTitle')}</Text>
            </View>
            <View style={styles.backBtn} />
          </View>

          <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
            {detailQuery.isLoading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={COLORS.primary} />
              </View>
            ) : detailQuery.error ? (
              <View style={styles.centerBox}>
                <Text style={styles.errorText}>{t('admin.transfers.loadError')}</Text>
              </View>
            ) : detailQuery.data ? (
              <>
                <View style={styles.sectionCard}>
                  <Text style={styles.txId}>{detailQuery.data.txId}</Text>
                  <View style={[styles.statusPill, { backgroundColor: `${statusColor(detailQuery.data.status)}20`, marginTop: 8, alignSelf: 'flex-start' }]}>
                    <Text style={[styles.statusPillText, { color: statusColor(detailQuery.data.status) }]}>{detailQuery.data.status}</Text>
                  </View>
                  <View style={styles.detailGrid}>
                    <DetailRow label={t('admin.transfers.amount')} value={formatAmount(detailQuery.data.amount, detailQuery.data.currency)} />
                    <DetailRow label={t('admin.transfers.destinationAmount')} value={formatAmount(detailQuery.data.destinationAmount, detailQuery.data.destinationCurrency)} />
                    <DetailRow label={t('admin.transfers.sender')} value={detailQuery.data.senderId ?? '—'} />
                    <DetailRow label={t('admin.transfers.recipient')} value={detailQuery.data.recipientName ?? detailQuery.data.recipientId ?? '—'} />
                    <DetailRow label={t('admin.transfers.city')} value={detailQuery.data.recipientCity ?? '—'} />
                    <DetailRow label={t('admin.transfers.createdAt')} value={detailQuery.data.createdAt ? new Date(detailQuery.data.createdAt).toLocaleString() : '—'} />
                  </View>
                </View>

                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>Payment &amp; payout operations</Text>
                  <DetailRow label="Payment confirmation" value={detailQuery.data.paymentConfirmation?.status ?? '—'} />
                  <DetailRow label="Confirmed at" value={detailQuery.data.paymentConfirmation?.confirmedAt ? new Date(detailQuery.data.paymentConfirmation.confirmedAt).toLocaleString() : '—'} />
                  <DetailRow label="Agent" value={detailQuery.data.agentAssignment?.agentId ?? 'Unassigned'} />
                  <DetailRow label="Assignment status" value={detailQuery.data.agentAssignment?.status ?? '—'} />
                  <DetailRow label="OTP state" value={detailQuery.data.otpState?.status ?? 'NOT_SENT'} />
                  <DetailRow label="OTP expires" value={detailQuery.data.otpState?.expiresAt ? new Date(detailQuery.data.otpState.expiresAt).toLocaleString() : '—'} />
                  <DetailRow label="Reconciliation" value={detailQuery.data.reconciliation?.status ?? '—'} />
                </View>

                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>Ledger entries</Text>
                  {(detailQuery.data.ledgerEntries ?? []).length === 0 ? <Text style={styles.metaText}>No ledger entries</Text> :
                    detailQuery.data.ledgerEntries.map((entry: any) => (
                      <View key={entry.id} style={styles.timelineItem}>
                        <Text style={styles.timelineStatus}>{entry.type ?? 'ENTRY'}</Text>
                        <Text style={styles.metaText}>{formatAmount(entry.amount, entry.currency)}</Text>
                      </View>
                    ))}
                </View>

                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>Reconciliation reports &amp; alerts</Text>
                  {(detailQuery.data.reconciliation?.reports ?? []).map((report: any) => <Text key={report.id} style={styles.metaText}>{report.status ?? report.type}</Text>)}
                  {(detailQuery.data.alerts ?? []).map((alert: any) => <Text key={alert.id} style={styles.metaText}>{alert.severity ?? 'info'} · {alert.message ?? alert.type}</Text>)}
                  {(detailQuery.data.reconciliation?.reports ?? []).length === 0 && (detailQuery.data.alerts ?? []).length === 0 && <Text style={styles.metaText}>No reconciliation alerts</Text>}
                </View>

                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeaderRow}>
                    <Ionicons name="shield-checkmark-outline" size={18} color={COLORS.primary} />
                    <Text style={styles.sectionTitle}>{t('admin.transfers.riskSection')}</Text>
                  </View>
                  <DetailRow label={t('admin.transfers.fraudScore')} value={detailQuery.data.fraudScore !== null ? String(detailQuery.data.fraudScore) : t('admin.transfers.noFraudData')} />
                  <DetailRow label={t('admin.transfers.fraudDecision')} value={detailQuery.data.fraudDecision ?? '—'} />
                  <DetailRow label={t('admin.transfers.kyc')} value={detailQuery.data.kycStatus} />
                  {detailQuery.data.fraudHistory?.length > 0 && (
                    <View style={{ marginTop: 8 }}>
                      {detailQuery.data.fraudHistory.map((f: any, idx: number) => (
                        <Text key={idx} style={styles.metaText}>
                          {f.createdAt ? new Date(f.createdAt).toLocaleString() : '—'} · {f.decision} · {t('admin.transfers.fraudScore')} {f.score}
                          {f.rulesTriggered?.length ? ` (${f.rulesTriggered.join(', ')})` : ''}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>

                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeaderRow}>
                    <Ionicons name="time-outline" size={18} color={COLORS.primary} />
                    <Text style={styles.sectionTitle}>{t('admin.transfers.timeline')}</Text>
                  </View>
                  {detailQuery.data.timeline?.length > 0 ? (
                    detailQuery.data.timeline.map((ev: any, idx: number) => (
                      <View key={idx} style={styles.timelineItem}>
                        <View style={styles.timelineDot} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.timelineStatus}>{ev.status}</Text>
                          <Text style={styles.metaText}>{ev.note}</Text>
                          <Text style={styles.timelineTime}>{ev.created_at ? new Date(ev.created_at).toLocaleString() : ''}</Text>
                        </View>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.metaText}>{t('admin.transfers.noTimeline')}</Text>
                  )}
                </View>

                {RETRYABLE.has(detailQuery.data.status) && (
                  <TouchableOpacity
                    style={styles.retryActionBtn}
                    disabled={retryMutation.isPending}
                    onPress={() => Alert.alert(
                      t('admin.transfers.retryReconciliation'),
                      t('admin.transfers.retryReconciliation'),
                      [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                          text: t('common.confirm'),
                          style: 'destructive',
                          onPress: () => retryMutation.mutate(detailQuery.data.txId),
                        },
                      ],
                    )}
                  >
                    {retryMutation.isPending ? (
                      <ActivityIndicator size="small" color={COLORS.white} />
                    ) : (
                      <>
                        <Ionicons name="refresh-outline" size={18} color={COLORS.white} />
                        <Text style={styles.retryActionText}>{t('admin.transfers.retryReconciliation')}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
                {['FUNDS_RECEIVED', 'OTP_SENT'].includes(detailQuery.data.status) && (
                  <TouchableOpacity style={styles.retryActionBtn} disabled={actionMutation.isPending} onPress={() => confirmAction(detailQuery.data.txId, 'recovery')}>
                    <Text style={styles.retryActionText}>Move to recovery</Text>
                  </TouchableOpacity>
                )}
                {detailQuery.data.paymentConfirmation?.refundEligible && (
                  <TouchableOpacity style={styles.retryActionBtn} disabled={actionMutation.isPending} onPress={() => confirmAction(detailQuery.data.txId, 'refund')}>
                    <Text style={styles.retryActionText}>Initiate permitted refund</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.limitRow}>
      <Text style={styles.limitLabel}>{label}</Text>
      <Text style={styles.limitValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

export default function AdminTransfersScreen() {
  return (
    <AdminGuard>
      <AdminTransfersContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.white },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.text },
  filterRow: { marginTop: 10, maxHeight: 44 },
  filterRowInner: { paddingHorizontal: 16, gap: 8 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  filterChipTextActive: { color: COLORS.white },
  content: { flex: 1 },
  contentInner: { padding: 16, paddingBottom: 32 },
  centerBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64, gap: 12 },
  errorText: { fontSize: 14, color: COLORS.textSecondary },
  retryBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryBtnText: { color: COLORS.white, fontWeight: '600' },
  row: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    gap: 6,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  txId: { fontSize: 13, fontWeight: '700', color: COLORS.text, flex: 1 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  rowMid: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amount: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  arrow: { fontSize: 14, color: COLORS.textSecondary },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  metaText: { fontSize: 12, color: COLORS.textSecondary },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeText: { fontSize: 11, color: COLORS.textSecondary },
  sectionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  detailGrid: { gap: 4, marginTop: 12 },
  limitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  limitLabel: { fontSize: 13, color: COLORS.textSecondary },
  limitValue: { fontSize: 13, fontWeight: '600', color: COLORS.text, flexShrink: 1, textAlign: 'right' },
  timelineItem: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary, marginTop: 5 },
  timelineStatus: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  timelineTime: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  retryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 24,
  },
  retryActionText: { color: COLORS.white, fontWeight: '700', fontSize: 14 },
});

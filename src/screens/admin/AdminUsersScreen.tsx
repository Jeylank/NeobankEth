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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
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

function accountStatusColor(status: string): string {
  if (status === 'SUSPENDED') return COLORS.red;
  if (status === 'REVIEW') return COLORS.amber;
  return COLORS.green;
}

function kycStatusColor(status: string): string {
  if (status === 'VERIFIED') return COLORS.green;
  if (status === 'REJECTED') return COLORS.red;
  if (status === 'PENDING') return COLORS.amber;
  return COLORS.textSecondary;
}

function riskScoreColor(score: number | null): string {
  if (score === null) return COLORS.textSecondary;
  if (score >= 60) return COLORS.red;
  if (score >= 30) return COLORS.amber;
  return COLORS.green;
}

function formatBalances(balances: Record<string, number>): string {
  const entries = Object.entries(balances ?? {});
  if (entries.length === 0) return '—';
  return entries.map(([cur, amt]) => `${amt.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${cur}`).join(' · ');
}

function AdminUsersContent() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const [searchText, setSearchText] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-users', activeQuery],
    queryFn: () => adminService.searchUsers({ q: activeQuery.trim() || undefined, limit: 50 }),
  });

  const detailQuery = useQuery({
    queryKey: ['admin-user-detail', selectedUid],
    queryFn: () => adminService.getUserDetail(selectedUid as string),
    enabled: Boolean(selectedUid),
  });

  const results = data?.results ?? [];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Ionicons name="people-outline" size={24} color={COLORS.white} />
          <Text style={styles.headerTitle}>{t('admin.users.title')}</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={COLORS.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('admin.users.searchPlaceholder')}
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
            <Text style={styles.errorText}>{t('admin.users.loadError')}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : results.length === 0 ? (
          <View style={styles.centerBox}>
            <Ionicons name="person-outline" size={32} color={COLORS.textSecondary} />
            <Text style={styles.errorText}>{t('admin.users.noResults')}</Text>
          </View>
        ) : (
          results.map((u: any) => (
            <TouchableOpacity key={u.uid} style={styles.row} onPress={() => setSelectedUid(u.uid)}>
              <View style={styles.rowTop}>
                <Text style={styles.userName} numberOfLines={1}>{u.displayName ?? u.email ?? u.uid}</Text>
                <View style={[styles.statusPill, { backgroundColor: `${accountStatusColor(u.accountStatus)}20` }]}>
                  <Text style={[styles.statusPillText, { color: accountStatusColor(u.accountStatus) }]}>{u.accountStatus}</Text>
                </View>
              </View>
              <Text style={styles.metaText} numberOfLines={1}>{u.email ?? '—'} · {u.uid}</Text>
              <View style={styles.rowBottom}>
                <View style={styles.badge}>
                  <Ionicons name="document-text-outline" size={12} color={kycStatusColor(u.kycStatus)} />
                  <Text style={[styles.badgeText, { color: kycStatusColor(u.kycStatus) }]}>{t('admin.users.kyc')}: {u.kycStatus}</Text>
                </View>
                <View style={styles.badge}>
                  <Ionicons name="shield-outline" size={12} color={riskScoreColor(u.riskScore)} />
                  <Text style={[styles.badgeText, { color: riskScoreColor(u.riskScore) }]}>
                    {t('admin.users.riskScore')}: {u.riskScore ?? '—'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <Modal visible={Boolean(selectedUid)} animationType="slide" onRequestClose={() => setSelectedUid(null)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setSelectedUid(null)} style={styles.backBtn}>
              <Ionicons name="close" size={24} color={COLORS.white} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle} numberOfLines={1}>{t('admin.users.detailTitle')}</Text>
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
                <Text style={styles.errorText}>{t('admin.users.loadError')}</Text>
              </View>
            ) : detailQuery.data ? (
              <>
                <View style={styles.sectionCard}>
                  <Text style={styles.userName}>{detailQuery.data.displayName ?? detailQuery.data.email ?? detailQuery.data.uid}</Text>
                  <Text style={styles.metaText}>{detailQuery.data.uid}</Text>
                  <View style={[styles.statusPill, { backgroundColor: `${accountStatusColor(detailQuery.data.accountStatus)}20`, marginTop: 8, alignSelf: 'flex-start' }]}>
                    <Text style={[styles.statusPillText, { color: accountStatusColor(detailQuery.data.accountStatus) }]}>{detailQuery.data.accountStatus}</Text>
                  </View>
                  <View style={styles.detailGrid}>
                    <DetailRow label={t('admin.users.email')} value={detailQuery.data.email ?? '—'} />
                    <DetailRow label={t('admin.users.phone')} value={detailQuery.data.phoneNumber ?? '—'} />
                    <DetailRow label={t('admin.users.createdAt')} value={detailQuery.data.createdAt ? new Date(detailQuery.data.createdAt).toLocaleString() : '—'} />
                    <DetailRow label={t('admin.users.lastSignIn')} value={detailQuery.data.lastSignIn ? new Date(detailQuery.data.lastSignIn).toLocaleString() : '—'} />
                  </View>
                </View>

                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeaderRow}>
                    <Ionicons name="wallet-outline" size={18} color={COLORS.primary} />
                    <Text style={styles.sectionTitle}>{t('admin.users.walletSection')}</Text>
                  </View>
                  <DetailRow label={t('admin.users.walletBalance')} value={formatBalances(detailQuery.data.wallet?.balances)} />
                </View>

                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeaderRow}>
                    <Ionicons name="swap-horizontal-outline" size={18} color={COLORS.primary} />
                    <Text style={styles.sectionTitle}>{t('admin.users.transfersSection')}</Text>
                  </View>
                  <DetailRow label={t('admin.users.numberOfTransfers')} value={String((detailQuery.data.transfers?.sentCount ?? 0) + (detailQuery.data.transfers?.receivedCount ?? 0))} />
                  <DetailRow label={t('admin.users.transfersSent')} value={String(detailQuery.data.transfers?.sentCount ?? 0)} />
                  <DetailRow label={t('admin.users.transfersReceived')} value={String(detailQuery.data.transfers?.receivedCount ?? 0)} />
                  <DetailRow label={t('admin.users.totalSent')} value={formatBalances(detailQuery.data.transfers?.totalSent)} />
                  <DetailRow label={t('admin.users.totalReceived')} value={formatBalances(detailQuery.data.transfers?.totalReceived)} />
                </View>

                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeaderRow}>
                    <Ionicons name="shield-checkmark-outline" size={18} color={COLORS.primary} />
                    <Text style={styles.sectionTitle}>{t('admin.users.riskSection')}</Text>
                  </View>
                  <DetailRow label={t('admin.users.riskScore')} value={detailQuery.data.riskScore !== null ? String(detailQuery.data.riskScore) : t('admin.users.noRiskData')} />
                  <DetailRow label={t('admin.users.isFrozen')} value={detailQuery.data.riskFlag?.isFrozen ? t('common.yes') : t('common.no')} />
                  <DetailRow label={t('admin.users.isBlocked')} value={detailQuery.data.riskFlag?.isBlocked ? t('common.yes') : t('common.no')} />
                  <DetailRow label={t('admin.users.reviewRequired')} value={detailQuery.data.riskFlag?.reviewRequired ? t('common.yes') : t('common.no')} />
                  {detailQuery.data.riskFlag?.reason && (
                    <DetailRow label={t('admin.users.reason')} value={detailQuery.data.riskFlag.reason} />
                  )}
                </View>

                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeaderRow}>
                    <Ionicons name="document-text-outline" size={18} color={COLORS.primary} />
                    <Text style={styles.sectionTitle}>{t('admin.users.kycSection')}</Text>
                  </View>
                  <DetailRow label={t('admin.users.kyc')} value={detailQuery.data.kyc?.status ?? '—'} />
                  <DetailRow label={t('admin.users.fullName')} value={detailQuery.data.kyc?.fullName ?? '—'} />
                  <DetailRow label={t('admin.users.documentType')} value={detailQuery.data.kyc?.documentType ?? '—'} />
                  <DetailRow label={t('admin.users.submittedAt')} value={detailQuery.data.kyc?.submittedAt ? new Date(detailQuery.data.kyc.submittedAt).toLocaleString() : '—'} />
                </View>

                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeaderRow}>
                    <Ionicons name="time-outline" size={18} color={COLORS.primary} />
                    <Text style={styles.sectionTitle}>{t('admin.users.verificationHistory')}</Text>
                  </View>
                  {detailQuery.data.verificationHistory?.length > 0 ? (
                    detailQuery.data.verificationHistory.map((ev: any, idx: number) => (
                      <View key={idx} style={styles.timelineItem}>
                        <View style={styles.timelineDot} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.timelineStatus}>{ev.action}</Text>
                          {ev.reason && <Text style={styles.metaText}>{ev.reason}</Text>}
                          <Text style={styles.timelineTime}>{ev.timestamp ? new Date(ev.timestamp).toLocaleString() : ''}</Text>
                        </View>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.metaText}>{t('admin.users.noVerificationHistory')}</Text>
                  )}
                </View>
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

export default function AdminUsersScreen() {
  return (
    <AdminGuard>
      <AdminUsersContent />
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
  content: { flex: 1, marginTop: 12 },
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
  userName: { fontSize: 14, fontWeight: '700', color: COLORS.text, flex: 1 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  rowBottom: { flexDirection: 'row', justifyContent: 'flex-start', flexWrap: 'wrap', gap: 12 },
  metaText: { fontSize: 12, color: COLORS.textSecondary },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeText: { fontSize: 11, fontWeight: '600' },
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
});

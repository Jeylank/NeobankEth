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
import type { TreasuryReservation, ReservationStatus } from '../../services/treasury/treasuryTypes';

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
  grey: '#9CA3AF',
  greyL: '#F3F4F6',
  border: '#E5E7EB',
};

const STATUS_COLORS: Record<ReservationStatus, { bg: string; text: string }> = {
  pending: { bg: C.amberL, text: C.amber },
  confirmed: { bg: C.greenL, text: C.green },
  released: { bg: C.greyL, text: C.grey },
  expired: { bg: C.redL, text: C.red },
  failed: { bg: C.redL, text: C.red },
};

type FilterTab = 'pending' | 'confirmed' | 'released' | 'all';

function formatETB(n: number): string {
  return n.toLocaleString() + ' ETB';
}

function timeLabel(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const min = Math.round(diff / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(isoDate).toLocaleDateString();
}

function ReservationCard({
  res,
  onRelease,
}: {
  res: TreasuryReservation;
  onRelease: (id: string) => void;
}) {
  const { t } = useTranslation();
  const sc = STATUS_COLORS[res.status] ?? STATUS_COLORS.pending;
  const isExpiringSoon =
    res.status === 'pending' &&
    new Date(res.expiresAt).getTime() - Date.now() < 30 * 60 * 1000;

  return (
    <View style={[styles.card, isExpiringSoon && styles.cardWarning]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.resId} numberOfLines={1}>{res.reservationId}</Text>
          <Text style={styles.resTx} numberOfLines={1}>TX: {res.txId}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
          <Text style={[styles.statusText, { color: sc.text }]}>{res.status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.detailRow}>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>{t('treasury.amount')}</Text>
          <Text style={styles.detailVal}>{formatETB(res.amount)}</Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>{t('treasury.provider')}</Text>
          <Text style={styles.detailVal}>{res.provider.replace('BANK_', '')}</Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>{t('treasury.created')}</Text>
          <Text style={styles.detailVal}>{timeLabel(res.createdAt)}</Text>
        </View>
      </View>

      {res.status === 'pending' && (
        <View style={styles.expiryRow}>
          <Ionicons
            name={isExpiringSoon ? 'warning-outline' : 'time-outline'}
            size={13}
            color={isExpiringSoon ? C.amber : C.sub}
          />
          <Text style={[styles.expiryText, isExpiringSoon && { color: C.amber }]}>
            {t('treasury.expiresAt')}: {new Date(res.expiresAt).toLocaleTimeString()}
          </Text>
          <TouchableOpacity
            style={styles.releaseBtn}
            onPress={() => onRelease(res.reservationId)}
          >
            <Text style={styles.releaseBtnText}>{t('treasury.release')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {res.releasedReason && (
        <Text style={styles.reasonText}>{t('treasury.reason')}: {res.releasedReason}</Text>
      )}
    </View>
  );
}

function AdminTreasuryReservationsContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [filter, setFilter] = useState<FilterTab>('pending');
  const [refreshing, setRefreshing] = useState(false);

  const { data: reservations = [], isLoading } = useQuery<TreasuryReservation[]>({
    queryKey: ['treasury-reservations', filter],
    queryFn: () =>
      adminService.getTreasuryReservations(filter === 'all' ? undefined : { status: filter }),
  });

  const releaseMutation = useMutation({
    mutationFn: (id: string) => adminService.releaseTreasuryReservation(id, user?.uid ?? 'admin'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['treasury-reservations'] }),
  });

  const handleRelease = useCallback(
    (id: string) => {
      Alert.alert(t('treasury.release'), t('treasury.releaseConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('treasury.release'), onPress: () => releaseMutation.mutate(id) },
      ]);
    },
    [t, releaseMutation],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['treasury-reservations'] });
    setRefreshing(false);
  }, [queryClient]);

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'pending', label: t('treasury.pending') },
    { key: 'confirmed', label: t('treasury.confirmed') },
    { key: 'released', label: t('treasury.released') },
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
        <Text style={styles.count}>{reservations.length} {t('treasury.reservations')}</Text>
        {isLoading ? (
          <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 60 }} />
        ) : reservations.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="hourglass-outline" size={40} color={C.sub} />
            <Text style={styles.emptyText}>{t('treasury.noReservations')}</Text>
          </View>
        ) : (
          reservations.map((res) => (
            <ReservationCard key={res.reservationId} res={res} onRelease={handleRelease} />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminTreasuryReservationsScreen() {
  return (
    <AdminGuard>
      <AdminTreasuryReservationsContent />
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
  cardWarning: { borderLeftWidth: 3, borderLeftColor: C.amber },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  resId: { fontSize: 11, fontWeight: '700', color: C.text, fontFamily: 'monospace' },
  resTx: { fontSize: 10, color: C.sub, marginTop: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontWeight: '700' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  detailItem: {},
  detailLabel: { fontSize: 10, color: C.sub },
  detailVal: { fontSize: 13, fontWeight: '600', color: C.text, marginTop: 1 },
  expiryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 },
  expiryText: { flex: 1, fontSize: 11, color: C.sub },
  releaseBtn: { backgroundColor: C.redL, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  releaseBtnText: { fontSize: 11, color: C.red, fontWeight: '600' },
  reasonText: { fontSize: 10, color: C.sub, marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 13, color: C.sub, marginTop: 10 },
});

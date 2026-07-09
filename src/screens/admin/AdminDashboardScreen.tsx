import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
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
  cyan: '#0891B2',
};

interface CardDef {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  value: (s: any) => string | number;
}

const CARD_DEFS: CardDef[] = [
  { key: 'totalTransfers',    icon: 'swap-horizontal-outline', color: COLORS.primary, bg: '#ECFDF5', value: (s) => s?.transfers?.total ?? 0 },
  { key: 'pendingTransfers',  icon: 'time-outline',            color: COLORS.amber,   bg: '#FFFBEB', value: (s) => s?.transfers?.pending ?? 0 },
  { key: 'paymentPending',    icon: 'card-outline',            color: COLORS.blue,    bg: '#EFF6FF', value: (s) => s?.transfers?.paymentPending ?? 0 },
  { key: 'fundsReceived',     icon: 'download-outline',        color: COLORS.cyan,    bg: '#ECFEFF', value: (s) => s?.transfers?.fundsReceived ?? 0 },
  { key: 'otpSent',           icon: 'key-outline',             color: COLORS.purple,  bg: '#F5F3FF', value: (s) => s?.transfers?.otpSent ?? 0 },
  { key: 'recoveryPending',   icon: 'refresh-outline',         color: '#DC2626',      bg: '#FEF2F2', value: (s) => s?.transfers?.recoveryPending ?? 0 },
  { key: 'paidOut',           icon: 'checkmark-done-outline',  color: COLORS.green,   bg: '#ECFDF5', value: (s) => s?.transfers?.paidOut ?? 0 },
  { key: 'failedTransfers',   icon: 'close-circle-outline',    color: COLORS.red,     bg: '#FEF2F2', value: (s) => s?.transfers?.failed ?? 0 },
  { key: 'refunds',           icon: 'return-up-back-outline',  color: '#7C3AED',      bg: '#F5F3FF', value: (s) => s?.transfers?.refunds ?? 0 },
  { key: 'activeAgents',      icon: 'people-outline',          color: COLORS.green,   bg: '#ECFDF5', value: (s) => s?.agents?.active ?? 0 },
  { key: 'suspendedAgents',   icon: 'person-remove-outline',   color: COLORS.textSecondary, bg: '#F3F4F6', value: (s) => s?.agents?.suspended ?? 0 },
  { key: 'kycPending',        icon: 'document-text-outline',   color: COLORS.amber,   bg: '#FFFBEB', value: (s) => s?.kycPending ?? 0 },
  { key: 'riskAlerts',        icon: 'warning-outline',         color: COLORS.red,     bg: '#FEF2F2', value: (s) => s?.riskAlerts ?? 0 },
];

function formatCurrency(amount: number): string {
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ETB`;
}

function AdminDashboardContent() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-dashboard-summary'],
    queryFn: () => adminService.getDashboardSummary(),
    refetchInterval: 30_000,
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Ionicons name="speedometer-outline" size={24} color={COLORS.white} />
          <Text style={styles.headerTitle}>{t('admin.dashboard.title')}</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} colors={[COLORS.primary]} />
        }
      >
        {isLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : error ? (
          <View style={styles.centerBox}>
            <Ionicons name="alert-circle-outline" size={32} color={COLORS.red} />
            <Text style={styles.errorText}>{t('admin.dashboard.loadError')}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.grid}>
              {CARD_DEFS.map((card) => (
                <View key={card.key} style={styles.card}>
                  <View style={[styles.iconCircle, { backgroundColor: card.bg }]}>
                    <Ionicons name={card.icon} size={22} color={card.color} />
                  </View>
                  <Text style={styles.cardValue}>{card.value(data)}</Text>
                  <Text style={styles.cardLabel}>{t(`admin.dashboard.cards.${card.key}`)}</Text>
                </View>
              ))}
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="trending-up-outline" size={20} color={COLORS.primary} />
                <Text style={styles.sectionTitle}>{t('admin.dashboard.cards.dailyTransferVolume')}</Text>
              </View>
              <Text style={styles.bigValue}>{formatCurrency(data?.dailyVolume?.amount ?? 0)}</Text>
              <Text style={styles.sectionSubtext}>
                {t('admin.dashboard.transfersToday', { count: data?.dailyVolume?.count ?? 0 })} · {data?.dailyVolume?.date}
              </Text>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="options-outline" size={20} color={COLORS.primary} />
                <Text style={styles.sectionTitle}>{t('admin.dashboard.cards.platformLimits')}</Text>
              </View>
              {data?.platformLimits ? (
                <View style={styles.limitsGrid}>
                  <LimitRow label={t('admin.dashboard.maxTransferAmount')} value={formatCurrency(data.platformLimits.maxTransferAmount)} />
                  <LimitRow label={t('admin.dashboard.maxDailyTransfers')} value={String(data.platformLimits.maxDailyTransfersPerUser)} />
                  <LimitRow label={t('admin.dashboard.maxDailyVolume')} value={formatCurrency(data.platformLimits.maxDailyVolumePerUser)} />
                  <LimitRow label={t('admin.dashboard.maxPlatformExposure')} value={formatCurrency(data.platformLimits.maxTotalPlatformExposure)} />
                </View>
              ) : (
                <Text style={styles.sectionSubtext}>{t('admin.dashboard.noLimits')}</Text>
              )}
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons
                  name={data?.closedBeta?.paused ? 'pause-circle-outline' : 'play-circle-outline'}
                  size={20}
                  color={data?.closedBeta?.paused ? COLORS.red : COLORS.green}
                />
                <Text style={styles.sectionTitle}>{t('admin.dashboard.cards.closedBetaStatus')}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: data?.closedBeta?.paused ? '#FEF2F2' : '#ECFDF5' }]}>
                <Text style={[styles.statusPillText, { color: data?.closedBeta?.paused ? COLORS.red : COLORS.green }]}>
                  {data?.closedBeta?.paused ? t('admin.dashboard.betaPaused') : t('admin.dashboard.betaLive')}
                </Text>
              </View>
              <Text style={styles.sectionSubtext}>
                {t('admin.dashboard.exposure')}: {formatCurrency(data?.closedBeta?.exposure ?? 0)} · {t('admin.dashboard.exposureRemaining')}: {formatCurrency(data?.closedBeta?.exposureRemaining ?? 0)}
              </Text>
            </View>

            <Text style={styles.fetchedAt}>
              {t('admin.dashboard.lastUpdated')}: {data?.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : '—'}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function LimitRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.limitRow}>
      <Text style={styles.limitLabel}>{label}</Text>
      <Text style={styles.limitValue}>{value}</Text>
    </View>
  );
}

export default function AdminDashboardScreen() {
  return (
    <AdminGuard>
      <AdminDashboardContent />
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
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: COLORS.white },
  content: { flex: 1 },
  contentInner: { padding: 16, paddingBottom: 32 },
  centerBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64, gap: 12 },
  errorText: { fontSize: 14, color: COLORS.textSecondary },
  retryBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnText: { color: COLORS.white, fontWeight: '600' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  card: {
    width: '31%',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardValue: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  cardLabel: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
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
  bigValue: { fontSize: 24, fontWeight: '700', color: COLORS.primary, marginBottom: 4 },
  sectionSubtext: { fontSize: 12, color: COLORS.textSecondary },
  limitsGrid: { gap: 8 },
  limitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  limitLabel: { fontSize: 13, color: COLORS.textSecondary },
  limitValue: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 8,
  },
  statusPillText: { fontSize: 13, fontWeight: '700' },
  fetchedAt: { fontSize: 11, color: COLORS.textSecondary, textAlign: 'center', marginTop: 4 },
});

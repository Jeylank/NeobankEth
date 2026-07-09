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
  teal: '#0D9488',
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: COLORS.red,
  high: COLORS.amber,
  medium: COLORS.blue,
  low: COLORS.textSecondary,
};

interface CardDef {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  value: string | number;
  label: string;
  sub?: string;
  warn?: boolean;
}

function AdminBetaRiskSummaryContent() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-beta-risk-summary'],
    queryFn: () => adminService.getBetaRiskSummary(),
    refetchInterval: 30_000,
  });

  const cards: CardDef[] = data
    ? [
        {
          key: 'totalUsers',
          icon: 'people-outline',
          color: COLORS.primary,
          value: data.users.totalBetaUsers,
          label: t('admin.betaRisk.totalBetaUsers'),
        },
        {
          key: 'activeToday',
          icon: 'pulse-outline',
          color: COLORS.green,
          value: data.users.activeToday,
          label: t('admin.betaRisk.activeToday'),
        },
        {
          key: 'pendingKyc',
          icon: 'document-text-outline',
          color: COLORS.blue,
          value: data.kyc.pending,
          label: t('admin.betaRisk.pendingKyc'),
          warn: data.kyc.pending > 0,
        },
        {
          key: 'fraudReview',
          icon: 'warning-outline',
          color: COLORS.amber,
          value: data.fraud.pendingReview,
          label: t('admin.betaRisk.fraudReview'),
          sub: t('admin.betaRisk.blockedLast24h', { count: data.fraud.blockedLast24h }),
          warn: data.fraud.pendingReview > 0,
        },
        {
          key: 'blockedTransfers',
          icon: 'ban-outline',
          color: COLORS.red,
          value: data.transfers.blocked,
          label: t('admin.betaRisk.blockedTransfers'),
          warn: data.transfers.blocked > 0,
        },
        {
          key: 'failedTransfers',
          icon: 'close-circle-outline',
          color: COLORS.red,
          value: data.transfers.failed,
          label: t('admin.betaRisk.failedTransfers'),
          warn: data.transfers.failed > 0,
        },
        {
          key: 'reconciliationQueue',
          icon: 'git-compare-outline',
          color: COLORS.purple,
          value: data.reconciliation.queueLength,
          label: t('admin.betaRisk.reconciliationQueue'),
          sub: t('admin.betaRisk.mismatched', { count: data.reconciliation.mismatched }),
          warn: data.reconciliation.queueLength > 0 || data.reconciliation.mismatched > 0,
        },
        {
          key: 'liquidityWarnings',
          icon: 'cash-outline',
          color: COLORS.teal,
          value: data.liquidity.lowFloatAgents,
          label: t('admin.betaRisk.liquidityWarnings'),
          sub: t('admin.betaRisk.offlineAgents', { count: data.liquidity.offlineAgents }),
          warn: data.liquidity.lowFloatAgents > 0,
        },
      ]
    : [];

  const healthOk = data?.health.status === 'ok';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Ionicons name="shield-checkmark-outline" size={24} color={COLORS.white} />
          <Text style={styles.headerTitle}>{t('admin.betaRisk.title')}</Text>
        </View>
        <TouchableOpacity onPress={() => refetch()} style={styles.backBtn}>
          <Ionicons name="refresh-outline" size={22} color={COLORS.white} />
        </TouchableOpacity>
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
            <Text style={styles.errorText}>{t('admin.betaRisk.loadError')}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Firestore / API health banner */}
            <View
              style={[
                styles.healthBanner,
                { backgroundColor: healthOk ? '#ECFDF5' : '#FEF2F2', borderColor: healthOk ? COLORS.green : COLORS.red },
              ]}
            >
              <Ionicons
                name={healthOk ? 'checkmark-circle' : 'alert-circle'}
                size={20}
                color={healthOk ? COLORS.green : COLORS.red}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.healthTitle, { color: healthOk ? COLORS.green : COLORS.red }]}>
                  {t('admin.betaRisk.systemStatus', { status: (data?.health.status ?? '').toUpperCase() })}
                </Text>
                <Text style={styles.healthSub}>
                  {t('admin.betaRisk.firestoreStatus', { status: data?.health.firestore })} ·{' '}
                  {t('admin.betaRisk.uptime', { seconds: data?.health.uptimeSeconds ?? 0 })}
                </Text>
              </View>
            </View>

            {/* Metric cards grid */}
            <View style={styles.grid}>
              {cards.map((card) => (
                <View key={card.key} style={[styles.card, card.warn && styles.cardWarn]}>
                  <View style={[styles.cardIconWrap, { backgroundColor: `${card.color}20` }]}>
                    <Ionicons name={card.icon} size={18} color={card.color} />
                  </View>
                  <Text style={styles.cardValue}>{card.value}</Text>
                  <Text style={styles.cardLabel}>{card.label}</Text>
                  {card.sub && <Text style={styles.cardSub}>{card.sub}</Text>}
                </View>
              ))}
            </View>

            {/* Recent alerts */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>{t('admin.betaRisk.recentAlerts')}</Text>
                <Text style={styles.alertCount}>{t('admin.betaRisk.alertCount', { count: data?.alerts.total ?? 0 })}</Text>
              </View>
              {(data?.alerts.recent ?? []).length === 0 ? (
                <View style={styles.noAlertsBox}>
                  <Ionicons name="checkmark-done-circle-outline" size={28} color={COLORS.green} />
                  <Text style={styles.noAlertsText}>{t('admin.betaRisk.noAlerts')}</Text>
                </View>
              ) : (
                data!.alerts.recent.map((alert: any, idx: number) => (
                  <View key={`${alert.type}-${idx}`} style={styles.alertRow}>
                    <View style={[styles.severityDot, { backgroundColor: SEVERITY_COLOR[alert.severity] ?? COLORS.textSecondary }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.alertMessage}>{alert.message}</Text>
                      <Text style={styles.alertMeta}>
                        {alert.type} · {new Date(alert.detectedAt).toLocaleString()}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminBetaRiskSummaryScreen() {
  return (
    <AdminGuard>
      <AdminBetaRiskSummaryContent />
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
  content: { flex: 1, marginTop: 12 },
  contentInner: { padding: 16, paddingBottom: 32 },
  centerBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64, gap: 12 },
  errorText: { fontSize: 14, color: COLORS.textSecondary },
  retryBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryBtnText: { color: COLORS.white, fontWeight: '600' },
  healthBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  healthTitle: { fontSize: 13, fontWeight: '700' },
  healthSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    width: '47%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardWarn: { borderWidth: 1.5, borderColor: '#FCA5A5' },
  cardIconWrap: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  cardValue: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  cardLabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  cardSub: { fontSize: 10, color: COLORS.textSecondary, marginTop: 4 },
  sectionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  alertCount: { fontSize: 12, color: COLORS.textSecondary },
  noAlertsBox: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  noAlertsText: { fontSize: 13, color: COLORS.textSecondary },
  alertRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  severityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  alertMessage: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  alertMeta: { fontSize: 10, color: COLORS.textSecondary, marginTop: 3 },
});

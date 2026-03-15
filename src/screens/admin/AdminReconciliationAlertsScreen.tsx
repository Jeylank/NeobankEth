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
  ReconciliationAlert,
  ReconciliationAlertStatus,
} from '../../services/reconciliation/reconciliationTypes';

const COLORS = {
  primary: '#006633',
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#1F2937',
  textSecondary: '#6B7280',
  green: '#10B981',
  greenLight: '#D1FAE5',
  blue: '#3B82F6',
  blueLight: '#DBEAFE',
  red: '#EF4444',
  redLight: '#FEE2E2',
  amber: '#F59E0B',
  amberLight: '#FEF3C7',
  purple: '#8B5CF6',
  purpleLight: '#F5F3FF',
  grey: '#9CA3AF',
  greyLight: '#F3F4F6',
  border: '#E5E7EB',
};

type FilterTab = 'all' | 'open' | 'investigating' | 'resolved';

const SEVERITY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  critical: { bg: COLORS.redLight, text: COLORS.red, dot: COLORS.red },
  high: { bg: COLORS.amberLight, text: COLORS.amber, dot: COLORS.amber },
  medium: { bg: COLORS.blueLight, text: COLORS.blue, dot: COLORS.blue },
  low: { bg: COLORS.greyLight, text: COLORS.grey, dot: COLORS.grey },
};

const ALERT_TYPE_ICONS: Record<string, string> = {
  AMOUNT_MISMATCH: 'cash-outline',
  STATUS_MISMATCH: 'sync-outline',
  MISSING_EXTERNAL: 'cloud-offline-outline',
  MISSING_INTERNAL: 'search-outline',
  DUPLICATE_PAYOUT: 'copy-outline',
  STALE_RESERVATION: 'time-outline',
  SETTLEMENT_OVERDUE: 'hourglass-outline',
  LEDGER_INCONSISTENCY: 'git-branch-outline',
};

function AlertCard({
  alert,
  onResolve,
  onIgnore,
}: {
  alert: ReconciliationAlert;
  onResolve: (id: string) => void;
  onIgnore: (id: string) => void;
}) {
  const { t } = useTranslation();
  const sc = SEVERITY_COLORS[alert.severity] ?? SEVERITY_COLORS.low;
  const icon = ALERT_TYPE_ICONS[alert.type] ?? 'warning-outline';
  const isActionable = alert.status === 'open' || alert.status === 'investigating';

  return (
    <View style={[styles.alertCard, alert.severity === 'critical' && styles.alertCardCritical]}>
      <View style={styles.alertHeader}>
        <View style={[styles.alertIconCircle, { backgroundColor: sc.bg }]}>
          <Ionicons name={icon as any} size={16} color={sc.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.alertType}>{alert.type.replace(/_/g, ' ')}</Text>
          <Text style={styles.alertTxId} numberOfLines={1}>
            TX: {alert.txId} · {alert.provider}
          </Text>
        </View>
        <View style={[styles.severityBadge, { backgroundColor: sc.bg }]}>
          <Text style={[styles.severityText, { color: sc.text }]}>
            {alert.severity.toUpperCase()}
          </Text>
        </View>
      </View>

      <Text style={styles.alertDescription} numberOfLines={2}>
        {alert.description}
      </Text>

      <View style={styles.alertFooter}>
        <View style={[styles.statusChip, { backgroundColor: alert.status === 'open' ? COLORS.redLight : COLORS.greyLight }]}>
          <Text style={[styles.statusChipText, { color: alert.status === 'open' ? COLORS.red : COLORS.grey }]}>
            {alert.status.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.alertDate}>
          {new Date(alert.createdAt).toLocaleDateString()}
        </Text>
      </View>

      {isActionable && (
        <View style={styles.alertActions}>
          <TouchableOpacity
            style={styles.resolveBtn}
            onPress={() => onResolve(alert.alertId)}
          >
            <Ionicons name="checkmark-circle-outline" size={14} color={COLORS.green} />
            <Text style={styles.resolveBtnText}>{t('reconciliation.resolve')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ignoreBtn}
            onPress={() => onIgnore(alert.alertId)}
          >
            <Ionicons name="eye-off-outline" size={14} color={COLORS.grey} />
            <Text style={styles.ignoreBtnText}>{t('reconciliation.ignore')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function AdminReconciliationAlertsContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [filter, setFilter] = useState<FilterTab>('open');
  const [refreshing, setRefreshing] = useState(false);

  const { data: alerts = [], isLoading } = useQuery<ReconciliationAlert[]>({
    queryKey: ['reconciliation-alerts', filter],
    queryFn: () =>
      adminService.getReconciliationAlerts(
        filter === 'all' ? {} : { status: filter as ReconciliationAlertStatus },
      ),
  });

  const resolveMutation = useMutation({
    mutationFn: (alertId: string) =>
      adminService.resolveReconciliationAlert(alertId, user?.uid ?? 'admin'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reconciliation-alerts'] }),
  });

  const ignoreMutation = useMutation({
    mutationFn: (alertId: string) =>
      adminService.ignoreReconciliationAlert(alertId, user?.uid ?? 'admin'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reconciliation-alerts'] }),
  });

  const handleResolve = useCallback(
    (alertId: string) => {
      Alert.alert(t('reconciliation.resolve'), t('reconciliation.resolveConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('reconciliation.resolve'), onPress: () => resolveMutation.mutate(alertId) },
      ]);
    },
    [t, resolveMutation],
  );

  const handleIgnore = useCallback(
    (alertId: string) => {
      Alert.alert(t('reconciliation.ignore'), t('reconciliation.ignoreConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('reconciliation.ignore'), onPress: () => ignoreMutation.mutate(alertId) },
      ]);
    },
    [t, ignoreMutation],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['reconciliation-alerts'] });
    setRefreshing(false);
  }, [queryClient]);

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'open', label: t('reconciliation.open') },
    { key: 'investigating', label: t('reconciliation.investigating') },
    { key: 'resolved', label: t('reconciliation.resolved') },
    { key: 'all', label: t('reconciliation.all') },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Filter tabs */}
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
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Summary row */}
        <View style={styles.summaryRow}>
          <Text style={styles.summaryCount}>{alerts.length} {t('reconciliation.alerts')}</Text>
          {alerts.filter((a) => a.severity === 'critical').length > 0 && (
            <View style={styles.criticalChip}>
              <Text style={styles.criticalChipText}>
                {alerts.filter((a) => a.severity === 'critical').length} {t('reconciliation.critical')}
              </Text>
            </View>
          )}
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : alerts.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="shield-checkmark-outline" size={48} color={COLORS.textSecondary} />
            <Text style={styles.emptyText}>{t('reconciliation.noAlerts')}</Text>
          </View>
        ) : (
          alerts.map((alert) => (
            <AlertCard
              key={alert.alertId}
              alert={alert}
              onResolve={handleResolve}
              onIgnore={handleIgnore}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminReconciliationAlertsScreen() {
  return (
    <AdminGuard>
      <AdminReconciliationAlertsContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  tabBar: { backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tabContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: COLORS.greyLight },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 13, color: COLORS.textSecondary, fontWeight: '500' },
  tabTextActive: { color: COLORS.white, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  summaryCount: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  criticalChip: { backgroundColor: COLORS.redLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  criticalChipText: { fontSize: 11, color: COLORS.red, fontWeight: '700' },
  alertCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  alertCardCritical: { borderLeftWidth: 3, borderLeftColor: COLORS.red },
  alertHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  alertIconCircle: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  alertType: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  alertTxId: { fontSize: 11, color: COLORS.textSecondary, marginTop: 1 },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  severityText: { fontSize: 10, fontWeight: '700' },
  alertDescription: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18, marginBottom: 10 },
  alertFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusChipText: { fontSize: 10, fontWeight: '700' },
  alertDate: { fontSize: 11, color: COLORS.textSecondary },
  alertActions: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10 },
  resolveBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    backgroundColor: COLORS.greenLight,
    borderRadius: 8,
  },
  resolveBtnText: { fontSize: 12, fontWeight: '600', color: COLORS.green },
  ignoreBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    backgroundColor: COLORS.greyLight,
    borderRadius: 8,
  },
  ignoreBtnText: { fontSize: 12, fontWeight: '600', color: COLORS.grey },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: COLORS.textSecondary, marginTop: 12 },
});

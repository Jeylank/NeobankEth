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
  TreasuryAlert,
  TreasuryAlertType,
  TreasuryAlertStatus,
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

const SEVERITY_COLORS = {
  critical: { bg: C.redL, text: C.red, dot: C.red },
  high: { bg: C.amberL, text: C.amber, dot: C.amber },
  medium: { bg: C.blueL, text: C.blue, dot: C.blue },
  info: { bg: C.greyL, text: C.grey, dot: C.grey },
};

const ALERT_ICONS: Record<TreasuryAlertType, string> = {
  LOW_LIQUIDITY: 'water-outline',
  CRITICAL_LIQUIDITY: 'warning',
  NEGATIVE_EXPOSURE: 'alert-circle',
  OVERDUE_SETTLEMENT: 'hourglass-outline',
  STUCK_RESERVATION: 'time-outline',
  POOL_SUSPENDED: 'pause-circle-outline',
  SETTLEMENT_DISPUTED: 'chatbubble-ellipses-outline',
};

type FilterTab = 'open' | 'acknowledged' | 'resolved' | 'all';

function AlertCard({
  alert,
  onAcknowledge,
  onResolve,
  onSuppress,
}: {
  alert: TreasuryAlert;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onSuppress: (id: string) => void;
}) {
  const { t } = useTranslation();
  const sc = SEVERITY_COLORS[alert.severity] ?? SEVERITY_COLORS.info;
  const icon = ALERT_ICONS[alert.type] ?? 'warning-outline';
  const isActionable = alert.status === 'open';
  const isAcknowledged = alert.status === 'acknowledged';

  return (
    <View style={[styles.card, alert.severity === 'critical' && styles.cardCritical]}>
      <View style={styles.cardHeader}>
        <View style={[styles.alertIcon, { backgroundColor: sc.bg }]}>
          <Ionicons name={icon as any} size={16} color={sc.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.alertType}>{alert.type.replace(/_/g, ' ')}</Text>
          <Text style={styles.alertProvider}>{alert.provider.replace('BANK_', '')} {alert.currency && `· ${alert.currency}`}</Text>
        </View>
        <View style={[styles.severityBadge, { backgroundColor: sc.bg }]}>
          <Text style={[styles.severityText, { color: sc.text }]}>{alert.severity.toUpperCase()}</Text>
        </View>
      </View>

      <Text style={styles.description} numberOfLines={3}>{alert.description}</Text>

      <View style={styles.footer}>
        <View style={[styles.statusChip, {
          backgroundColor: alert.status === 'open' ? C.redL :
            alert.status === 'acknowledged' ? C.amberL :
            alert.status === 'resolved' ? C.greenL : C.greyL,
        }]}>
          <Text style={[styles.statusChipText, {
            color: alert.status === 'open' ? C.red :
              alert.status === 'acknowledged' ? C.amber :
              alert.status === 'resolved' ? C.green : C.grey,
          }]}>
            {alert.status.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.dateText}>
          {new Date(alert.createdAt).toLocaleDateString()}
        </Text>
      </View>

      {(isActionable || isAcknowledged) && (
        <View style={styles.actions}>
          {isActionable && (
            <TouchableOpacity style={styles.ackBtn} onPress={() => onAcknowledge(alert.alertId)}>
              <Ionicons name="eye-outline" size={13} color={C.amber} />
              <Text style={styles.ackBtnText}>{t('treasury.acknowledge')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.resolveBtn} onPress={() => onResolve(alert.alertId)}>
            <Ionicons name="checkmark-circle-outline" size={13} color={C.green} />
            <Text style={styles.resolveBtnText}>{t('treasury.resolve')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.suppressBtn} onPress={() => onSuppress(alert.alertId)}>
            <Ionicons name="eye-off-outline" size={13} color={C.grey} />
            <Text style={styles.suppressBtnText}>{t('treasury.suppress')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function AdminTreasuryAlertsContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [filter, setFilter] = useState<FilterTab>('open');
  const [refreshing, setRefreshing] = useState(false);

  const { data: alerts = [], isLoading } = useQuery<TreasuryAlert[]>({
    queryKey: ['treasury-alerts', filter],
    queryFn: () =>
      adminService.getTreasuryAlerts(
        filter === 'all' ? {} : { status: filter as TreasuryAlertStatus },
      ),
  });

  const ackMutation = useMutation({
    mutationFn: (id: string) => adminService.acknowledgeTreasuryAlert(id, user?.uid ?? 'admin'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['treasury-alerts'] }),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => adminService.resolveTreasuryAlert(id, user?.uid ?? 'admin'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['treasury-alerts'] }),
  });

  const suppressMutation = useMutation({
    mutationFn: (id: string) => adminService.suppressTreasuryAlert(id, user?.uid ?? 'admin'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['treasury-alerts'] }),
  });

  const confirmAction = useCallback(
    (title: string, msg: string, onConfirm: () => void) => {
      Alert.alert(title, msg, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: title, onPress: onConfirm },
      ]);
    },
    [t],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['treasury-alerts'] });
    setRefreshing(false);
  }, [queryClient]);

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'open', label: t('treasury.open') },
    { key: 'acknowledged', label: t('treasury.acknowledged') },
    { key: 'resolved', label: t('treasury.resolved') },
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
        <View style={styles.summaryRow}>
          <Text style={styles.count}>{alerts.length} {t('treasury.alerts')}</Text>
          {criticalCount > 0 && (
            <View style={styles.criticalChip}>
              <Text style={styles.criticalChipText}>{criticalCount} {t('treasury.critical')}</Text>
            </View>
          )}
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 60 }} />
        ) : alerts.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="shield-checkmark-outline" size={48} color={C.sub} />
            <Text style={styles.emptyText}>{t('treasury.noAlerts')}</Text>
          </View>
        ) : (
          alerts.map((alert) => (
            <AlertCard
              key={alert.alertId}
              alert={alert}
              onAcknowledge={(id) =>
                confirmAction(t('treasury.acknowledge'), t('treasury.acknowledgeConfirm'), () =>
                  ackMutation.mutate(id),
                )
              }
              onResolve={(id) =>
                confirmAction(t('treasury.resolve'), t('treasury.resolveConfirm'), () =>
                  resolveMutation.mutate(id),
                )
              }
              onSuppress={(id) =>
                confirmAction(t('treasury.suppress'), t('treasury.suppressConfirm'), () =>
                  suppressMutation.mutate(id),
                )
              }
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminTreasuryAlertsScreen() {
  return (
    <AdminGuard>
      <AdminTreasuryAlertsContent />
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
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  count: { flex: 1, fontSize: 13, color: C.sub },
  criticalChip: { backgroundColor: C.redL, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  criticalChipText: { fontSize: 11, color: C.red, fontWeight: '700' },
  card: {
    backgroundColor: C.white, borderRadius: 12, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  cardCritical: { borderLeftWidth: 3, borderLeftColor: C.red },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  alertIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  alertType: { fontSize: 13, fontWeight: '700', color: C.text },
  alertProvider: { fontSize: 11, color: C.sub, marginTop: 1 },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  severityText: { fontSize: 10, fontWeight: '700' },
  description: { fontSize: 12, color: C.sub, lineHeight: 18, marginBottom: 10 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusChipText: { fontSize: 10, fontWeight: '700' },
  dateText: { fontSize: 11, color: C.sub },
  actions: { flexDirection: 'row', gap: 6, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  ackBtn: {
    flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4,
    backgroundColor: C.amberL, borderRadius: 8, paddingVertical: 7,
  },
  ackBtnText: { fontSize: 11, color: C.amber, fontWeight: '600' },
  resolveBtn: {
    flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4,
    backgroundColor: C.greenL, borderRadius: 8, paddingVertical: 7,
  },
  resolveBtnText: { fontSize: 11, color: C.green, fontWeight: '600' },
  suppressBtn: {
    flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4,
    backgroundColor: C.greyL, borderRadius: 8, paddingVertical: 7,
  },
  suppressBtnText: { fontSize: 11, color: C.grey, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: C.sub, marginTop: 12 },
});

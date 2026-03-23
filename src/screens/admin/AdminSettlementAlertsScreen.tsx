/**
 * AdminSettlementAlertsScreen.tsx
 * ─────────────────────────────────
 * Settlement engine alert management — filter by type/severity/status,
 * with color-coded severity badges and a Resolve action.
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
import { useAuth } from '../../hooks/useAuth';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';
import type {
  SettlementAlert,
  SettlementAlertType,
  SettlementAlertSeverity,
  SettlementAlertStatus,
} from '../../services/settlement/settlementTypes';

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

const SEVERITY_CFG: Record<SettlementAlertSeverity, { bg: string; color: string }> = {
  LOW:      { bg: C.greyL,   color: C.grey },
  MEDIUM:   { bg: C.amberL,  color: C.amber },
  HIGH:     { bg: C.redL,    color: C.red },
  CRITICAL: { bg: '#FEE2E2', color: '#991B1B' },
};

const TYPE_ICON: Record<SettlementAlertType, string> = {
  SETTLEMENT_OVERDUE:  'hourglass-outline',
  SETTLEMENT_MISMATCH: 'git-compare-outline',
  NEGATIVE_EXPOSURE:   'trending-down-outline',
  BATCH_FAILURE:       'close-circle-outline',
};

type StatusFilter = 'ALL' | SettlementAlertStatus;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function AlertCard({
  alert,
  onResolve,
  isPending,
}: {
  alert: SettlementAlert;
  onResolve: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const sevCfg = SEVERITY_CFG[alert.severity] ?? SEVERITY_CFG.MEDIUM;
  const icon = TYPE_ICON[alert.type] ?? 'warning-outline';
  const isOpen = alert.status === 'OPEN';

  return (
    <View style={[styles.card, { borderLeftColor: sevCfg.color, borderLeftWidth: 4 }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.iconBox, { backgroundColor: sevCfg.bg }]}>
          <Ionicons name={icon as any} size={18} color={sevCfg.color} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.alertType}>{t(`settlementEngine.alertType.${alert.type}`, alert.type.replace(/_/g, ' '))}</Text>
          <Text style={styles.alertProvider}>{alert.provider} · {alert.currency}</Text>
        </View>
        <View style={[styles.sevBadge, { backgroundColor: sevCfg.bg }]}>
          <Text style={[styles.sevBadgeText, { color: sevCfg.color }]}>{alert.severity}</Text>
        </View>
      </View>

      <Text style={styles.message}>{alert.message}</Text>

      <View style={styles.footer}>
        <Text style={styles.meta}>{formatDate(alert.createdAt)}</Text>
        {alert.resolvedAt ? (
          <Text style={styles.resolvedBy}>{t('settlementEngine.resolvedBy')}: {alert.resolvedBy ?? '—'}</Text>
        ) : null}
        {isOpen && (
          <TouchableOpacity
            style={[styles.resolveBtn, { opacity: isPending ? 0.5 : 1 }]}
            onPress={onResolve}
            disabled={isPending}
          >
            {isPending ? (
              <ActivityIndicator size="small" color={C.green} />
            ) : (
              <>
                <Ionicons name="checkmark-outline" size={14} color={C.green} />
                <Text style={styles.resolveBtnText}>{t('settlementEngine.resolve')}</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        {!isOpen && (
          <View style={[styles.badge, { backgroundColor: C.greenL }]}>
            <Ionicons name="checkmark-circle-outline" size={12} color={C.green} />
            <Text style={[styles.badgeText, { color: C.green }]}>{alert.status}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function AdminSettlementAlertsContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ['settlement-alerts', statusFilter],
    queryFn: () => adminService.getSettlementAlerts(statusFilter === 'ALL' ? {} : { status: statusFilter as SettlementAlertStatus }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['settlement-alerts'] });

  const resolveMut = useMutation({
    mutationFn: (id: string) => adminService.resolveSettlementAlert(id),
    onSuccess: () => { invalidate(); setPendingId(null); },
    onError: () => setPendingId(null),
  });

  const onResolve = (alertId: string) =>
    Alert.alert(
      t('settlementEngine.resolve'),
      t('settlementEngine.resolveConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settlementEngine.resolve'), onPress: () => { setPendingId(alertId); resolveMut.mutate(alertId); } },
      ],
    );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await invalidate();
    setRefreshing(false);
  }, [queryClient]);

  const statusTabs: StatusFilter[] = ['OPEN', 'RESOLVED', 'ALL'];

  const openCount = alerts.filter((a) => a.status === 'OPEN').length;
  const criticalCount = alerts.filter((a) => a.severity === 'CRITICAL').length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerIcon}>
            <Ionicons name="warning-outline" size={20} color={C.white} />
          </View>
          <View>
            <Text style={styles.headerTitle}>{t('settlementEngine.alerts')}</Text>
            <Text style={styles.headerSub}>
              {openCount} {t('settlementEngine.open')}
              {criticalCount > 0 ? ` · ${criticalCount} ${t('settlementEngine.critical')}` : ''}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.tabRow}>
        {statusTabs.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, statusFilter === tab && styles.tabActive]}
            onPress={() => setStatusFilter(tab)}
          >
            <Text style={[styles.tabText, statusFilter === tab && styles.tabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        {isLoading ? (
          <View style={styles.loadingBox}><ActivityIndicator size="large" color={C.primary} /></View>
        ) : alerts.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="checkmark-circle-outline" size={48} color={C.green} />
            <Text style={styles.emptyText}>{t('settlementEngine.noAlerts')}</Text>
          </View>
        ) : (
          alerts.map((a) => (
            <AlertCard
              key={a.alertId}
              alert={a}
              isPending={pendingId === a.alertId}
              onResolve={() => onResolve(a.alertId)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminSettlementAlertsScreen() {
  return (
    <AdminGuard>
      <AdminSettlementAlertsContent />
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
  tabRow: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 16, backgroundColor: C.greyL },
  tabActive: { backgroundColor: C.primary },
  tabText: { fontSize: 13, color: C.sub, fontWeight: '600' },
  tabTextActive: { color: C.white },
  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 32, gap: 10 },
  loadingBox: { paddingVertical: 80, alignItems: 'center' },
  emptyBox: { paddingVertical: 60, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: C.sub },
  card: {
    backgroundColor: C.white, borderRadius: 12, padding: 14, gap: 10,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  cardHeaderText: { flex: 1, gap: 2 },
  alertType: { fontSize: 14, fontWeight: '700', color: C.text },
  alertProvider: { fontSize: 12, color: C.sub },
  sevBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  sevBadgeText: { fontSize: 11, fontWeight: '800' },
  message: { fontSize: 13, color: C.text, lineHeight: 18 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, flexWrap: 'wrap' },
  meta: { flex: 1, fontSize: 11, color: C.sub },
  resolvedBy: { fontSize: 11, color: C.green },
  resolveBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.greenL, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  resolveBtnText: { fontSize: 12, fontWeight: '700', color: C.green },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: '700' },
});

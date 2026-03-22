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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';
import { triggerManualReconciliation } from '../../workers/reconciliationWorker';
import { useAuth } from '../../hooks/useAuth';

const COLORS = {
  primary: '#006633',
  primaryLight: '#E8F5E9',
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
  border: '#E5E7EB',
};

function StatCard({
  label,
  value,
  color,
  bg,
  icon,
}: {
  label: string;
  value: number | string;
  color: string;
  bg: string;
  icon: string;
}) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <View style={[styles.statIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function AdminReconciliationOverviewContent() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const { data: overview, isLoading } = useQuery({
    queryKey: ['reconciliation-overview'],
    queryFn: () => adminService.getReconciliationOverview(),
  });

  const { data: openAlerts = [] } = useQuery({
    queryKey: ['reconciliation-alerts-open'],
    queryFn: () => adminService.getReconciliationAlerts({ status: 'open' }),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
    setRefreshing(false);
  }, [queryClient]);

  const handleRunNow = useCallback(async () => {
    Alert.alert(
      t('reconciliation.runNow'),
      t('reconciliation.runNowConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('reconciliation.run'),
          style: 'default',
          onPress: async () => {
            setTriggering(true);
            try {
              const runId = await triggerManualReconciliation('all', user?.uid ?? 'admin');
              await queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
              Alert.alert(t('reconciliation.runStarted'), `Run ID: ${runId}`);
            } catch (err: any) {
              Alert.alert(t('reconciliation.runFailed'), err.message);
            } finally {
              setTriggering(false);
            }
          },
        },
      ],
    );
  }, [t, user, queryClient]);

  const lastRun = overview?.lastRun;
  const criticalAlerts = openAlerts.filter((a: any) => a.severity === 'critical');

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.headerTitle}>{t('reconciliation.overview')}</Text>
              <Text style={styles.headerSubtitle}>{t('reconciliation.overviewSubtitle')}</Text>
            </View>
            <TouchableOpacity
              style={[styles.runBtn, triggering && styles.runBtnDisabled]}
              onPress={handleRunNow}
              disabled={triggering}
            >
              {triggering ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="play-circle-outline" size={16} color={COLORS.white} />
                  <Text style={styles.runBtnText}>{t('reconciliation.runNow')}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Critical alerts banner */}
        {criticalAlerts.length > 0 && (
          <TouchableOpacity
            style={styles.criticalBanner}
            onPress={() => navigation.navigate('AdminReconciliationAlerts')}
          >
            <Ionicons name="warning" size={18} color={COLORS.white} />
            <Text style={styles.criticalBannerText}>
              {criticalAlerts.length} {t('reconciliation.criticalAlerts')}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.white} />
          </TouchableOpacity>
        )}

        {/* Stats grid */}
        {isLoading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.statsGrid}>
              <StatCard
                label={t('reconciliation.matched')}
                value={lastRun?.totalMatched ?? 0}
                color={COLORS.green}
                bg={COLORS.greenLight}
                icon="checkmark-circle-outline"
              />
              <StatCard
                label={t('reconciliation.mismatched')}
                value={lastRun?.totalMismatched ?? 0}
                color={COLORS.amber}
                bg={COLORS.amberLight}
                icon="alert-circle-outline"
              />
              <StatCard
                label={t('reconciliation.missing')}
                value={lastRun?.totalMissing ?? 0}
                color={COLORS.red}
                bg={COLORS.redLight}
                icon="close-circle-outline"
              />
              <StatCard
                label={t('reconciliation.duplicates')}
                value={lastRun?.totalDuplicate ?? 0}
                color={COLORS.purple}
                bg={COLORS.purpleLight}
                icon="copy-outline"
              />
            </View>

            {/* Last run card */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('reconciliation.lastRun')}</Text>
              {lastRun ? (
                <View style={styles.runCard}>
                  <View style={styles.runRow}>
                    <Text style={styles.runLabel}>{t('reconciliation.runId')}</Text>
                    <Text style={styles.runValue}>{lastRun.runId}</Text>
                  </View>
                  <View style={styles.runRow}>
                    <Text style={styles.runLabel}>{t('reconciliation.status')}</Text>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor:
                            lastRun.status === 'completed'
                              ? COLORS.greenLight
                              : lastRun.status === 'running'
                              ? COLORS.blueLight
                              : COLORS.redLight,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          {
                            color:
                              lastRun.status === 'completed'
                                ? COLORS.green
                                : lastRun.status === 'running'
                                ? COLORS.blue
                                : COLORS.red,
                          },
                        ]}
                      >
                        {lastRun.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.runRow}>
                    <Text style={styles.runLabel}>{t('reconciliation.totalChecked')}</Text>
                    <Text style={styles.runValue}>{lastRun.totalChecked}</Text>
                  </View>
                  <View style={styles.runRow}>
                    <Text style={styles.runLabel}>{t('reconciliation.alertsCreated')}</Text>
                    <Text style={styles.runValue}>{lastRun.totalAlertsCreated}</Text>
                  </View>
                  <View style={styles.runRow}>
                    <Text style={styles.runLabel}>{t('reconciliation.completedAt')}</Text>
                    <Text style={styles.runValue}>
                      {lastRun.completedAt
                        ? new Date(lastRun.completedAt).toLocaleString()
                        : '—'}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.emptyText}>{t('reconciliation.noRunsYet')}</Text>
              )}
            </View>

            {/* Open alerts summary */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('reconciliation.openAlerts')}</Text>
                <TouchableOpacity onPress={() => navigation.navigate('AdminReconciliationAlerts')}>
                  <Text style={styles.seeAll}>{t('common.seeAll')}</Text>
                </TouchableOpacity>
              </View>
              {openAlerts.slice(0, 3).map((alert: any) => (
                <View key={alert.alertId} style={styles.alertRow}>
                  <View
                    style={[
                      styles.alertSeverityDot,
                      {
                        backgroundColor:
                          alert.severity === 'critical'
                            ? COLORS.red
                            : alert.severity === 'high'
                            ? COLORS.amber
                            : COLORS.blue,
                      },
                    ]}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertType}>{alert.type.replace(/_/g, ' ')}</Text>
                    <Text style={styles.alertTx} numberOfLines={1}>
                      {alert.description}
                    </Text>
                  </View>
                  <Text style={styles.alertSeverity}>{alert.severity}</Text>
                </View>
              ))}
              {openAlerts.length === 0 && (
                <Text style={styles.emptyText}>{t('reconciliation.noOpenAlerts')}</Text>
              )}
            </View>

            {/* Navigation shortcuts */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('reconciliation.quickLinks')}</Text>
              {[
                { label: t('reconciliation.viewRuns'), screen: 'AdminReconciliationRuns', icon: 'list-outline', color: COLORS.primary },
                { label: t('reconciliation.viewAlerts'), screen: 'AdminReconciliationAlerts', icon: 'warning-outline', color: COLORS.red },
              ].map((item) => (
                <TouchableOpacity
                  key={item.screen}
                  style={styles.linkCard}
                  onPress={() => navigation.navigate(item.screen)}
                >
                  <Ionicons name={item.icon as any} size={20} color={item.color} />
                  <Text style={styles.linkLabel}>{item.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminReconciliationOverviewScreen() {
  return (
    <AdminGuard>
      <AdminReconciliationOverviewContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  headerCard: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.white },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  runBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  runBtnDisabled: { opacity: 0.6 },
  runBtnText: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  criticalBanner: {
    backgroundColor: COLORS.red,
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  criticalBannerText: { flex: 1, color: COLORS.white, fontWeight: '600', fontSize: 14 },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 14,
    borderLeftWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  statIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  statValue: { fontSize: 24, fontWeight: '700', color: COLORS.text },
  statLabel: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  section: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  seeAll: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },
  runCard: { backgroundColor: COLORS.white, borderRadius: 10, padding: 14, gap: 10 },
  runRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  runLabel: { fontSize: 13, color: COLORS.textSecondary },
  runValue: { fontSize: 13, color: COLORS.text, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '700' },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
  },
  alertSeverityDot: { width: 10, height: 10, borderRadius: 5 },
  alertType: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  alertTx: { fontSize: 11, color: COLORS.textSecondary, marginTop: 1 },
  alertSeverity: { fontSize: 11, color: COLORS.textSecondary, fontWeight: '500' },
  linkCard: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  linkLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.text },
  emptyText: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', paddingVertical: 16 },
});

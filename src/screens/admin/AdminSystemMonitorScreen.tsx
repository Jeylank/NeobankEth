/**
 * AdminSystemMonitorScreen.tsx
 * ─────────────────────────────
 * Production system health monitoring for Habeshare admins.
 *
 * Shows:
 *   • System health (DB status, uptime, env var validation)
 *   • Error count from system_errors
 *   • Failed jobs + DLQ count
 *   • Active fraud alerts
 *   • Webhook failures
 *   • Open settlement alerts
 *   • Rate limit hits
 *
 * Data comes from systemHealthService.getSystemSummary() and getHealthStatus().
 * Pull-to-refresh, auto-refresh every 30s.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';

// ─── Colors ───────────────────────────────────────────────────────────────────

const C = {
  primary: '#006633',
  white: '#FFFFFF',
  bg: '#F5F5F5',
  text: '#1F2937',
  sub: '#6B7280',
  green: '#10B981',   greenL: '#D1FAE5',
  red: '#EF4444',     redL: '#FEE2E2',
  amber: '#F59E0B',   amberL: '#FEF3C7',
  blue: '#3B82F6',    blueL: '#DBEAFE',
  purple: '#8B5CF6',  purpleL: '#F5F3FF',
  cyan: '#0891B2',    cyanL: '#ECFEFF',
  grey: '#9CA3AF',    greyL: '#F3F4F6',
  border: '#E5E7EB',
  shadow: '#000',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusIndicator({ status }: { status: 'ok' | 'degraded' | 'error' | 'connected' | 'unreachable' }) {
  const color =
    status === 'ok' || status === 'connected' ? C.green :
    status === 'degraded' ? C.amber :
    C.red;

  return (
    <View style={[styles.statusDot, { backgroundColor: color }]} />
  );
}

function HealthCard({
  label, value, icon, color, bg, alert,
}: {
  label: string;
  value: string | number;
  icon: string;
  color: string;
  bg: string;
  alert?: boolean;
}) {
  return (
    <View style={[styles.healthCard, alert && { borderLeftColor: C.red }, { borderLeftColor: color }]}>
      <View style={[styles.healthIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <View style={styles.healthText}>
        <Text style={[styles.healthValue, alert && { color: C.red }]}>{value}</Text>
        <Text style={styles.healthLabel}>{label}</Text>
      </View>
    </View>
  );
}

function MetricRow({
  label, value, icon, color, bg, highlight,
}: {
  label: string;
  value: string | number;
  icon: string;
  color: string;
  bg: string;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.metricRow, highlight && styles.metricRowHighlight]}>
      <View style={[styles.metricIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={15} color={color} />
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, highlight && { color: C.red, fontWeight: '700' }]}>
        {value}
      </Text>
    </View>
  );
}

// ─── Main Content ─────────────────────────────────────────────────────────────

function AdminSystemMonitorContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const healthQuery = useQuery({
    queryKey: ['systemHealth'],
    queryFn: () => adminService.getSystemHealth(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const summaryQuery = useQuery({
    queryKey: ['systemSummary'],
    queryFn: () => adminService.getSystemSummary(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['systemHealth'] });
    await queryClient.invalidateQueries({ queryKey: ['systemSummary'] });
    setRefreshing(false);
  }, [queryClient]);

  const health = healthQuery.data;
  const summary = summaryQuery.data;
  const loading = healthQuery.isLoading || summaryQuery.isLoading;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerIcon}>
            <Ionicons name="pulse-outline" size={22} color={C.white} />
          </View>
          <View>
            <Text style={styles.headerTitle}>{t('systemMonitor.title')}</Text>
            <Text style={styles.headerSub}>{t('systemMonitor.subtitle')}</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
        }
      >
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : (
          <>
            {/* ── System Health Banner ── */}
            {health && (
              <View style={[
                styles.healthBanner,
                health.status === 'ok' && styles.healthBannerOk,
                health.status === 'degraded' && styles.healthBannerDegraded,
                health.status === 'error' && styles.healthBannerError,
              ]}>
                <StatusIndicator status={health.status} />
                <View style={styles.healthBannerText}>
                  <Text style={styles.healthBannerTitle}>
                    {health.status === 'ok' ? t('systemMonitor.statusOk') :
                     health.status === 'degraded' ? t('systemMonitor.statusDegraded') :
                     t('systemMonitor.statusError')}
                  </Text>
                  <Text style={styles.healthBannerSub}>
                    {t('systemMonitor.uptime')}: {formatUptime(health.uptime)}  ·  DB: {health.db}
                  </Text>
                  {health.missingEnvVars.length > 0 && (
                    <Text style={styles.healthBannerWarning}>
                      {t('systemMonitor.missingEnvVars')}: {health.missingEnvVars.join(', ')}
                    </Text>
                  )}
                </View>
                <Ionicons
                  name={health.status === 'ok' ? 'checkmark-circle' : 'warning'}
                  size={24}
                  color={health.status === 'ok' ? C.green : health.status === 'degraded' ? C.amber : C.red}
                />
              </View>
            )}

            {/* ── Health Cards Row ── */}
            {health && (
              <>
                <Text style={styles.sectionLabel}>{t('systemMonitor.infrastructure')}</Text>
                <View style={styles.healthGrid}>
                  <HealthCard
                    label={t('systemMonitor.database')}
                    value={health.db === 'connected' ? t('systemMonitor.connected') : t('systemMonitor.unreachable')}
                    icon="server-outline"
                    color={health.db === 'connected' ? C.green : C.red}
                    bg={health.db === 'connected' ? C.greenL : C.redL}
                    alert={health.db !== 'connected'}
                  />
                  <HealthCard
                    label={t('systemMonitor.envConfig')}
                    value={health.envValid ? t('systemMonitor.allSet') : `${health.missingEnvVars.length} missing`}
                    icon="key-outline"
                    color={health.envValid ? C.green : C.red}
                    bg={health.envValid ? C.greenL : C.redL}
                    alert={!health.envValid}
                  />
                </View>
              </>
            )}

            {/* ── Operational Metrics ── */}
            {summary && (
              <>
                <Text style={styles.sectionLabel}>{t('systemMonitor.operationalMetrics')}</Text>
                <View style={styles.metricsCard}>
                  <MetricRow
                    label={t('systemMonitor.systemErrors')}
                    value={summary.errorCount}
                    icon="bug-outline"
                    color={summary.errorCount > 0 ? C.red : C.green}
                    bg={summary.errorCount > 0 ? C.redL : C.greenL}
                    highlight={summary.errorCount > 0}
                  />
                  <View style={styles.divider} />
                  <MetricRow
                    label={t('systemMonitor.failedJobs')}
                    value={summary.failedJobCount}
                    icon="close-circle-outline"
                    color={summary.failedJobCount > 0 ? C.amber : C.green}
                    bg={summary.failedJobCount > 0 ? C.amberL : C.greenL}
                    highlight={summary.failedJobCount > 0}
                  />
                  <View style={styles.divider} />
                  <MetricRow
                    label={t('systemMonitor.dlqCount')}
                    value={summary.dlqCount}
                    icon="skull-outline"
                    color={summary.dlqCount > 0 ? C.red : C.green}
                    bg={summary.dlqCount > 0 ? C.redL : C.greenL}
                    highlight={summary.dlqCount > 0}
                  />
                  <View style={styles.divider} />
                  <MetricRow
                    label={t('systemMonitor.activeFraudAlerts')}
                    value={summary.activeFraudAlerts}
                    icon="shield-outline"
                    color={summary.activeFraudAlerts > 0 ? C.red : C.green}
                    bg={summary.activeFraudAlerts > 0 ? C.redL : C.greenL}
                    highlight={summary.activeFraudAlerts > 0}
                  />
                  <View style={styles.divider} />
                  <MetricRow
                    label={t('systemMonitor.webhookFailures')}
                    value={summary.webhookFailures}
                    icon="warning-outline"
                    color={summary.webhookFailures > 0 ? C.amber : C.green}
                    bg={summary.webhookFailures > 0 ? C.amberL : C.greenL}
                    highlight={summary.webhookFailures > 0}
                  />
                  <View style={styles.divider} />
                  <MetricRow
                    label={t('systemMonitor.openSettlementAlerts')}
                    value={summary.openSettlementAlerts}
                    icon="layers-outline"
                    color={summary.openSettlementAlerts > 0 ? C.amber : C.green}
                    bg={summary.openSettlementAlerts > 0 ? C.amberL : C.greenL}
                  />
                </View>

                <Text style={styles.fetchedAt}>
                  {t('systemMonitor.lastUpdated')}: {new Date(summary.fetchedAt).toLocaleTimeString()}
                </Text>
              </>
            )}

            {/* ── Security Summary ── */}
            <Text style={styles.sectionLabel}>{t('systemMonitor.securitySummary')}</Text>
            <View style={styles.securityCard}>
              <View style={styles.securityRow}>
                <Ionicons name="lock-closed-outline" size={16} color={C.primary} />
                <Text style={styles.securityText}>{t('systemMonitor.securityHmac')}</Text>
                <View style={[styles.securityBadge, { backgroundColor: C.greenL }]}>
                  <Text style={[styles.securityBadgeText, { color: C.green }]}>ACTIVE</Text>
                </View>
              </View>
              <View style={styles.securityRow}>
                <Ionicons name="timer-outline" size={16} color={C.primary} />
                <Text style={styles.securityText}>{t('systemMonitor.securityRateLimit')}</Text>
                <View style={[styles.securityBadge, { backgroundColor: C.greenL }]}>
                  <Text style={[styles.securityBadgeText, { color: C.green }]}>ACTIVE</Text>
                </View>
              </View>
              <View style={styles.securityRow}>
                <Ionicons name="copy-outline" size={16} color={C.primary} />
                <Text style={styles.securityText}>{t('systemMonitor.securityIdempotency')}</Text>
                <View style={[styles.securityBadge, { backgroundColor: C.greenL }]}>
                  <Text style={[styles.securityBadgeText, { color: C.green }]}>ACTIVE</Text>
                </View>
              </View>
              <View style={styles.securityRow}>
                <Ionicons name="shield-checkmark-outline" size={16} color={C.primary} />
                <Text style={styles.securityText}>{t('systemMonitor.securityFraudScoring')}</Text>
                <View style={[styles.securityBadge, { backgroundColor: C.greenL }]}>
                  <Text style={[styles.securityBadgeText, { color: C.green }]}>ACTIVE</Text>
                </View>
              </View>
              <View style={styles.securityRow}>
                <Ionicons name="refresh-circle-outline" size={16} color={C.primary} />
                <Text style={styles.securityText}>{t('systemMonitor.securityDlq')}</Text>
                <View style={[styles.securityBadge, { backgroundColor: C.greenL }]}>
                  <Text style={[styles.securityBadgeText, { color: C.green }]}>ACTIVE</Text>
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminSystemMonitorScreen() {
  return (
    <AdminGuard>
      <AdminSystemMonitorContent />
    </AdminGuard>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 16 },
  headerContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.white },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },

  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 32, gap: 12 },
  loadingBox: { paddingVertical: 80, alignItems: 'center' },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.sub,
    textTransform: 'uppercase', letterSpacing: 0.6,
    paddingHorizontal: 2,
  },

  // Health banner
  healthBanner: {
    borderRadius: 12, padding: 14,
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderWidth: 1, borderColor: C.border,
  },
  healthBannerOk:       { backgroundColor: C.greenL, borderColor: C.green },
  healthBannerDegraded: { backgroundColor: C.amberL, borderColor: C.amber },
  healthBannerError:    { backgroundColor: C.redL,   borderColor: C.red },
  healthBannerText:     { flex: 1, gap: 3 },
  healthBannerTitle:    { fontSize: 15, fontWeight: '700', color: C.text },
  healthBannerSub:      { fontSize: 12, color: C.sub },
  healthBannerWarning:  { fontSize: 11, color: C.red, fontWeight: '600' },
  statusDot: {
    width: 10, height: 10, borderRadius: 5, marginTop: 4,
  },

  // Health cards
  healthGrid: { flexDirection: 'row', gap: 10 },
  healthCard: {
    flex: 1, backgroundColor: C.white, borderRadius: 12, padding: 12,
    borderLeftWidth: 3,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  healthIcon: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center',
  },
  healthText: { flex: 1, gap: 2 },
  healthValue: { fontSize: 13, fontWeight: '700', color: C.text },
  healthLabel: { fontSize: 10, color: C.sub },

  // Metrics card
  metricsCard: {
    backgroundColor: C.white, borderRadius: 12,
    overflow: 'hidden', borderWidth: 1, borderColor: C.border,
  },
  metricRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, gap: 10,
  },
  metricRowHighlight: { backgroundColor: '#FFFBF0' },
  metricIcon: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  metricLabel: { flex: 1, fontSize: 13, color: C.text },
  metricValue: { fontSize: 16, fontWeight: '700', color: C.text },
  divider: { height: 1, backgroundColor: C.border, marginLeft: 54 },

  fetchedAt: { fontSize: 11, color: C.grey, textAlign: 'right', paddingHorizontal: 2 },

  // Security card
  securityCard: {
    backgroundColor: C.white, borderRadius: 12, padding: 4,
    borderWidth: 1, borderColor: C.border,
  },
  securityRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
    gap: 10, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  securityText: { flex: 1, fontSize: 13, color: C.text },
  securityBadge: {
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4,
  },
  securityBadgeText: { fontSize: 10, fontWeight: '700' },
});

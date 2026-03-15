import React, { useState, useCallback } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';
import type { ReconciliationRun } from '../../services/reconciliation/reconciliationTypes';

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
  border: '#E5E7EB',
};

function statusColor(status: string): { bg: string; text: string } {
  switch (status) {
    case 'completed': return { bg: COLORS.greenLight, text: COLORS.green };
    case 'running': return { bg: COLORS.blueLight, text: COLORS.blue };
    case 'failed': return { bg: COLORS.redLight, text: COLORS.red };
    default: return { bg: COLORS.amberLight, text: COLORS.amber };
  }
}

function RunCard({ run, onPress }: { run: ReconciliationRun; onPress: () => void }) {
  const { t } = useTranslation();
  const sc = statusColor(run.status);
  const matchRate = run.totalChecked > 0
    ? Math.round((run.totalMatched / run.totalChecked) * 100)
    : 0;

  return (
    <TouchableOpacity style={styles.runCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.runHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.runId} numberOfLines={1}>{run.runId}</Text>
          <Text style={styles.runMeta}>
            {run.provider} · {run.mode} · {new Date(run.startedAt).toLocaleDateString()}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
          <Text style={[styles.statusText, { color: sc.text }]}>{run.status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.runStats}>
        <View style={styles.runStat}>
          <Text style={styles.statNum}>{run.totalChecked}</Text>
          <Text style={styles.statLbl}>{t('reconciliation.checked')}</Text>
        </View>
        <View style={styles.runStat}>
          <Text style={[styles.statNum, { color: COLORS.green }]}>{run.totalMatched}</Text>
          <Text style={styles.statLbl}>{t('reconciliation.matched')}</Text>
        </View>
        <View style={styles.runStat}>
          <Text style={[styles.statNum, { color: COLORS.amber }]}>{run.totalMismatched}</Text>
          <Text style={styles.statLbl}>{t('reconciliation.mismatched')}</Text>
        </View>
        <View style={styles.runStat}>
          <Text style={[styles.statNum, { color: COLORS.red }]}>{run.totalAlertsCreated}</Text>
          <Text style={styles.statLbl}>{t('reconciliation.alerts')}</Text>
        </View>
      </View>

      {/* Match rate bar */}
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${matchRate}%`, backgroundColor: COLORS.green }]} />
      </View>
      <Text style={styles.matchRate}>{matchRate}% {t('reconciliation.matchRate')}</Text>

      {run.completedAt && (
        <Text style={styles.completedAt}>
          {t('reconciliation.completedAt')}: {new Date(run.completedAt).toLocaleString()}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function AdminReconciliationRunsContent() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: runs = [], isLoading } = useQuery<ReconciliationRun[]>({
    queryKey: ['reconciliation-runs'],
    queryFn: () => adminService.getReconciliationRuns(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['reconciliation-runs'] });
    setRefreshing(false);
  }, [queryClient]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>{t('reconciliation.runs')}</Text>
          <Text style={styles.pageSubtitle}>{runs.length} {t('reconciliation.totalRuns')}</Text>
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : runs.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-circle-outline" size={48} color={COLORS.textSecondary} />
            <Text style={styles.emptyText}>{t('reconciliation.noRunsYet')}</Text>
          </View>
        ) : (
          runs.map((run) => (
            <RunCard
              key={run.runId}
              run={run}
              onPress={() =>
                navigation.navigate('AdminReconciliationRunDetail', { runId: run.runId })
              }
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminReconciliationRunsScreen() {
  return (
    <AdminGuard>
      <AdminReconciliationRunsContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  pageHeader: { marginBottom: 16 },
  pageTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  pageSubtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  runCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  runHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  runId: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  runMeta: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginLeft: 8 },
  statusText: { fontSize: 10, fontWeight: '700' },
  runStats: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  runStat: { alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  statLbl: { fontSize: 10, color: COLORS.textSecondary, marginTop: 1 },
  barTrack: {
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  barFill: { height: 6, borderRadius: 3 },
  matchRate: { fontSize: 11, color: COLORS.textSecondary },
  completedAt: { fontSize: 10, color: COLORS.textSecondary, marginTop: 6 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: COLORS.textSecondary, marginTop: 12 },
});

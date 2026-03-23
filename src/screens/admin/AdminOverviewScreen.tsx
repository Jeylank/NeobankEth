import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';
import type { AdminOverview, TransferStats } from '../../types';

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

function MiniBarChart({ data, color, maxBars = 7 }: { data: { label: string; value: number }[]; color: string; maxBars?: number }) {
  const displayData = data.slice(-maxBars);
  const maxValue = Math.max(...displayData.map((d) => d.value), 1);

  return (
    <View style={chartStyles.container}>
      <View style={chartStyles.barsRow}>
        {displayData.map((item, index) => (
          <View key={index} style={chartStyles.barColumn}>
            <View style={chartStyles.barWrapper}>
              <View
                style={[
                  chartStyles.bar,
                  {
                    height: `${Math.max((item.value / maxValue) * 100, 4)}%`,
                    backgroundColor: color,
                  },
                ]}
              />
            </View>
            <Text style={chartStyles.barLabel} numberOfLines={1}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function HorizontalBarChart({ data, colors }: { data: { label: string; value: number }[]; colors: string[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;

  return (
    <View style={chartStyles.hContainer}>
      {data.map((item, index) => (
        <View key={index} style={chartStyles.hRow}>
          <View style={chartStyles.hLabelRow}>
            <View style={[chartStyles.hDot, { backgroundColor: colors[index % colors.length] }]} />
            <Text style={chartStyles.hLabel}>{item.label}</Text>
            <Text style={chartStyles.hValue}>{item.value}</Text>
          </View>
          <View style={chartStyles.hBarTrack}>
            <View
              style={[
                chartStyles.hBarFill,
                {
                  width: `${Math.max((item.value / total) * 100, 2)}%`,
                  backgroundColor: colors[index % colors.length],
                },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 100,
    gap: 6,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  barWrapper: {
    width: '100%',
    height: 80,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: '70%',
    borderRadius: 4,
    minHeight: 4,
  },
  barLabel: {
    fontSize: 9,
    color: COLORS.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  hContainer: {
    marginTop: 8,
    gap: 10,
  },
  hRow: {
    gap: 4,
  },
  hLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  hLabel: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
  },
  hValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  hBarTrack: {
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    marginLeft: 14,
  },
  hBarFill: {
    height: 6,
    borderRadius: 3,
  },
});

function AdminOverviewContent() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [refreshing, setRefreshing] = useState(false);

  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery<AdminOverview>({
    queryKey: ['admin-overview'],
    queryFn: () => adminService.getAdminOverview(),
  });

  const { data: transferStats } = useQuery<TransferStats>({
    queryKey: ['admin-transfer-stats'],
    queryFn: () => adminService.getTransferStats(),
    retry: 1,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>{t('admin.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.red} />
          <Text style={styles.errorTitle}>{t('common.error')}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const overview = data;

  const summaryCards = [
    {
      label: t('admin.totalTransactionsToday'),
      value: overview?.totalTransactionsToday ?? 0,
      icon: 'swap-horizontal',
      color: COLORS.blue,
      bgColor: COLORS.blueLight,
    },
    {
      label: t('admin.completedPayoutsToday'),
      value: overview?.completedPayoutsToday ?? 0,
      icon: 'checkmark-circle',
      color: COLORS.green,
      bgColor: COLORS.greenLight,
    },
    {
      label: t('admin.failedPayoutsToday'),
      value: overview?.failedPayoutsToday ?? 0,
      icon: 'close-circle',
      color: COLORS.red,
      bgColor: COLORS.redLight,
    },
    {
      label: t('admin.pendingPayouts'),
      value: overview?.pendingPayouts ?? 0,
      icon: 'time',
      color: COLORS.amber,
      bgColor: COLORS.amberLight,
    },
    {
      label: t('admin.openFraudAlerts'),
      value: overview?.openFraudAlerts ?? 0,
      icon: 'warning',
      color: COLORS.red,
      bgColor: COLORS.redLight,
    },
    {
      label: t('admin.openSupportTickets'),
      value: overview?.openSupportTickets ?? 0,
      icon: 'chatbubble-ellipses',
      color: COLORS.blue,
      bgColor: COLORS.blueLight,
    },
    {
      label: t('admin.openDisputes'),
      value: overview?.openDisputes ?? 0,
      icon: 'flag',
      color: COLORS.amber,
      bgColor: COLORS.amberLight,
    },
    {
      label: t('admin.availableLiquidity'),
      value: overview?.availableLiquidity != null
        ? `$${overview.availableLiquidity.toLocaleString()}`
        : '$0',
      icon: 'cash',
      color: COLORS.primary,
      bgColor: COLORS.primaryLight,
      isFormatted: true,
    },
  ];

  const payoutsChartData = (overview?.payoutsOverTime ?? []).map((item) => ({
    label: item.date.slice(5),
    value: item.count,
  }));

  const fraudChartData = (overview?.fraudByDay ?? []).map((item) => ({
    label: item.date.slice(5),
    value: item.count,
  }));

  const ticketsChartData = (overview?.ticketsByStatus ?? []).map((item) => ({
    label: item.status,
    value: item.count,
  }));
  const ticketColors = [COLORS.blue, COLORS.amber, COLORS.green, COLORS.textSecondary];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('admin.overview')}</Text>
          <View style={{ width: 32 }} />
        </View>

        <View style={styles.cardsGrid}>
          {summaryCards.map((card, index) => (
            <View key={index} style={styles.summaryCard}>
              <View style={[styles.cardIconWrap, { backgroundColor: card.bgColor }]}>
                <Ionicons name={card.icon as any} size={20} color={card.color} />
              </View>
              <Text style={styles.cardValue}>
                {card.isFormatted ? card.value : card.value.toLocaleString()}
              </Text>
              <Text style={styles.cardLabel} numberOfLines={2}>{card.label}</Text>
            </View>
          ))}
        </View>

        {payoutsChartData.length > 0 && (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{t('admin.payoutsOverTime')}</Text>
            <MiniBarChart data={payoutsChartData} color={COLORS.primary} />
          </View>
        )}

        {fraudChartData.length > 0 && (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{t('admin.fraudByDay')}</Text>
            <MiniBarChart data={fraudChartData} color={COLORS.red} />
          </View>
        )}

        {ticketsChartData.length > 0 && (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{t('admin.ticketsByStatus')}</Text>
            <HorizontalBarChart data={ticketsChartData} colors={ticketColors} />
          </View>
        )}

        {transferStats && (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{t('adminStats.transferStats', 'Transfer Statistics')}</Text>

            <View style={styles.statRow}>
              <View style={styles.statItem}>
                <Ionicons name="time-outline" size={18} color={COLORS.blue} />
                <Text style={styles.statValue}>{transferStats.avgDeliveryTimeMinutes} min</Text>
                <Text style={styles.statLabel}>{t('adminStats.avgDeliveryTime', 'Avg Delivery')}</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="lock-closed-outline" size={18} color={COLORS.primary} />
                <Text style={styles.statValue}>{Math.round((transferStats.fxLockUsage?.usageRate ?? 0) * 100)}%</Text>
                <Text style={styles.statLabel}>{t('adminStats.fxLockUsage', 'FX Lock Rate')}</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="phone-portrait-outline" size={18} color={COLORS.amber} />
                <Text style={styles.statValue} numberOfLines={1}>{transferStats.topPayoutMethod?.method ?? '—'}</Text>
                <Text style={styles.statLabel}>{t('adminStats.topPayoutMethod', 'Top Method')}</Text>
              </View>
            </View>

            {(transferStats.successRateByProvider ?? []).length > 0 && (
              <>
                <Text style={[styles.chartTitle, { marginTop: 14, fontSize: 13 }]}>
                  {t('adminStats.successRate', 'Success Rate by Provider')}
                </Text>
                <HorizontalBarChart
                  data={(transferStats.successRateByProvider ?? []).map((p) => ({
                    label: `${p.provider} (${p.totalTransfers})`,
                    value: Math.round(p.successRate * 100),
                  }))}
                  colors={[COLORS.green, COLORS.primary, COLORS.blue, COLORS.amber]}
                />
              </>
            )}
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminOverviewScreen() {
  return (
    <AdminGuard>
      <AdminOverviewContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 12,
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 10,
  },
  summaryCard: {
    width: '47%',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    flexGrow: 1,
  },
  cardIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardValue: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  cardLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
  chartCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  bottomPadding: {
    height: 32,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 8,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  statLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});

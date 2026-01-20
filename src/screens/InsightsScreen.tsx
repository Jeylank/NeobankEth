import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transactionsApi } from '../services/api';
import { insightsService, type UserInsights, type InsightCard } from '../services/insightsService';

const COLORS = {
  primary: '#006633',
  gold: '#FFD700',
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  card: '#FFFFFF',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function InsightsScreen() {
  const { t } = useTranslation();

  const { data: transactionsData, isLoading: txLoading, refetch } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => transactionsApi.getAll(),
  });

  const { data: insights, isLoading: insightsLoading } = useQuery({
    queryKey: ['insights', transactionsData?.transactions?.length],
    queryFn: async () => {
      const transactions = transactionsData?.transactions || [];
      return insightsService.calculateInsights(transactions, 1);
    },
    enabled: !!transactionsData,
  });

  const isLoading = txLoading || insightsLoading;

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getInsightIcon = (icon: string): keyof typeof Ionicons.glyphMap => {
    const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
      'trending-up': 'trending-up',
      'star': 'star',
      'trophy': 'trophy',
      'heart': 'heart',
      'bulb': 'bulb',
      'cash': 'cash',
    };
    return iconMap[icon] || 'information-circle';
  };

  const renderInsightCard = (insight: InsightCard) => (
    <View key={insight.id} style={[styles.insightCard, { borderLeftColor: insight.color }]}>
      <View style={[styles.insightIconContainer, { backgroundColor: insight.color + '20' }]}>
        <Ionicons name={getInsightIcon(insight.icon)} size={24} color={insight.color} />
      </View>
      <View style={styles.insightContent}>
        <Text style={styles.insightTitle}>{insight.title}</Text>
        <Text style={styles.insightDescription}>{insight.description}</Text>
      </View>
    </View>
  );

  const renderCategoryBar = (category: { category: string; percentage: number; color: string; amount: number }) => (
    <View key={category.category} style={styles.categoryRow}>
      <View style={styles.categoryHeader}>
        <View style={[styles.categoryDot, { backgroundColor: category.color }]} />
        <Text style={styles.categoryName}>{category.category}</Text>
        <Text style={styles.categoryAmount}>{formatCurrency(category.amount)}</Text>
      </View>
      <View style={styles.categoryBarContainer}>
        <View 
          style={[
            styles.categoryBar, 
            { width: `${category.percentage}%`, backgroundColor: category.color }
          ]} 
        />
      </View>
      <Text style={styles.categoryPercentage}>{category.percentage}%</Text>
    </View>
  );

  const renderMonthlyChart = (trends: UserInsights['monthlyTrends']) => {
    const maxValue = Math.max(...trends.map(t => Math.max(t.sent, t.received)), 1);
    const barWidth = (SCREEN_WIDTH - 80) / 12;

    return (
      <View style={styles.chartContainer}>
        <View style={styles.chartBars}>
          {trends.map((trend, index) => {
            const sentHeight = (trend.sent / maxValue) * 100;
            const receivedHeight = (trend.received / maxValue) * 80;
            
            return (
              <View key={trend.month} style={[styles.barGroup, { width: barWidth }]}>
                <View style={styles.barsWrapper}>
                  {trend.sent > 0 && (
                    <View style={[styles.bar, styles.sentBar, { height: sentHeight }]} />
                  )}
                  {trend.received > 0 && (
                    <View style={[styles.bar, styles.receivedBar, { height: receivedHeight }]} />
                  )}
                </View>
                <Text style={styles.monthLabel}>{trend.month.substring(0, 1)}</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.chartLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.primary }]} />
            <Text style={styles.legendText}>{t('insights.sent')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
            <Text style={styles.legendText}>{t('insights.received')}</Text>
          </View>
        </View>
      </View>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>{t('insights.analyzing')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!insights) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.emptyContainer}>
          <Ionicons name="analytics-outline" size={64} color={COLORS.textSecondary} />
          <Text style={styles.emptyTitle}>{t('insights.noData')}</Text>
          <Text style={styles.emptyDescription}>{t('insights.startTransacting')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={() => refetch()} />
        }
      >
        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>{t('insights.yearSummary')}</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <Ionicons name="arrow-up-circle" size={28} color="#EF4444" />
              <Text style={styles.summaryValue}>{formatCurrency(insights.summary.totalSent)}</Text>
              <Text style={styles.summaryLabel}>{t('insights.totalSent')}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Ionicons name="arrow-down-circle" size={28} color="#10B981" />
              <Text style={styles.summaryValue}>{formatCurrency(insights.summary.totalReceived)}</Text>
              <Text style={styles.summaryLabel}>{t('insights.totalReceived')}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Ionicons name="receipt" size={28} color={COLORS.gold} />
              <Text style={styles.summaryValue}>{formatCurrency(insights.summary.totalFees)}</Text>
              <Text style={styles.summaryLabel}>{t('insights.totalFees')}</Text>
            </View>
          </View>
        </View>

        {insights.insights.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('insights.yourInsights')}</Text>
            {insights.insights.map(renderInsightCard)}
          </View>
        )}

        {insights.monthlyTrends && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('insights.monthlyActivity')}</Text>
            <View style={styles.card}>
              {renderMonthlyChart(insights.monthlyTrends)}
            </View>
          </View>
        )}

        {insights.categoryBreakdown.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('insights.spendingByCategory')}</Text>
            <View style={styles.card}>
              {insights.categoryBreakdown.map(renderCategoryBar)}
            </View>
          </View>
        )}

        {insights.topRecipients.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('insights.topRecipients')}</Text>
            <View style={styles.card}>
              {insights.topRecipients.map((recipient, index) => (
                <View key={recipient.name} style={styles.recipientRow}>
                  <View style={styles.recipientRank}>
                    <Text style={styles.rankNumber}>{index + 1}</Text>
                  </View>
                  <View style={styles.recipientInfo}>
                    <Text style={styles.recipientName}>{recipient.name}</Text>
                    <Text style={styles.recipientCountry}>{recipient.country}</Text>
                  </View>
                  <View style={styles.recipientStats}>
                    <Text style={styles.recipientAmount}>
                      {formatCurrency(recipient.totalSent, recipient.currency)}
                    </Text>
                    <Text style={styles.recipientCount}>
                      {recipient.transactionCount} {t('insights.transfers')}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
  },
  emptyDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: COLORS.primary,
    margin: 16,
    borderRadius: 16,
    padding: 20,
  },
  summaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.white,
    marginTop: 8,
  },
  summaryLabel: {
    fontSize: 12,
    color: COLORS.white,
    opacity: 0.8,
    marginTop: 4,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: 12,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
  },
  insightCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 4,
  },
  insightIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  insightContent: {
    flex: 1,
  },
  insightTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  insightDescription: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  chartContainer: {
    paddingTop: 8,
  },
  chartBars: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 120,
    paddingBottom: 20,
  },
  barGroup: {
    alignItems: 'center',
  },
  barsWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 100,
  },
  bar: {
    width: 8,
    borderRadius: 4,
    minHeight: 4,
  },
  sentBar: {
    backgroundColor: COLORS.primary,
  },
  receivedBar: {
    backgroundColor: '#10B981',
  },
  monthLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  chartLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  categoryRow: {
    marginBottom: 16,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  categoryDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  categoryName: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
  },
  categoryAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  categoryBarContainer: {
    height: 8,
    backgroundColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  categoryBar: {
    height: '100%',
    borderRadius: 4,
  },
  categoryPercentage: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
    textAlign: 'right',
  },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  recipientRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rankNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  recipientInfo: {
    flex: 1,
  },
  recipientName: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  recipientCountry: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  recipientStats: {
    alignItems: 'flex-end',
  },
  recipientAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  recipientCount: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  bottomPadding: {
    height: 24,
  },
});

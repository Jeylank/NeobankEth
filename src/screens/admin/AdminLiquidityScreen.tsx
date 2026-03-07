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
import { adminService } from '../../services/adminService';
import AdminGuard from '../../components/AdminGuard';
import type { LiquidityData, LiquidityProvider } from '../../types';

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
  lightRed: '#FEF2F2',
  lightAmber: '#FFFBEB',
  lightGreen: '#F0FDF4',
  lightBlue: '#EFF6FF',
};

const CURRENCY_ICONS: Record<string, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  ETB: 'Br',
};

export default function AdminLiquidityScreen() {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: liquidity,
    isLoading,
    isError,
    refetch,
  } = useQuery<LiquidityData>({
    queryKey: ['admin', 'liquidity'],
    queryFn: () => adminService.getLiquidity(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const formatAmount = (amount: number, currency?: string) => {
    const symbol = currency ? CURRENCY_ICONS[currency] || currency : '$';
    return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const hasLowLiquidity = liquidity && liquidity.availableLiquidity < liquidity.totalSettlement * 0.1;
  const payoutsExceedBalance = liquidity && liquidity.pendingPayouts > liquidity.availableLiquidity;

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.stateText}>{t('admin.loading')}</Text>
        </View>
      );
    }

    if (isError) {
      return (
        <View style={styles.centerState}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.red} />
          <Text style={styles.stateText}>{t('admin.error')}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>{t('admin.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!liquidity) {
      return (
        <View style={styles.centerState}>
          <Ionicons name="water-outline" size={48} color={COLORS.textSecondary} />
          <Text style={styles.stateText}>{t('admin.noLiquidityData')}</Text>
        </View>
      );
    }

    return (
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {payoutsExceedBalance && (
          <View style={[styles.warningBanner, styles.warningRed]}>
            <Ionicons name="warning" size={20} color={COLORS.red} />
            <Text style={[styles.warningText, { color: COLORS.red }]}>
              {t('admin.payoutsExceedBalance')}
            </Text>
          </View>
        )}

        {hasLowLiquidity && !payoutsExceedBalance && (
          <View style={[styles.warningBanner, styles.warningAmber]}>
            <Ionicons name="alert-circle" size={20} color={COLORS.amber} />
            <Text style={[styles.warningText, { color: '#92400E' }]}>
              {t('admin.lowLiquidity')}
            </Text>
          </View>
        )}

        <View style={styles.summaryGrid}>
          <View style={[styles.summaryCard, { borderLeftColor: COLORS.blue }]}>
            <View style={[styles.cardIconCircle, { backgroundColor: COLORS.lightBlue }]}>
              <Ionicons name="server-outline" size={20} color={COLORS.blue} />
            </View>
            <Text style={styles.cardLabel}>{t('admin.totalSettlement')}</Text>
            <Text style={styles.cardValue}>{formatAmount(liquidity.totalSettlement)}</Text>
          </View>

          <View style={[styles.summaryCard, { borderLeftColor: COLORS.amber }]}>
            <View style={[styles.cardIconCircle, { backgroundColor: COLORS.lightAmber }]}>
              <Ionicons name="time-outline" size={20} color={COLORS.amber} />
            </View>
            <Text style={styles.cardLabel}>{t('admin.pendingPayoutsAmount')}</Text>
            <Text style={styles.cardValue}>{formatAmount(liquidity.pendingPayouts)}</Text>
          </View>

          <View style={[styles.summaryCard, { borderLeftColor: COLORS.red }]}>
            <View style={[styles.cardIconCircle, { backgroundColor: COLORS.lightRed }]}>
              <Ionicons name="lock-closed-outline" size={20} color={COLORS.red} />
            </View>
            <Text style={styles.cardLabel}>{t('admin.reservedBalance')}</Text>
            <Text style={styles.cardValue}>{formatAmount(liquidity.reservedBalance)}</Text>
          </View>

          <View style={[styles.summaryCard, { borderLeftColor: COLORS.green }]}>
            <View style={[styles.cardIconCircle, { backgroundColor: COLORS.lightGreen }]}>
              <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.green} />
            </View>
            <Text style={styles.cardLabel}>{t('admin.availableBalance')}</Text>
            <Text style={[styles.cardValue, { color: COLORS.green }]}>
              {formatAmount(liquidity.availableLiquidity)}
            </Text>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('admin.balanceByCurrency')}</Text>
          {liquidity.balanceByCurrency.length === 0 ? (
            <Text style={styles.emptyText}>{t('admin.noData')}</Text>
          ) : (
            liquidity.balanceByCurrency.map((item, index) => (
              <View
                key={item.currency}
                style={[
                  styles.currencyRow,
                  index < liquidity.balanceByCurrency.length - 1 && styles.currencyRowBorder,
                ]}
              >
                <View style={styles.currencyLeft}>
                  <View style={[styles.currencyBadge, { backgroundColor: getCurrencyColor(item.currency) + '20' }]}>
                    <Text style={[styles.currencySymbol, { color: getCurrencyColor(item.currency) }]}>
                      {CURRENCY_ICONS[item.currency] || item.currency}
                    </Text>
                  </View>
                  <Text style={styles.currencyName}>{item.currency}</Text>
                </View>
                <Text style={styles.currencyAmount}>{formatAmount(item.amount, item.currency)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('admin.providerBreakdown')}</Text>
          {liquidity.providers.length === 0 ? (
            <Text style={styles.emptyText}>{t('admin.noData')}</Text>
          ) : (
            <View>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, styles.providerCol]}>Provider</Text>
                <Text style={[styles.tableHeaderCell, styles.currencyCol]}>Currency</Text>
                <Text style={[styles.tableHeaderCell, styles.balanceCol]}>Available</Text>
                <Text style={[styles.tableHeaderCell, styles.balanceCol]}>Reserved</Text>
              </View>
              {liquidity.providers.map((provider: LiquidityProvider, index: number) => (
                <View
                  key={`${provider.provider}-${provider.currency}-${index}`}
                  style={[
                    styles.tableRow,
                    index % 2 === 0 && styles.tableRowEven,
                  ]}
                >
                  <View style={[styles.tableCell, styles.providerCol]}>
                    <Text style={styles.providerName}>{provider.provider}</Text>
                    <Text style={styles.providerUpdated}>
                      {new Date(provider.updatedAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={[styles.tableCellText, styles.currencyCol]}>{provider.currency}</Text>
                  <Text style={[styles.tableCellText, styles.balanceCol]}>
                    {formatAmount(provider.availableBalance, provider.currency)}
                  </Text>
                  <Text style={[styles.tableCellText, styles.balanceCol, { color: COLORS.amber }]}>
                    {formatAmount(provider.reservedBalance, provider.currency)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    );
  };

  return (
    <AdminGuard>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.header}>
          <Ionicons name="water" size={24} color={COLORS.primary} />
          <Text style={styles.headerTitle}>{t('admin.liquidity')}</Text>
        </View>
        {renderContent()}
      </SafeAreaView>
    </AdminGuard>
  );
}

function getCurrencyColor(currency: string): string {
  switch (currency) {
    case 'EUR': return '#3B82F6';
    case 'USD': return '#10B981';
    case 'GBP': return '#8B5CF6';
    case 'ETB': return '#F59E0B';
    default: return '#6B7280';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  scrollView: {
    flex: 1,
  },
  centerState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  stateText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 12,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderRadius: 10,
    gap: 10,
  },
  warningRed: {
    backgroundColor: COLORS.lightRed,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  warningAmber: {
    backgroundColor: COLORS.lightAmber,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 16,
    gap: 8,
  },
  summaryCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
  },
  cardIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  sectionCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingVertical: 16,
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  currencyRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  currencyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  currencyBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  currencySymbol: {
    fontSize: 18,
    fontWeight: '700',
  },
  currencyName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  currencyAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.border,
  },
  tableHeaderCell: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tableRowEven: {
    backgroundColor: '#F9FAFB',
  },
  tableCell: {
    justifyContent: 'center',
  },
  tableCellText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
  },
  providerCol: {
    flex: 2,
  },
  currencyCol: {
    flex: 1,
    textAlign: 'center',
  },
  balanceCol: {
    flex: 1.5,
    textAlign: 'right',
  },
  providerName: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  providerUpdated: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  bottomPadding: {
    height: 32,
  },
});

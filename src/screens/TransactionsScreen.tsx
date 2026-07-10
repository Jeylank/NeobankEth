import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transactionsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import type { Transaction } from '../types';
import {
  getApiErrorMessage,
  getTransactionHistoryState,
} from '../services/transactionHistory';
import '../i18n';

const COLORS = {
  primary: '#006633',
  gold: '#FFD700',
  red: '#DC2626',
  white: '#FFFFFF',
  gray: '#6B7280',
  lightGray: '#F3F4F6',
  text: '#1F2937',
};

const TYPE_FILTERS = [
  { id: 'all', labelKey: 'common.all' },
  { id: 'deposit', labelKey: 'transactions.deposits' },
  { id: 'withdrawal', labelKey: 'transactions.withdrawals' },
  { id: 'transfer', labelKey: 'transactions.transfers' },
  { id: 'remittance', labelKey: 'transactions.remittances' },
  { id: 'bill_payment', labelKey: 'transactions.billPayments' },
];
const DATE_FILTERS = [
  { id: 'all_time', labelKey: 'transactions.allTime' },
  { id: 'today', labelKey: 'transactions.today' },
  { id: 'this_week', labelKey: 'transactions.thisWeek' },
  { id: 'this_month', labelKey: 'transactions.thisMonth' },
];

const SHOW_TRANSACTION_DEBUG = process.env.EXPO_PUBLIC_APP_ENV === 'preview';

export default function TransactionsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [selectedTypeFilter, setSelectedTypeFilter] = useState('all');
  const [selectedDateFilter, setSelectedDateFilter] = useState('all_time');
  const [showDateFilter, setShowDateFilter] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['transactions', user?.uid],
    queryFn: () => transactionsApi.getAll(),
    enabled: !!user?.uid,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const filteredTransactions = useMemo(() => {
    if (!data?.transactions) return [];
    
    let filtered = data.transactions;
    
    if (selectedTypeFilter !== 'all') {
      filtered = filtered.filter(tx => tx.type === selectedTypeFilter);
    }
    
    if (selectedDateFilter !== 'all_time') {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(startOfDay);
      startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      
      filtered = filtered.filter(tx => {
        const txDate = new Date(tx.createdAt);
        switch (selectedDateFilter) {
          case 'today':
            return txDate >= startOfDay;
          case 'this_week':
            return txDate >= startOfWeek;
          case 'this_month':
            return txDate >= startOfMonth;
          default:
            return true;
        }
      });
    }
    
    return filtered;
  }, [data?.transactions, selectedTypeFilter, selectedDateFilter]);

  const historyState = getTransactionHistoryState(
    isLoading,
    isError,
    filteredTransactions.length,
  );
  const backendResponseCount = typeof data?.count === 'number'
    ? data.count
    : data?.transactions?.length ?? 0;

  const formatCurrency = (amount: string, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(parseFloat(amount));
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'deposit':
        return 'arrow-down';
      case 'withdrawal':
        return 'arrow-up';
      case 'transfer':
        return 'swap-horizontal';
      case 'remittance':
        return 'send';
      default:
        return 'cash';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return COLORS.primary;
      case 'pending':
        return '#F59E0B';
      case 'failed':
        return COLORS.red;
      default:
        return COLORS.gray;
    }
  };

  const getTransactionTypeLabel = (type: string) => {
    const typeMap: Record<string, string> = {
      'deposit': t('transactions.deposit'),
      'withdrawal': t('transactions.withdrawal'),
      'transfer': t('transactions.transfer'),
      'remittance': t('transactions.remittance'),
      'bill_payment': t('transactions.billPayment'),
    };
    return typeMap[type] || type.charAt(0).toUpperCase() + type.slice(1);
  };

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      'completed': t('transactions.statusCompleted'),
      'pending': t('transactions.statusPending'),
      'failed': t('transactions.statusFailed'),
    };
    return statusMap[status] || status.charAt(0).toUpperCase() + status.slice(1);
  };

  const renderTransaction = ({ item }: { item: Transaction }) => (
    <View style={styles.transactionCard}>
      <View style={styles.txIcon}>
        <Ionicons
          name={getTransactionIcon(item.type) as any}
          size={24}
          color={item.type === 'deposit' ? COLORS.primary : COLORS.red}
        />
      </View>
      <View style={styles.txDetails}>
        <Text style={styles.txDescription}>{item.description || getTransactionTypeLabel(item.type)}</Text>
        <Text style={styles.txMeta}>
          {new Date(item.createdAt).toLocaleDateString()} • {getTransactionTypeLabel(item.type)}
        </Text>
        {item.recipientName && (
          <Text style={styles.txRecipient}>{t('common.to')}: {item.recipientName}</Text>
        )}
      </View>
      <View style={styles.txRight}>
        <Text
          style={[
            styles.txAmount,
            { color: item.type === 'deposit' ? COLORS.primary : COLORS.red },
          ]}
        >
          {item.type === 'deposit' ? '+' : '-'}
          {formatCurrency(item.amount, item.currency)}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20' }]}>
          <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
            {getStatusLabel(item.status)}
          </Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredTransactions}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderTransaction}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={styles.filtersContainer}>
            {SHOW_TRANSACTION_DEBUG && (
              <Text style={styles.debugText}>
                Backend returned {backendResponseCount} transactions
              </Text>
            )}
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>{t('transactions.filterByType')}:</Text>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={TYPE_FILTERS}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.filterButton,
                      selectedTypeFilter === item.id && styles.filterButtonActive,
                    ]}
                    onPress={() => setSelectedTypeFilter(item.id)}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        selectedTypeFilter === item.id && styles.filterTextActive,
                      ]}
                    >
                      {t(item.labelKey)}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            </View>
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>{t('transactions.filterByDate')}:</Text>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={DATE_FILTERS}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.filterButton,
                      selectedDateFilter === item.id && styles.filterButtonActive,
                    ]}
                    onPress={() => setSelectedDateFilter(item.id)}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        selectedDateFilter === item.id && styles.filterTextActive,
                      ]}
                    >
                      {t(item.labelKey)}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          historyState === 'loading' ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : historyState === 'error' ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="cloud-offline-outline" size={64} color={COLORS.red} />
              <Text style={styles.errorTitle}>Transaction history unavailable</Text>
              <Text style={styles.errorText}>{getApiErrorMessage(error)}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => void refetch()}>
                <Text style={styles.retryButtonText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="receipt-outline" size={64} color={COLORS.gray} />
              <Text style={styles.emptyText}>{t('transactions.noTransactions')}</Text>
            </View>
          )
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
  },
  filtersContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.white,
    marginBottom: 8,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  debugText: {
    marginBottom: 8,
    color: COLORS.gray,
    fontSize: 12,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray,
    marginRight: 8,
    width: 40,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.lightGray,
    marginRight: 8,
  },
  filterButtonActive: {
    backgroundColor: COLORS.primary,
  },
  filterText: {
    fontSize: 14,
    color: COLORS.text,
  },
  filterTextActive: {
    color: COLORS.white,
    fontWeight: '500',
  },
  listContent: {
    paddingBottom: 20,
  },
  transactionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 16,
    borderRadius: 12,
  },
  txIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.lightGray,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  txDetails: {
    flex: 1,
  },
  txDescription: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
    textTransform: 'capitalize',
  },
  txMeta: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  txRecipient: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  txRight: {
    alignItems: 'flex-end',
  },
  txAmount: {
    fontSize: 16,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginTop: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.gray,
    marginTop: 16,
  },
  errorTitle: {
    marginTop: 16,
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '600',
  },
  errorText: {
    marginTop: 8,
    maxWidth: 300,
    color: COLORS.gray,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 18,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
});

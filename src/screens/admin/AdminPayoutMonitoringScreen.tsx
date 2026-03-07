import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminService } from '../../services/adminService';
import type { AdminPayout, AdminPayoutFilters } from '../../types';
import AdminGuard from '../../components/AdminGuard';
import * as FileSystem from 'expo-file-system';

let Sharing: any = null;
try {
  Sharing = require('expo-sharing');
} catch {}

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
  purple: '#8B5CF6',
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  COMPLETED: { bg: '#D1FAE5', text: '#065F46' },
  FAILED: { bg: '#FEE2E2', text: '#991B1B' },
  PROCESSING: { bg: '#DBEAFE', text: '#1E40AF' },
  RETRYING: { bg: '#FEF3C7', text: '#92400E' },
  INITIATED: { bg: '#E0E7FF', text: '#3730A3' },
};

const PROVIDERS = ['CHAPA', 'TELEBIRR', 'BANK'];
const STATUSES = ['INITIATED', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING'];

export default function AdminPayoutMonitoringScreen() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [showProviderFilter, setShowProviderFilter] = useState(false);
  const [showStatusFilter, setShowStatusFilter] = useState(false);

  const filters: AdminPayoutFilters = useMemo(() => ({
    provider: selectedProvider || undefined,
    status: selectedStatus || undefined,
    search: searchQuery || undefined,
  }), [selectedProvider, selectedStatus, searchQuery]);

  const {
    data: payouts,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['admin-payouts', filters],
    queryFn: () => adminService.getPayouts(filters),
  });

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const filteredPayouts = useMemo(() => {
    if (!payouts) return [];
    if (!searchQuery) return payouts;
    const q = searchQuery.toLowerCase();
    return payouts.filter(
      (p) =>
        p.txId.toLowerCase().includes(q) ||
        p.userId.toLowerCase().includes(q)
    );
  }, [payouts, searchQuery]);

  const statusCounts = useMemo(() => {
    const all = payouts || [];
    return {
      total: all.length,
      completed: all.filter((p) => p.payoutStatus === 'COMPLETED').length,
      failed: all.filter((p) => p.payoutStatus === 'FAILED').length,
      processing: all.filter((p) => p.payoutStatus === 'PROCESSING').length,
      retrying: all.filter((p) => p.payoutStatus === 'RETRYING').length,
    };
  }, [payouts]);

  const exportCsv = useCallback(async () => {
    if (!filteredPayouts.length) return;

    const headers = [
      'Transaction ID',
      'User ID',
      'Provider',
      'Provider Ref',
      'Amount',
      'Currency',
      'Status',
      'Retries',
      'Created',
      'Updated',
    ];

    const rows = filteredPayouts.map((p) => [
      p.txId,
      p.userId,
      p.provider,
      p.providerRef,
      p.amount.toString(),
      p.currency,
      p.payoutStatus,
      p.retryCount.toString(),
      p.createdAt,
      p.updatedAt,
    ]);

    const csvContent = [headers, ...rows].map((row) => row.join(',')).join('\n');

    if (Platform.OS === 'web') {
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'payouts_export.csv';
      a.click();
      URL.revokeObjectURL(url);
    } else {
      try {
        const fileUri = FileSystem.documentDirectory + 'payouts_export.csv';
        await FileSystem.writeAsStringAsync(fileUri, csvContent);
        if (Sharing?.shareAsync) {
          await Sharing.shareAsync(fileUri);
        }
      } catch (err) {
        Alert.alert(t('admin.error'), String(err));
      }
    }
  }, [filteredPayouts, t]);

  const getStatusBadgeStyle = (status: string) => {
    return STATUS_COLORS[status] || STATUS_COLORS.INITIATED;
  };

  const getStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      COMPLETED: t('admin.completed'),
      FAILED: t('admin.failed'),
      PROCESSING: t('admin.processing'),
      RETRYING: t('admin.retrying'),
      INITIATED: 'Initiated',
    };
    return map[status] || status;
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

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

    if (!filteredPayouts.length) {
      return (
        <View style={styles.centerState}>
          <Ionicons name="document-outline" size={48} color={COLORS.textSecondary} />
          <Text style={styles.stateText}>{t('admin.noPayouts')}</Text>
        </View>
      );
    }

    return filteredPayouts.map((payout) => (
      <View key={payout.txId} style={styles.payoutCard}>
        <View style={styles.payoutHeader}>
          <View style={styles.payoutIdRow}>
            <Ionicons name="receipt-outline" size={16} color={COLORS.primary} />
            <Text style={styles.payoutTxId} numberOfLines={1}>
              {payout.txId}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: getStatusBadgeStyle(payout.payoutStatus).bg },
            ]}
          >
            <Text
              style={[
                styles.statusBadgeText,
                { color: getStatusBadgeStyle(payout.payoutStatus).text },
              ]}
            >
              {getStatusLabel(payout.payoutStatus)}
            </Text>
          </View>
        </View>

        <View style={styles.payoutDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('admin.userId')}</Text>
            <Text style={styles.detailValue} numberOfLines={1}>{payout.userId}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('admin.provider')}</Text>
            <Text style={styles.detailValue}>{payout.provider}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('admin.providerRef')}</Text>
            <Text style={styles.detailValue} numberOfLines={1}>{payout.providerRef}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('admin.amount')}</Text>
            <Text style={styles.detailValueBold}>
              {payout.amount.toLocaleString()} {payout.currency}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('admin.retryCount')}</Text>
            <Text style={styles.detailValue}>{payout.retryCount}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('admin.createdAt')}</Text>
            <Text style={styles.detailValue}>{formatDate(payout.createdAt)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('admin.updatedAt')}</Text>
            <Text style={styles.detailValue}>{formatDate(payout.updatedAt)}</Text>
          </View>
        </View>
      </View>
    ));
  };

  return (
    <AdminGuard>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView
          style={styles.scrollView}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <View style={styles.header}>
            <Text style={styles.title}>{t('admin.payoutMonitoring')}</Text>
          </View>

          <View style={styles.summaryCards}>
            <View style={[styles.summaryCard, { borderTopColor: COLORS.primary }]}>
              <Text style={styles.summaryCount}>{statusCounts.total}</Text>
              <Text style={styles.summaryLabel}>{t('admin.totalPayouts')}</Text>
            </View>
            <View style={[styles.summaryCard, { borderTopColor: COLORS.green }]}>
              <Text style={[styles.summaryCount, { color: COLORS.green }]}>
                {statusCounts.completed}
              </Text>
              <Text style={styles.summaryLabel}>{t('admin.completed')}</Text>
            </View>
            <View style={[styles.summaryCard, { borderTopColor: COLORS.red }]}>
              <Text style={[styles.summaryCount, { color: COLORS.red }]}>
                {statusCounts.failed}
              </Text>
              <Text style={styles.summaryLabel}>{t('admin.failed')}</Text>
            </View>
            <View style={[styles.summaryCard, { borderTopColor: COLORS.blue }]}>
              <Text style={[styles.summaryCount, { color: COLORS.blue }]}>
                {statusCounts.processing}
              </Text>
              <Text style={styles.summaryLabel}>{t('admin.processing')}</Text>
            </View>
            <View style={[styles.summaryCard, { borderTopColor: COLORS.amber }]}>
              <Text style={[styles.summaryCount, { color: COLORS.amber }]}>
                {statusCounts.retrying}
              </Text>
              <Text style={styles.summaryLabel}>{t('admin.retrying')}</Text>
            </View>
          </View>

          <View style={styles.searchBar}>
            <View style={styles.searchInputContainer}>
              <Ionicons name="search" size={18} color={COLORS.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder={t('admin.searchPayouts')}
                placeholderTextColor={COLORS.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.filterRow}>
            <View style={styles.filterDropdownWrapper}>
              <TouchableOpacity
                style={[
                  styles.filterButton,
                  selectedProvider ? styles.filterButtonActive : undefined,
                ]}
                onPress={() => {
                  setShowProviderFilter(!showProviderFilter);
                  setShowStatusFilter(false);
                }}
              >
                <Ionicons name="business-outline" size={16} color={selectedProvider ? COLORS.white : COLORS.text} />
                <Text style={[styles.filterButtonText, selectedProvider ? styles.filterButtonTextActive : undefined]}>
                  {selectedProvider || t('admin.filterProvider')}
                </Text>
                <Ionicons
                  name={showProviderFilter ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={selectedProvider ? COLORS.white : COLORS.textSecondary}
                />
              </TouchableOpacity>
              {showProviderFilter && (
                <View style={styles.dropdown}>
                  <TouchableOpacity
                    style={styles.dropdownItem}
                    onPress={() => {
                      setSelectedProvider(null);
                      setShowProviderFilter(false);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>{t('admin.all')}</Text>
                  </TouchableOpacity>
                  {PROVIDERS.map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.dropdownItem,
                        selectedProvider === p ? styles.dropdownItemActive : undefined,
                      ]}
                      onPress={() => {
                        setSelectedProvider(p);
                        setShowProviderFilter(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          selectedProvider === p ? styles.dropdownItemTextActive : undefined,
                        ]}
                      >
                        {p}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.filterDropdownWrapper}>
              <TouchableOpacity
                style={[
                  styles.filterButton,
                  selectedStatus ? styles.filterButtonActive : undefined,
                ]}
                onPress={() => {
                  setShowStatusFilter(!showStatusFilter);
                  setShowProviderFilter(false);
                }}
              >
                <Ionicons name="funnel-outline" size={16} color={selectedStatus ? COLORS.white : COLORS.text} />
                <Text style={[styles.filterButtonText, selectedStatus ? styles.filterButtonTextActive : undefined]}>
                  {selectedStatus ? getStatusLabel(selectedStatus) : t('admin.filterStatus')}
                </Text>
                <Ionicons
                  name={showStatusFilter ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={selectedStatus ? COLORS.white : COLORS.textSecondary}
                />
              </TouchableOpacity>
              {showStatusFilter && (
                <View style={styles.dropdown}>
                  <TouchableOpacity
                    style={styles.dropdownItem}
                    onPress={() => {
                      setSelectedStatus(null);
                      setShowStatusFilter(false);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>{t('admin.all')}</Text>
                  </TouchableOpacity>
                  {STATUSES.map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[
                        styles.dropdownItem,
                        selectedStatus === s ? styles.dropdownItemActive : undefined,
                      ]}
                      onPress={() => {
                        setSelectedStatus(s);
                        setShowStatusFilter(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          selectedStatus === s ? styles.dropdownItemTextActive : undefined,
                        ]}
                      >
                        {getStatusLabel(s)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <TouchableOpacity style={styles.exportButton} onPress={exportCsv}>
              <Ionicons name="download-outline" size={16} color={COLORS.white} />
              <Text style={styles.exportButtonText}>{t('admin.exportCsv')}</Text>
            </TouchableOpacity>
          </View>

          {(selectedProvider || selectedStatus) && (
            <TouchableOpacity
              style={styles.clearFilters}
              onPress={() => {
                setSelectedProvider(null);
                setSelectedStatus(null);
              }}
            >
              <Ionicons name="close-circle-outline" size={16} color={COLORS.primary} />
              <Text style={styles.clearFiltersText}>Clear Filters</Text>
            </TouchableOpacity>
          )}

          <View style={styles.payoutList}>{renderContent()}</View>

          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>
    </AdminGuard>
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
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  summaryCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 8,
    marginTop: 12,
  },
  summaryCard: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
    flex: 1,
    minWidth: '18%',
    alignItems: 'center',
    borderTopWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  summaryCount: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
  },
  summaryLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  searchBar: {
    paddingHorizontal: 16,
    marginTop: 16,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 12,
    gap: 8,
    flexWrap: 'wrap',
    zIndex: 10,
  },
  filterDropdownWrapper: {
    position: 'relative',
    zIndex: 10,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  filterButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterButtonText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
  },
  filterButtonTextActive: {
    color: COLORS.white,
  },
  dropdown: {
    position: 'absolute',
    top: 40,
    left: 0,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 100,
    minWidth: 140,
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  dropdownItemActive: {
    backgroundColor: '#E8F5E9',
  },
  dropdownItemText: {
    fontSize: 13,
    color: COLORS.text,
  },
  dropdownItemTextActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
    marginLeft: 'auto',
  },
  exportButtonText: {
    fontSize: 13,
    color: COLORS.white,
    fontWeight: '600',
  },
  clearFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 8,
    gap: 4,
  },
  clearFiltersText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '500',
  },
  payoutList: {
    paddingHorizontal: 16,
    marginTop: 12,
  },
  payoutCard: {
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
  payoutHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 10,
  },
  payoutIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  payoutTxId: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  payoutDetails: {
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    flex: 1,
  },
  detailValue: {
    fontSize: 12,
    color: COLORS.text,
    flex: 2,
    textAlign: 'right',
  },
  detailValueBold: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '600',
    flex: 2,
    textAlign: 'right',
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  stateText: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  retryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
});

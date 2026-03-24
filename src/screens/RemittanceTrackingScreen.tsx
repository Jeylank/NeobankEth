import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { remittanceApi } from '../services/api';
import { SmartEmptyState } from '../components/SmartEmptyState';
import { SkeletonCard } from '../components/SkeletonLoader';
import { navigateToSendAgain } from '../services/sendAgainService';

const COLORS = {
  primary: '#006633',
  gold: '#FFD700',
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
};

const STATUS_CONFIG: Record<string, { color: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  pending:    { color: COLORS.warning,       icon: 'time',             label: 'Pending' },
  processing: { color: COLORS.info,          icon: 'sync',             label: 'Processing' },
  sent:       { color: COLORS.info,          icon: 'paper-plane',      label: 'Sent' },
  completed:  { color: COLORS.success,       icon: 'checkmark-circle', label: 'Completed' },
  failed:     { color: COLORS.error,         icon: 'close-circle',     label: 'Failed' },
  cancelled:  { color: COLORS.textSecondary, icon: 'ban',              label: 'Cancelled' },
};

export default function RemittanceTrackingScreen() {
  const navigation = useNavigation<any>();
  const { t }      = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing]   = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['remittances'],
    queryFn: () => remittanceApi.getAll(),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const filteredRemittances = React.useMemo(() => {
    if (!data?.remittances) return [];
    if (!searchQuery.trim()) return data.remittances;
    return data.remittances.filter((r: any) =>
      r.reference?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.beneficiaryName?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [data?.remittances, searchQuery]);

  const getStatusConfig = (status: string) => STATUS_CONFIG[status] || STATUS_CONFIG.pending;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const renderTimeline = (remittance: any) => {
    const steps = [
      { key: 'initiated',  label: 'Transfer Initiated', time: remittance.createdAt },
      { key: 'processing', label: 'Processing',         time: remittance.processingAt },
      { key: 'sent',       label: 'Money Sent',         time: remittance.sentAt },
      { key: 'completed',  label: 'Delivered',          time: remittance.completedAt },
    ];

    const currentStep = steps.findIndex(s => !remittance[s.key + 'At'] && s.key !== 'initiated');
    const effectiveStep = currentStep === -1 ? steps.length - 1 : currentStep;

    return (
      <View style={styles.timeline}>
        {steps.map((step, index) => (
          <View key={step.key} style={styles.timelineStep}>
            <View style={styles.timelineDotContainer}>
              <View style={[styles.timelineDot, index <= effectiveStep && styles.timelineDotActive]}>
                {index < effectiveStep && (
                  <Ionicons name="checkmark" size={12} color={COLORS.white} />
                )}
              </View>
              {index < steps.length - 1 && (
                <View style={[styles.timelineLine, index < effectiveStep && styles.timelineLineActive]} />
              )}
            </View>
            <View style={styles.timelineContent}>
              <Text style={[styles.timelineLabel, index <= effectiveStep && styles.timelineLabelActive]}>
                {step.label}
              </Text>
              {step.time && (
                <Text style={styles.timelineTime}>{formatDate(step.time)}</Text>
              )}
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderCard = (remittance: any) => {
    const statusConfig = getStatusConfig(remittance.status);
    const isDone = ['completed', 'failed', 'cancelled'].includes(remittance.status);

    return (
      <View key={remittance.id} style={styles.remittanceCard}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.reference}>#{remittance.reference}</Text>
            <Text style={styles.date}>{formatDate(remittance.createdAt)}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + '20' }]}>
            <Ionicons name={statusConfig.icon} size={14} color={statusConfig.color} />
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
        </View>

        <View style={styles.transferDetails}>
          <View style={styles.transferRow}>
            <Text style={styles.transferLabel}>Recipient</Text>
            <Text style={styles.transferValue}>{remittance.beneficiaryName}</Text>
          </View>
          <View style={styles.transferRow}>
            <Text style={styles.transferLabel}>Amount</Text>
            <Text style={styles.transferValue}>
              {remittance.amount?.toLocaleString()} {remittance.fromCurrency}
            </Text>
          </View>
          <View style={styles.transferRow}>
            <Text style={styles.transferLabel}>Recipient Gets</Text>
            <Text style={styles.transferValueHighlight}>
              {remittance.recipientAmount?.toLocaleString()} {remittance.toCurrency}
            </Text>
          </View>
        </View>

        {renderTimeline(remittance)}

        <View style={styles.cardActions}>
          {!isDone && (
            <TouchableOpacity
              style={styles.trackBtn}
              onPress={() => navigation.navigate('TransferTracking', { txId: remittance.reference || remittance.id })}
            >
              <Ionicons name="locate" size={16} color={COLORS.primary} />
              <Text style={styles.trackBtnText}>Track Live</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.sendAgainBtn, isDone && styles.sendAgainBtnFull]}
            onPress={() => navigateToSendAgain(navigation, remittance)}
          >
            <Ionicons name="paper-plane" size={16} color={COLORS.white} />
            <Text style={styles.sendAgainBtnText}>{t('sendAgain.sendAgain')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Track Transfers</Text>
        <Text style={styles.subtitle}>Monitor your remittance status</Text>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color={COLORS.textSecondary} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by reference or recipient"
          placeholderTextColor={COLORS.textSecondary}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {isLoading ? (
          <View style={styles.skeletonContainer}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </View>
        ) : filteredRemittances.length > 0 ? (
          filteredRemittances.map(renderCard)
        ) : (
          <SmartEmptyState
            icon="paper-plane-outline"
            title={searchQuery ? 'No Transfers Found' : t('sendAgain.noTransfers')}
            subtitle={searchQuery ? 'No transfers match your search' : t('sendAgain.noTransfersSub')}
            ctaLabel={searchQuery ? undefined : t('sendAgain.sendNow')}
            onCta={searchQuery ? undefined : () => navigation.navigate('Remittance')}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    padding: 20,
    backgroundColor: COLORS.primary,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.white,
    opacity: 0.8,
    marginTop: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    margin: 20,
    marginBottom: 0,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
  },
  scrollView: {
    flex: 1,
    padding: 20,
  },
  skeletonContainer: {
    gap: 12,
  },
  remittanceCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  reference: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  date: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  transferDetails: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  transferRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  transferLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  transferValue: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  transferValueHighlight: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  timeline: {
    paddingLeft: 8,
    marginBottom: 12,
  },
  timelineStep: {
    flexDirection: 'row',
    minHeight: 50,
  },
  timelineDotContainer: {
    alignItems: 'center',
    width: 24,
  },
  timelineDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotActive: {
    backgroundColor: COLORS.primary,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: COLORS.border,
    marginVertical: 4,
  },
  timelineLineActive: {
    backgroundColor: COLORS.primary,
  },
  timelineContent: {
    flex: 1,
    marginLeft: 12,
    paddingBottom: 16,
  },
  timelineLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  timelineLabelActive: {
    color: COLORS.text,
    fontWeight: '500',
  },
  timelineTime: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  trackBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: COLORS.primary + '10',
    borderRadius: 8,
  },
  trackBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  sendAgainBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
  },
  sendAgainBtnFull: {
    flex: 2,
  },
  sendAgainBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.white,
  },
});

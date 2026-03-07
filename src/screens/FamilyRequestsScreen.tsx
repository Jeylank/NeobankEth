import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { moneyRequestsService } from '../services/firestoreMoneyRequests';
import type { MoneyRequest, RequestPurpose } from '../types';

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
  blue: '#3B82F6',
  purple: '#8B5CF6',
};

const PURPOSE_I18N: Record<RequestPurpose, string> = {
  school_fees: 'familyRequest.schoolFees',
  electricity: 'familyRequest.electricity',
  medical: 'familyRequest.medical',
  family_support: 'familyRequest.familySupport',
  other: 'familyRequest.other',
};

const PURPOSE_ICONS: Record<RequestPurpose, keyof typeof Ionicons.glyphMap> = {
  school_fees: 'school-outline',
  electricity: 'flash-outline',
  medical: 'medkit-outline',
  family_support: 'heart-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

const STATUS_COLORS: Record<string, string> = {
  pending: COLORS.warning,
  approved: COLORS.success,
  declined: COLORS.error,
};

export default function FamilyRequestsScreen({ navigation }: any) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.uid ?? '';

  const [activeTab, setActiveTab] = useState<'incoming' | 'sent'>('incoming');
  const [incoming, setIncoming] = useState<MoneyRequest[]>([]);
  const [sent, setSent] = useState<MoneyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [incomingData, sentData] = await Promise.all([
        moneyRequestsService.getIncomingRequests(userId),
        moneyRequestsService.getOutgoingRequests(userId),
      ]);
      setIncoming(incomingData);
      setSent(sentData);
    } catch (err) {
      console.error('Failed to load requests:', err);
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleApprove = async (request: MoneyRequest) => {
    Alert.alert(
      t('familyRequest.confirmApprove'),
      t('familyRequest.approveMsg', { name: request.requesterName, amount: request.amount, currency: request.currency }),
      [
        { text: t('familyRequest.cancel'), style: 'cancel' },
        {
          text: t('familyRequest.approve'),
          onPress: async () => {
            setProcessingId(request.id);
            try {
              await moneyRequestsService.approveRequest(request.id, userId);
              Alert.alert(t('common.success'), t('familyRequest.approveSuccess'));
              await loadData();
            } catch (err) {
              Alert.alert(t('common.error'), t('common.error'));
            } finally {
              setProcessingId(null);
            }
          },
        },
      ]
    );
  };

  const handleDecline = async (request: MoneyRequest) => {
    Alert.alert(
      t('familyRequest.confirmDecline'),
      t('familyRequest.declineMsg', { name: request.requesterName }),
      [
        { text: t('familyRequest.cancel'), style: 'cancel' },
        {
          text: t('familyRequest.decline'),
          style: 'destructive',
          onPress: async () => {
            setProcessingId(request.id);
            try {
              await moneyRequestsService.declineRequest(request.id, userId);
              Alert.alert(t('common.success'), t('familyRequest.declineSuccess'));
              await loadData();
            } catch (err) {
              Alert.alert(t('common.error'), t('common.error'));
            } finally {
              setProcessingId(null);
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color={COLORS.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => { setLoading(true); setError(null); loadData(); }}
          >
            <Ionicons name="refresh" size={18} color={COLORS.white} />
            <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const requests = activeTab === 'incoming' ? incoming : sent;

  const renderRequestCard = (request: MoneyRequest) => {
    const isProcessing = processingId === request.id;
    const isPending = request.status === 'pending';
    const isIncoming = activeTab === 'incoming';

    return (
      <View key={request.id} style={styles.requestCard}>
        <View style={styles.cardHeader}>
          <View style={styles.avatarContainer}>
            <Ionicons
              name={PURPOSE_ICONS[request.purpose] || 'person'}
              size={24}
              color={COLORS.primary}
            />
          </View>
          <View style={styles.cardHeaderInfo}>
            <Text style={styles.requesterName}>{request.requesterName}</Text>
            <Text style={styles.purposeText}>{t(PURPOSE_I18N[request.purpose])}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[request.status] + '20' }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[request.status] }]}>
              {t(`familyRequest.${request.status}`)}
            </Text>
          </View>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>{t('familyRequest.amount')}</Text>
            <Text style={styles.amountValue}>
              {request.amount.toLocaleString()} {request.currency}
            </Text>
          </View>

          {request.message ? (
            <View style={styles.messageBox}>
              <Ionicons name="chatbubble-outline" size={14} color={COLORS.textSecondary} />
              <Text style={styles.messageText}>{request.message}</Text>
            </View>
          ) : null}

          <View style={styles.timeRow}>
            <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.timeText}>
              {formatDate(request.createdAt)} {formatTime(request.createdAt)}
            </Text>
          </View>
        </View>

        {isIncoming && isPending && (
          <View style={styles.cardActions}>
            {isProcessing ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <>
                <TouchableOpacity
                  style={styles.declineButton}
                  onPress={() => handleDecline(request)}
                >
                  <Ionicons name="close-circle-outline" size={18} color={COLORS.error} />
                  <Text style={[styles.actionText, { color: COLORS.error }]}>
                    {t('familyRequest.decline')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.approveButton}
                  onPress={() => handleApprove(request)}
                >
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.white} />
                  <Text style={styles.approveText}>{t('familyRequest.approve')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="mail-open-outline" size={56} color={COLORS.textSecondary} />
      </View>
      <Text style={styles.emptyTitle}>
        {activeTab === 'incoming' ? t('familyRequest.noIncoming') : t('familyRequest.noSent')}
      </Text>
      <Text style={styles.emptyMessage}>{t('familyRequest.emptyMessage')}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'incoming' && styles.tabActive]}
          onPress={() => setActiveTab('incoming')}
        >
          <Ionicons
            name="mail-outline"
            size={18}
            color={activeTab === 'incoming' ? COLORS.primary : COLORS.textSecondary}
          />
          <Text style={[styles.tabText, activeTab === 'incoming' && styles.tabTextActive]}>
            {t('familyRequest.incoming')}
          </Text>
          {incoming.filter(r => r.status === 'pending').length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {incoming.filter(r => r.status === 'pending').length}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'sent' && styles.tabActive]}
          onPress={() => setActiveTab('sent')}
        >
          <Ionicons
            name="paper-plane-outline"
            size={18}
            color={activeTab === 'sent' ? COLORS.primary : COLORS.textSecondary}
          />
          <Text style={[styles.tabText, activeTab === 'sent' && styles.tabTextActive]}>
            {t('familyRequest.sent')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {requests.length === 0 ? renderEmpty() : requests.map(renderRequestCard)}

        {activeTab === 'incoming' && (
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => navigation.navigate('RequestMoney')}
          >
            <Ionicons name="add-circle" size={20} color={COLORS.white} />
            <Text style={styles.createButtonText}>{t('familyRequest.createRequest')}</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 16,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  tabActive: {
    backgroundColor: '#ECFDF5',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  tabTextActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  badge: {
    backgroundColor: COLORS.error,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
  },
  requestCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderInfo: {
    flex: 1,
    marginLeft: 12,
  },
  requesterName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  purposeText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardBody: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  amountLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  amountValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primary,
  },
  messageBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.background,
    padding: 10,
    borderRadius: 8,
    gap: 8,
    marginBottom: 10,
  },
  messageText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  cardActions: {
    flexDirection: 'row',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 10,
    justifyContent: 'flex-end',
  },
  declineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.background,
    gap: 6,
  },
  approveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    gap: 6,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  approveText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginTop: 20,
  },
  createButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorText: {
    fontSize: 16,
    color: COLORS.error,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 20,
    paddingHorizontal: 32,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
});

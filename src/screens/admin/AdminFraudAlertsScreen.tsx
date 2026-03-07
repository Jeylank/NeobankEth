import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';
import type { FraudAlert, FraudAlertStatus } from '../../types';

const COLORS = {
  primary: '#006633',
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  error: '#EF4444',
  success: '#10B981',
  warning: '#F59E0B',
  blue: '#3B82F6',
  red: '#DC2626',
  amber: '#D97706',
  green: '#059669',
};

type FilterTab = 'all' | FraudAlertStatus;

const STATUS_COLORS: Record<FraudAlertStatus, string> = {
  review_required: COLORS.warning,
  approved: COLORS.success,
  blocked: COLORS.red,
  frozen: COLORS.blue,
};

function getRiskColor(score: number): string {
  if (score >= 80) return COLORS.red;
  if (score >= 50) return COLORS.amber;
  return COLORS.green;
}

function getRiskLabel(score: number, t: (key: string) => string): string {
  if (score >= 80) return t('admin.high');
  if (score >= 50) return t('admin.medium');
  return t('admin.low');
}

function getStatusLabel(status: FraudAlertStatus, t: (key: string) => string): string {
  const map: Record<FraudAlertStatus, string> = {
    review_required: t('admin.reviewRequired'),
    approved: t('admin.approved'),
    blocked: t('admin.blocked'),
    frozen: t('admin.frozen'),
  };
  return map[status] || status;
}

function AdminFraudAlertsContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [confirmModal, setConfirmModal] = useState<{
    visible: boolean;
    type: 'approve' | 'block' | 'freeze';
    alertId: string;
  }>({ visible: false, type: 'approve', alertId: '' });

  const filterStatus = activeTab === 'all' ? undefined : activeTab;

  const { data: alerts, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-fraud-alerts', filterStatus],
    queryFn: () => adminService.getFraudAlerts(filterStatus ? { status: filterStatus } : undefined),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => adminService.approveFraudAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-fraud-alerts'] });
      setConfirmModal({ visible: false, type: 'approve', alertId: '' });
    },
    onError: () => Alert.alert(t('admin.error')),
  });

  const blockMutation = useMutation({
    mutationFn: (id: string) => adminService.blockFraudAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-fraud-alerts'] });
      setConfirmModal({ visible: false, type: 'block', alertId: '' });
    },
    onError: () => Alert.alert(t('admin.error')),
  });

  const freezeMutation = useMutation({
    mutationFn: (id: string) => adminService.freezeAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-fraud-alerts'] });
      setConfirmModal({ visible: false, type: 'freeze', alertId: '' });
    },
    onError: () => Alert.alert(t('admin.error')),
  });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: t('admin.all') },
    { key: 'review_required', label: t('admin.reviewRequired') },
    { key: 'approved', label: t('admin.approved') },
    { key: 'blocked', label: t('admin.blocked') },
    { key: 'frozen', label: t('admin.frozen') },
  ];

  const reviewRequiredCount = alerts?.filter((a) => a.status === 'review_required').length ?? 0;

  const handleConfirm = () => {
    const { type, alertId } = confirmModal;
    if (type === 'approve') approveMutation.mutate(alertId);
    else if (type === 'block') blockMutation.mutate(alertId);
    else if (type === 'freeze') freezeMutation.mutate(alertId);
  };

  const isActionLoading =
    approveMutation.isPending || blockMutation.isPending || freezeMutation.isPending;

  const getConfirmMessage = () => {
    switch (confirmModal.type) {
      case 'approve': return t('admin.confirmApprove');
      case 'block': return t('admin.confirmBlock');
      case 'freeze': return t('admin.confirmFreeze');
    }
  };

  const getConfirmTitle = () => {
    switch (confirmModal.type) {
      case 'approve': return t('admin.approveTransaction');
      case 'block': return t('admin.blockTransaction');
      case 'freeze': return t('admin.freezeAccount');
    }
  };

  const renderAlert = (alert: FraudAlert) => {
    const riskColor = getRiskColor(alert.riskScore);
    const statusColor = STATUS_COLORS[alert.status];
    const isReviewRequired = alert.status === 'review_required';

    return (
      <View key={alert.alertId} style={[styles.alertCard, isReviewRequired && styles.alertCardHighlight]}>
        <View style={styles.alertHeader}>
          <View style={styles.alertIdRow}>
            <Text style={styles.alertIdLabel}>{t('admin.alertId')}</Text>
            <Text style={styles.alertIdValue}>{alert.alertId}</Text>
            {isReviewRequired && (
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeText}>{t('admin.newBadge')}</Text>
              </View>
            )}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {getStatusLabel(alert.status, t)}
            </Text>
          </View>
        </View>

        <View style={styles.alertDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('admin.txId')}</Text>
            <Text style={styles.detailValue}>{alert.txId}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('admin.userId')}</Text>
            <Text style={styles.detailValue}>{alert.userId}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('admin.riskScore')}</Text>
            <View style={styles.riskScoreContainer}>
              <View style={[styles.riskScoreBadge, { backgroundColor: riskColor + '20' }]}>
                <Text style={[styles.riskScoreText, { color: riskColor }]}>
                  {alert.riskScore}
                </Text>
              </View>
              <Text style={[styles.riskLabel, { color: riskColor }]}>
                {getRiskLabel(alert.riskScore, t)}
              </Text>
            </View>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('admin.reason')}</Text>
            <Text style={[styles.detailValue, styles.reasonText]}>{alert.reason}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('admin.createdAt')}</Text>
            <Text style={styles.detailValue}>
              {new Date(alert.createdAt).toLocaleString()}
            </Text>
          </View>
        </View>

        {alert.status === 'review_required' && (
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionButton, styles.approveButton]}
              onPress={() =>
                setConfirmModal({ visible: true, type: 'approve', alertId: alert.alertId })
              }
            >
              <Ionicons name="checkmark-circle" size={16} color={COLORS.white} />
              <Text style={styles.actionButtonText}>{t('admin.approveTransaction')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.blockButton]}
              onPress={() =>
                setConfirmModal({ visible: true, type: 'block', alertId: alert.alertId })
              }
            >
              <Ionicons name="close-circle" size={16} color={COLORS.white} />
              <Text style={styles.actionButtonText}>{t('admin.blockTransaction')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.freezeButton]}
              onPress={() =>
                setConfirmModal({ visible: true, type: 'freeze', alertId: alert.alertId })
              }
            >
              <Ionicons name="snow" size={16} color={COLORS.white} />
              <Text style={styles.actionButtonText}>{t('admin.freezeAccount')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="warning" size={24} color={COLORS.primary} />
        <Text style={styles.headerTitle}>{t('admin.fraudAlerts')}</Text>
        {reviewRequiredCount > 0 && (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{reviewRequiredCount}</Text>
          </View>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsContainer}
        contentContainerStyle={styles.tabsContent}
      >
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
            {tab.key === 'review_required' && reviewRequiredCount > 0 && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{reviewRequiredCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.stateText}>{t('admin.loading')}</Text>
          </View>
        ) : isError ? (
          <View style={styles.centerState}>
            <Ionicons name="alert-circle" size={48} color={COLORS.error} />
            <Text style={styles.stateText}>{t('admin.error')}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
              <Text style={styles.retryButtonText}>{t('admin.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : !alerts || alerts.length === 0 ? (
          <View style={styles.centerState}>
            <Ionicons name="shield-checkmark" size={48} color={COLORS.success} />
            <Text style={styles.stateText}>{t('admin.noAlerts')}</Text>
          </View>
        ) : (
          alerts.map(renderAlert)
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal
        visible={confirmModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmModal({ ...confirmModal, visible: false })}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{getConfirmTitle()}</Text>
            <Text style={styles.modalMessage}>{getConfirmMessage()}</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setConfirmModal({ ...confirmModal, visible: false })}
                disabled={isActionLoading}
              >
                <Text style={styles.modalCancelText}>{t('admin.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalConfirmButton,
                  confirmModal.type === 'approve' && { backgroundColor: COLORS.success },
                  confirmModal.type === 'block' && { backgroundColor: COLORS.red },
                  confirmModal.type === 'freeze' && { backgroundColor: COLORS.blue },
                ]}
                onPress={handleConfirm}
                disabled={isActionLoading}
              >
                {isActionLoading ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Text style={styles.modalConfirmText}>{t('admin.confirm')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default function AdminFraudAlertsScreen() {
  return (
    <AdminGuard>
      <AdminFraudAlertsContent />
    </AdminGuard>
  );
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
    paddingVertical: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
  },
  headerBadge: {
    backgroundColor: COLORS.error,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerBadgeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '700',
  },
  tabsContainer: {
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    maxHeight: 48,
  },
  tabsContent: {
    paddingHorizontal: 12,
    gap: 4,
    alignItems: 'center',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    marginHorizontal: 2,
    gap: 6,
  },
  tabActive: {
    backgroundColor: COLORS.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  tabTextActive: {
    color: COLORS.white,
  },
  tabBadge: {
    backgroundColor: COLORS.error,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    gap: 12,
  },
  stateText: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  retryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  alertCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  alertCardHighlight: {
    borderColor: COLORS.warning,
    borderWidth: 2,
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  alertIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  alertIdLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  alertIdValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  newBadge: {
    backgroundColor: COLORS.error,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  newBadgeText: {
    color: COLORS.white,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  alertDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  detailLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    minWidth: 100,
  },
  detailValue: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  reasonText: {
    maxWidth: '60%',
  },
  riskScoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  riskScoreBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  riskScoreText: {
    fontSize: 14,
    fontWeight: '700',
  },
  riskLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 4,
  },
  approveButton: {
    backgroundColor: COLORS.success,
  },
  blockButton: {
    backgroundColor: COLORS.red,
  },
  freezeButton: {
    backgroundColor: COLORS.blue,
  },
  actionButtonText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  modalConfirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalConfirmText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
});

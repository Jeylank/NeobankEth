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
  Share,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminService } from '../../services/adminService';
import AdminGuard from '../../components/AdminGuard';
import type { Dispute, DisputeStatus } from '../../types';

const COLORS = {
  primary: '#006633',
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  green: '#10B981',
  blue: '#3B82F6',
  amber: '#F59E0B',
  red: '#EF4444',
  purple: '#8B5CF6',
};

const STATUS_COLORS: Record<string, string> = {
  open: COLORS.blue,
  investigating: COLORS.amber,
  resolved: COLORS.green,
  rejected: COLORS.red,
  refunded: COLORS.purple,
};

type FilterTab = 'all' | DisputeStatus;

export default function AdminDisputesScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ visible: boolean; action: string; dispute: Dispute | null }>({
    visible: false,
    action: '',
    dispute: null,
  });
  const [actionLoading, setActionLoading] = useState(false);

  const filters = activeTab === 'all' ? undefined : { status: activeTab as DisputeStatus };

  const { data: disputes, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-disputes', activeTab],
    queryFn: () => adminService.getDisputes(filters),
  });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const showConfirmation = (dispute: Dispute, action: string) => {
    setConfirmModal({ visible: true, action, dispute });
  };

  const handleConfirmedAction = async () => {
    const { action, dispute } = confirmModal;
    if (!dispute) return;

    setActionLoading(true);
    try {
      if (action === 'refund') {
        await adminService.refundDispute(dispute.disputeId);
      } else {
        await adminService.updateDisputeStatus(dispute.disputeId, action);
      }
      queryClient.invalidateQueries({ queryKey: ['admin-disputes'] });
      setConfirmModal({ visible: false, action: '', dispute: null });
      setDetailModalVisible(false);
      setSelectedDispute(null);
    } catch {
      Alert.alert(t('admin.error'), t('admin.retry'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleExportCsv = async () => {
    if (!disputes || disputes.length === 0) return;

    const headers = ['Dispute ID', 'Transaction ID', 'User ID', 'Reason', 'Status', 'Resolution', 'Created At'];
    const rows = disputes.map((d) =>
      [d.disputeId, d.txId, d.userId, d.reason, d.status, d.resolution || '', d.createdAt].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');

    try {
      await Share.share({
        message: csv,
        title: 'disputes_export.csv',
      });
    } catch {
      // sharing cancelled
    }
  };

  const openDetail = (dispute: Dispute) => {
    setSelectedDispute(dispute);
    setDetailModalVisible(true);
  };

  const getStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      open: t('admin.open'),
      investigating: t('admin.investigating'),
      resolved: t('admin.resolved'),
      rejected: t('admin.rejected'),
      refunded: t('admin.refunded'),
    };
    return map[status] || status;
  };

  const getConfirmMessage = (action: string) => {
    if (action === 'refund') return t('admin.confirmRefund');
    if (action === 'rejected') return t('admin.confirmReject');
    return t('admin.confirm');
  };

  const getConfirmTitle = (action: string) => {
    if (action === 'refund') return t('admin.refund');
    if (action === 'rejected') return t('admin.rejectDispute');
    if (action === 'investigating') return t('admin.investigate');
    if (action === 'resolved') return t('admin.resolveDispute');
    return t('admin.confirm');
  };

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: t('admin.all') },
    { key: 'open', label: t('admin.open') },
    { key: 'investigating', label: t('admin.investigating') },
    { key: 'resolved', label: t('admin.resolved') },
    { key: 'rejected', label: t('admin.rejected') },
    { key: 'refunded', label: t('admin.refunded') },
  ];

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>{t('admin.loading')}</Text>
        </View>
      );
    }

    if (isError) {
      return (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.red} />
          <Text style={styles.errorText}>{t('admin.error')}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>{t('admin.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!disputes || disputes.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons name="document-text-outline" size={48} color={COLORS.textSecondary} />
          <Text style={styles.emptyText}>{t('admin.noDisputes')}</Text>
        </View>
      );
    }

    return disputes.map((dispute) => (
      <TouchableOpacity
        key={dispute.disputeId}
        style={styles.disputeCard}
        onPress={() => openDetail(dispute)}
      >
        <View style={styles.disputeHeader}>
          <Text style={styles.disputeId}>{dispute.disputeId}</Text>
          <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[dispute.status] || COLORS.textSecondary) + '20' }]}>
            <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[dispute.status] || COLORS.textSecondary }]}>
              {getStatusLabel(dispute.status)}
            </Text>
          </View>
        </View>
        <View style={styles.disputeBody}>
          <View style={styles.disputeRow}>
            <Text style={styles.disputeLabel}>{t('admin.txId')}</Text>
            <Text style={styles.disputeValue}>{dispute.txId}</Text>
          </View>
          <View style={styles.disputeRow}>
            <Text style={styles.disputeLabel}>{t('admin.userId')}</Text>
            <Text style={styles.disputeValue}>{dispute.userId}</Text>
          </View>
          <View style={styles.disputeRow}>
            <Text style={styles.disputeLabel}>{t('admin.disputeReason')}</Text>
            <Text style={styles.disputeValue} numberOfLines={1}>{dispute.reason}</Text>
          </View>
          {dispute.resolution && (
            <View style={styles.disputeRow}>
              <Text style={styles.disputeLabel}>{t('admin.resolution')}</Text>
              <Text style={styles.disputeValue} numberOfLines={1}>{dispute.resolution}</Text>
            </View>
          )}
        </View>
        <View style={styles.disputeFooter}>
          <Text style={styles.disputeDate}>{new Date(dispute.createdAt).toLocaleDateString()}</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
        </View>
      </TouchableOpacity>
    ));
  };

  return (
    <AdminGuard>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('admin.disputes')}</Text>
          <TouchableOpacity style={styles.exportButton} onPress={handleExportCsv}>
            <Ionicons name="download-outline" size={18} color={COLORS.primary} />
            <Text style={styles.exportButtonText}>{t('admin.exportCsv')}</Text>
          </TouchableOpacity>
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
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView
          style={styles.listContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {renderContent()}
          <View style={{ height: 32 }} />
        </ScrollView>

        <Modal
          visible={detailModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setDetailModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('admin.disputeDetails')}</Text>
                <TouchableOpacity onPress={() => setDetailModalVisible(false)}>
                  <Ionicons name="close" size={24} color={COLORS.text} />
                </TouchableOpacity>
              </View>

              {selectedDispute && (
                <ScrollView style={styles.modalBody}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('admin.disputeId')}</Text>
                    <Text style={styles.detailValue}>{selectedDispute.disputeId}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('admin.status')}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[selectedDispute.status] || COLORS.textSecondary) + '20' }]}>
                      <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[selectedDispute.status] || COLORS.textSecondary }]}>
                        {getStatusLabel(selectedDispute.status)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('admin.linkedTransaction')}</Text>
                    <Text style={styles.detailValue}>{selectedDispute.txId}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('admin.userId')}</Text>
                    <Text style={styles.detailValue}>{selectedDispute.userId}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('admin.disputeReason')}</Text>
                    <Text style={styles.detailValue}>{selectedDispute.reason}</Text>
                  </View>
                  {selectedDispute.resolution && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>{t('admin.resolution')}</Text>
                      <Text style={styles.detailValue}>{selectedDispute.resolution}</Text>
                    </View>
                  )}
                  {selectedDispute.providerRef && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>{t('admin.providerRef')}</Text>
                      <Text style={styles.detailValue}>{selectedDispute.providerRef}</Text>
                    </View>
                  )}
                  {selectedDispute.payoutStatus && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>{t('admin.payoutStatus')}</Text>
                      <Text style={styles.detailValue}>{selectedDispute.payoutStatus}</Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('admin.createdAt')}</Text>
                    <Text style={styles.detailValue}>{new Date(selectedDispute.createdAt).toLocaleString()}</Text>
                  </View>

                  {selectedDispute.auditLog && selectedDispute.auditLog.length > 0 && (
                    <View style={styles.auditSection}>
                      <Text style={styles.sectionLabel}>{t('admin.auditLog')}</Text>
                      {selectedDispute.auditLog.map((entry, index) => (
                        <View key={index} style={styles.auditEntry}>
                          <View style={styles.auditDot} />
                          <Text style={styles.auditText}>{entry}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={styles.actionsSection}>
                    <Text style={styles.actionsTitle}>{t('admin.actions')}</Text>
                    {selectedDispute.status === 'open' && (
                      <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: COLORS.amber }]}
                        onPress={() => showConfirmation(selectedDispute, 'investigating')}
                      >
                        <Ionicons name="search-outline" size={18} color={COLORS.white} />
                        <Text style={styles.actionButtonText}>{t('admin.investigate')}</Text>
                      </TouchableOpacity>
                    )}
                    {(selectedDispute.status === 'open' || selectedDispute.status === 'investigating') && (
                      <>
                        <TouchableOpacity
                          style={[styles.actionButton, { backgroundColor: COLORS.purple }]}
                          onPress={() => showConfirmation(selectedDispute, 'refund')}
                        >
                          <Ionicons name="card-outline" size={18} color={COLORS.white} />
                          <Text style={styles.actionButtonText}>{t('admin.refund')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionButton, { backgroundColor: COLORS.red }]}
                          onPress={() => showConfirmation(selectedDispute, 'rejected')}
                        >
                          <Ionicons name="close-circle-outline" size={18} color={COLORS.white} />
                          <Text style={styles.actionButtonText}>{t('admin.rejectDispute')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionButton, { backgroundColor: COLORS.green }]}
                          onPress={() => showConfirmation(selectedDispute, 'resolved')}
                        >
                          <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.white} />
                          <Text style={styles.actionButtonText}>{t('admin.resolveDispute')}</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        <Modal
          visible={confirmModal.visible}
          animationType="fade"
          transparent
          onRequestClose={() => setConfirmModal({ visible: false, action: '', dispute: null })}
        >
          <View style={styles.confirmOverlay}>
            <View style={styles.confirmContent}>
              <Text style={styles.confirmTitle}>{getConfirmTitle(confirmModal.action)}</Text>
              <Text style={styles.confirmMessage}>{getConfirmMessage(confirmModal.action)}</Text>
              <View style={styles.confirmActions}>
                <TouchableOpacity
                  style={styles.confirmCancelButton}
                  onPress={() => setConfirmModal({ visible: false, action: '', dispute: null })}
                >
                  <Text style={styles.confirmCancelText}>{t('admin.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmActionButton}
                  disabled={actionLoading}
                  onPress={handleConfirmedAction}
                >
                  {actionLoading ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <Text style={styles.confirmActionText}>{t('admin.confirm')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.primary,
    gap: 6,
  },
  exportButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  tabsContainer: {
    maxHeight: 44,
    marginBottom: 8,
  },
  tabsContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  tabTextActive: {
    color: COLORS.white,
  },
  listContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 12,
  },
  errorText: {
    fontSize: 16,
    color: COLORS.red,
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
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 12,
  },
  disputeCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  disputeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  disputeId: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
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
  disputeBody: {
    gap: 6,
  },
  disputeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  disputeLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  disputeValue: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.text,
    maxWidth: '55%',
    textAlign: 'right',
  },
  disputeFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  disputeDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  modalBody: {
    padding: 20,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  detailLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  auditSection: {
    marginTop: 20,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  auditEntry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 10,
  },
  auditDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginTop: 5,
  },
  auditText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 18,
  },
  actionsSection: {
    marginTop: 24,
    gap: 10,
    paddingBottom: 32,
  },
  actionsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  actionButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  confirmContent: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    width: '100%',
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  confirmMessage: {
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: 24,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 12,
  },
  confirmCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  confirmCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  confirmActionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  confirmActionText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
});

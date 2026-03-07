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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminService } from '../../services/adminService';
import AdminGuard from '../../components/AdminGuard';
import type { SupportTicket, TicketStatus } from '../../types';

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
  in_review: COLORS.amber,
  resolved: COLORS.green,
  closed: COLORS.textSecondary,
};

const PRIORITY_COLORS: Record<string, string> = {
  low: COLORS.green,
  medium: COLORS.amber,
  high: '#F97316',
  urgent: COLORS.red,
};

type FilterTab = 'all' | TicketStatus;

export default function AdminSupportTicketsScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const filters = activeTab === 'all' ? undefined : { status: activeTab as TicketStatus };

  const { data: tickets, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-support-tickets', activeTab],
    queryFn: () => adminService.getSupportTickets(filters),
  });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleStatusUpdate = async (ticket: SupportTicket, newStatus: string) => {
    setActionLoading(true);
    try {
      await adminService.updateSupportTicketStatus(ticket.ticketId, newStatus);
      queryClient.invalidateQueries({ queryKey: ['admin-support-tickets'] });
      setDetailModalVisible(false);
      setSelectedTicket(null);
    } catch {
      Alert.alert(t('admin.error'), t('admin.retry'));
    } finally {
      setActionLoading(false);
    }
  };

  const openDetail = (ticket: SupportTicket) => {
    setSelectedTicket(ticket);
    setDetailModalVisible(true);
  };

  const getStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      open: t('admin.open'),
      in_review: t('admin.inReview'),
      resolved: t('admin.resolved'),
      closed: t('admin.closed'),
    };
    return map[status] || status;
  };

  const getPriorityLabel = (priority: string) => {
    const map: Record<string, string> = {
      low: t('admin.low'),
      medium: t('admin.medium'),
      high: t('admin.high'),
      urgent: t('admin.urgent'),
    };
    return map[priority] || priority;
  };

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: t('admin.all') },
    { key: 'open', label: t('admin.open') },
    { key: 'in_review', label: t('admin.inReview') },
    { key: 'resolved', label: t('admin.resolved') },
    { key: 'closed', label: t('admin.closed') },
  ];

  const statusCounts = {
    open: tickets?.filter((tk) => tk.status === 'open').length || 0,
    in_review: tickets?.filter((tk) => tk.status === 'in_review').length || 0,
    resolved: tickets?.filter((tk) => tk.status === 'resolved').length || 0,
    closed: tickets?.filter((tk) => tk.status === 'closed').length || 0,
  };

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

    if (!tickets || tickets.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons name="chatbubbles-outline" size={48} color={COLORS.textSecondary} />
          <Text style={styles.emptyText}>{t('admin.noTickets')}</Text>
        </View>
      );
    }

    return tickets.map((ticket) => (
      <TouchableOpacity
        key={ticket.ticketId}
        style={styles.ticketCard}
        onPress={() => openDetail(ticket)}
      >
        <View style={styles.ticketHeader}>
          <Text style={styles.ticketId}>{ticket.ticketId}</Text>
          <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[ticket.status] || COLORS.textSecondary) + '20' }]}>
            <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[ticket.status] || COLORS.textSecondary }]}>
              {getStatusLabel(ticket.status)}
            </Text>
          </View>
        </View>
        <View style={styles.ticketBody}>
          <View style={styles.ticketRow}>
            <Text style={styles.ticketLabel}>{t('admin.userId')}</Text>
            <Text style={styles.ticketValue}>{ticket.userId}</Text>
          </View>
          <View style={styles.ticketRow}>
            <Text style={styles.ticketLabel}>{t('admin.issueType')}</Text>
            <Text style={styles.ticketValue}>{ticket.issueType}</Text>
          </View>
          <View style={styles.ticketRow}>
            <Text style={styles.ticketLabel}>{t('admin.priority')}</Text>
            <View style={[styles.priorityBadge, { backgroundColor: (PRIORITY_COLORS[ticket.priority] || COLORS.textSecondary) + '20' }]}>
              <Text style={[styles.priorityBadgeText, { color: PRIORITY_COLORS[ticket.priority] || COLORS.textSecondary }]}>
                {getPriorityLabel(ticket.priority)}
              </Text>
            </View>
          </View>
          <Text style={styles.ticketMessage} numberOfLines={2}>{ticket.message}</Text>
        </View>
        <View style={styles.ticketFooter}>
          <Text style={styles.ticketDate}>{new Date(ticket.createdAt).toLocaleDateString()}</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
        </View>
      </TouchableOpacity>
    ));
  };

  return (
    <AdminGuard>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('admin.supportTickets')}</Text>
        </View>

        <View style={styles.statusCardsRow}>
          {(['open', 'in_review', 'resolved', 'closed'] as const).map((status) => (
            <View key={status} style={[styles.statusCard, { borderTopColor: STATUS_COLORS[status] }]}>
              <Text style={[styles.statusCardCount, { color: STATUS_COLORS[status] }]}>
                {statusCounts[status]}
              </Text>
              <Text style={styles.statusCardLabel}>{getStatusLabel(status)}</Text>
            </View>
          ))}
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
                <Text style={styles.modalTitle}>{t('admin.ticketDetails')}</Text>
                <TouchableOpacity onPress={() => setDetailModalVisible(false)}>
                  <Ionicons name="close" size={24} color={COLORS.text} />
                </TouchableOpacity>
              </View>

              {selectedTicket && (
                <ScrollView style={styles.modalBody}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('admin.ticketId')}</Text>
                    <Text style={styles.detailValue}>{selectedTicket.ticketId}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('admin.userId')}</Text>
                    <Text style={styles.detailValue}>{selectedTicket.userId}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('admin.status')}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[selectedTicket.status] || COLORS.textSecondary) + '20' }]}>
                      <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[selectedTicket.status] || COLORS.textSecondary }]}>
                        {getStatusLabel(selectedTicket.status)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('admin.issueType')}</Text>
                    <Text style={styles.detailValue}>{selectedTicket.issueType}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('admin.priority')}</Text>
                    <View style={[styles.priorityBadge, { backgroundColor: (PRIORITY_COLORS[selectedTicket.priority] || COLORS.textSecondary) + '20' }]}>
                      <Text style={[styles.priorityBadgeText, { color: PRIORITY_COLORS[selectedTicket.priority] || COLORS.textSecondary }]}>
                        {getPriorityLabel(selectedTicket.priority)}
                      </Text>
                    </View>
                  </View>
                  {selectedTicket.txId && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>{t('admin.relatedTransaction')}</Text>
                      <Text style={styles.detailValue}>{selectedTicket.txId}</Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('admin.userReference')}</Text>
                    <Text style={styles.detailValue}>{selectedTicket.userId}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('admin.createdAt')}</Text>
                    <Text style={styles.detailValue}>{new Date(selectedTicket.createdAt).toLocaleString()}</Text>
                  </View>

                  <View style={styles.messageSection}>
                    <Text style={styles.detailLabel}>{t('admin.message')}</Text>
                    <View style={styles.messageBox}>
                      <Text style={styles.messageText}>{selectedTicket.message}</Text>
                    </View>
                  </View>

                  <View style={styles.actionsSection}>
                    <Text style={styles.actionsTitle}>{t('admin.actions')}</Text>
                    {selectedTicket.status === 'open' && (
                      <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: COLORS.amber }]}
                        disabled={actionLoading}
                        onPress={() => handleStatusUpdate(selectedTicket, 'in_review')}
                      >
                        {actionLoading ? (
                          <ActivityIndicator size="small" color={COLORS.white} />
                        ) : (
                          <>
                            <Ionicons name="eye-outline" size={18} color={COLORS.white} />
                            <Text style={styles.actionButtonText}>{t('admin.setInReview')}</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    )}
                    {(selectedTicket.status === 'open' || selectedTicket.status === 'in_review') && (
                      <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: COLORS.green }]}
                        disabled={actionLoading}
                        onPress={() => handleStatusUpdate(selectedTicket, 'resolved')}
                      >
                        {actionLoading ? (
                          <ActivityIndicator size="small" color={COLORS.white} />
                        ) : (
                          <>
                            <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.white} />
                            <Text style={styles.actionButtonText}>{t('admin.resolveTicket')}</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    )}
                    {selectedTicket.status !== 'closed' && (
                      <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: COLORS.textSecondary }]}
                        disabled={actionLoading}
                        onPress={() => handleStatusUpdate(selectedTicket, 'closed')}
                      >
                        {actionLoading ? (
                          <ActivityIndicator size="small" color={COLORS.white} />
                        ) : (
                          <>
                            <Ionicons name="close-circle-outline" size={18} color={COLORS.white} />
                            <Text style={styles.actionButtonText}>{t('admin.closeTicket')}</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                </ScrollView>
              )}
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
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  statusCardsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  statusCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderTopWidth: 3,
  },
  statusCardCount: {
    fontSize: 22,
    fontWeight: '700',
  },
  statusCardLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
    textAlign: 'center',
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
  ticketCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  ticketId: {
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
  priorityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  priorityBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  ticketBody: {
    gap: 6,
  },
  ticketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ticketLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  ticketValue: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.text,
  },
  ticketMessage: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 8,
    lineHeight: 18,
  },
  ticketFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  ticketDate: {
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
  messageSection: {
    marginTop: 16,
  },
  messageBox: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
  },
  messageText: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
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
});

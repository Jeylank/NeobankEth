import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AdminGuard from '../../components/AdminGuard';
import {
  agentPayoutApi,
  type Agent,
  type AgentAssignment,
  type TransferState,
} from '../../services/agentPayoutService';

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
  purple: '#8B5CF6',
  gray: '#9CA3AF',
};

const STATUS_META: Record<TransferState, { label: string; color: string }> = {
  PAYMENT_PENDING: { label: 'Payment Pending', color: COLORS.gray },
  FUNDS_RECEIVED: { label: 'Funds Received', color: COLORS.blue },
  AGENT_ASSIGNED: { label: 'Assigned', color: COLORS.warning },
  OTP_SENT: { label: 'OTP Sent', color: COLORS.purple },
  READY_FOR_PAYOUT: { label: 'Ready for Payout', color: COLORS.blue },
  PAID_OUT: { label: 'Paid Out', color: COLORS.success },
  COMPLETED: { label: 'Completed', color: COLORS.success },
  FAILED: { label: 'Failed', color: COLORS.error },
  TIMED_OUT: { label: 'Timed Out', color: COLORS.error },
  UNKNOWN: { label: 'Unknown', color: COLORS.gray },
};

function getStatusMeta(status: TransferState): { label: string; color: string } {
  return STATUS_META[status] ?? STATUS_META.UNKNOWN;
}

function AssignmentCard({ assignment, onChanged }: { assignment: AgentAssignment; onChanged: () => void }) {
  const [otpInput, setOtpInput] = useState('');
  const [payoutToken, setPayoutToken] = useState<string | null>(null);
  const [sentOtpPreview, setSentOtpPreview] = useState<string | null>(null);

  const meta = getStatusMeta(assignment.transfer_status);

  const sendOtpMutation = useMutation({
    mutationFn: () => agentPayoutApi.sendOtp(assignment.transfer_id),
    onSuccess: (data) => {
      setSentOtpPreview(data.otp ?? null);
      onChanged();
    },
    onError: (err: any) => {
      Alert.alert('Could not send OTP', err?.response?.data?.message ?? 'Please try again.');
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: () => agentPayoutApi.verifyOtp(assignment.transfer_id, otpInput.trim()),
    onSuccess: (data) => {
      setPayoutToken(data.payout_token);
      onChanged();
    },
    onError: (err: any) => {
      Alert.alert('OTP verification failed', err?.response?.data?.message ?? 'Please check the code and try again.');
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: () => {
      if (!payoutToken) throw new Error('Missing payout token — verify OTP first.');
      return agentPayoutApi.markPaid(assignment.transfer_id, payoutToken);
    },
    onSuccess: () => {
      onChanged();
    },
    onError: (err: any) => {
      Alert.alert('Could not mark as paid', err?.response?.data?.message ?? 'Please try again.');
    },
  });

  const canSendOtp = ['AGENT_ASSIGNED', 'OTP_SENT'].includes(assignment.transfer_status);
  const canVerifyOtp = assignment.transfer_status === 'OTP_SENT';
  const canMarkPaid = assignment.transfer_status === 'READY_FOR_PAYOUT';
  const isTerminal = ['PAID_OUT', 'COMPLETED', 'FAILED', 'TIMED_OUT'].includes(assignment.transfer_status);

  return (
    <View style={styles.card} testID={`assignment-card-${assignment.transfer_id}`}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardLabel}>Transfer</Text>
          <Text style={styles.cardValue}>{assignment.transfer_id}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: meta.color + '20' }]}>
          <Text style={[styles.statusBadgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Amount</Text>
        <Text style={styles.detailValue}>
          {assignment.amount != null ? `${assignment.amount} ${assignment.currency ?? ''}` : '—'}
        </Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Assignment</Text>
        <Text style={styles.detailValue}>{assignment.assignment_status}</Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Updated</Text>
        <Text style={styles.detailValue}>{new Date(assignment.updated_at).toLocaleString()}</Text>
      </View>

      {!isTerminal && (
        <View style={styles.actionsBlock}>
          {canSendOtp && (
            <TouchableOpacity
              style={[styles.actionButton, styles.otpButton]}
              onPress={() => sendOtpMutation.mutate()}
              disabled={sendOtpMutation.isPending}
            >
              {sendOtpMutation.isPending ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="key-outline" size={16} color={COLORS.white} />
                  <Text style={styles.actionButtonText}>
                    {assignment.transfer_status === 'OTP_SENT' ? 'Resend OTP' : 'Send OTP'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {sentOtpPreview && (
            <Text style={styles.otpPreview}>Simulation OTP: {sentOtpPreview}</Text>
          )}

          {canVerifyOtp && !payoutToken && (
            <View style={styles.otpRow}>
              <TextInput
                style={styles.otpInput}
                placeholder="Enter 6-digit OTP"
                keyboardType="number-pad"
                maxLength={6}
                value={otpInput}
                onChangeText={setOtpInput}
                testID={`otp-input-${assignment.transfer_id}`}
              />
              <TouchableOpacity
                style={[styles.actionButton, styles.verifyButton, { opacity: otpInput.length === 6 ? 1 : 0.5 }]}
                onPress={() => verifyOtpMutation.mutate()}
                disabled={otpInput.length !== 6 || verifyOtpMutation.isPending}
              >
                {verifyOtpMutation.isPending ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Text style={styles.actionButtonText}>Verify</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {(canMarkPaid || payoutToken) && (
            <TouchableOpacity
              style={[styles.actionButton, styles.markPaidButton]}
              onPress={() => markPaidMutation.mutate()}
              disabled={markPaidMutation.isPending}
              testID={`mark-paid-${assignment.transfer_id}`}
            >
              {markPaidMutation.isPending ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="checkmark-done-outline" size={16} color={COLORS.white} />
                  <Text style={styles.actionButtonText}>Mark Paid</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function AdminAgentPayoutsContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: agents,
    isLoading: agentsLoading,
    isError: agentsError,
    refetch: refetchAgents,
  } = useQuery({
    queryKey: ['agent-payout-agents'],
    queryFn: () => agentPayoutApi.listAgents(),
  });

  const {
    data: assignments,
    isLoading: assignmentsLoading,
    isError: assignmentsError,
    refetch: refetchAssignments,
  } = useQuery({
    queryKey: ['agent-payout-assignments', selectedAgentId],
    queryFn: () => agentPayoutApi.getAssignments(selectedAgentId as string),
    enabled: !!selectedAgentId,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchAgents(), selectedAgentId ? refetchAssignments() : Promise.resolve()]);
    setRefreshing(false);
  }, [refetchAgents, refetchAssignments, selectedAgentId]);

  const onAssignmentChanged = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['agent-payout-assignments', selectedAgentId] });
  }, [queryClient, selectedAgentId]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="cash-outline" size={24} color={COLORS.primary} />
        <Text style={styles.headerTitle}>{t('admin.agentPayouts', 'Agent Cash Payouts')}</Text>
      </View>

      <View style={styles.agentPickerWrap}>
        {agentsLoading ? (
          <ActivityIndicator size="small" color={COLORS.primary} />
        ) : agentsError ? (
          <Text style={styles.errorText}>Could not load agents.</Text>
        ) : !agents || agents.length === 0 ? (
          <Text style={styles.errorText}>No agents registered yet.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.agentPickerContent}>
            {agents.map((agent: Agent) => (
              <TouchableOpacity
                key={agent.id}
                style={[styles.agentChip, selectedAgentId === agent.id && styles.agentChipActive]}
                onPress={() => setSelectedAgentId(agent.id)}
                testID={`agent-chip-${agent.id}`}
              >
                <View style={[styles.onlineDot, { backgroundColor: agent.status === 'online' ? COLORS.success : COLORS.gray }]} />
                <Text style={[styles.agentChipText, selectedAgentId === agent.id && styles.agentChipTextActive]}>
                  {agent.full_name} · {agent.city}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {!selectedAgentId ? (
          <View style={styles.centerState}>
            <Ionicons name="people-outline" size={48} color={COLORS.textSecondary} />
            <Text style={styles.stateText}>Select an agent to view their assigned payouts.</Text>
          </View>
        ) : assignmentsLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.stateText}>Loading assignments...</Text>
          </View>
        ) : assignmentsError ? (
          <View style={styles.centerState}>
            <Ionicons name="alert-circle" size={48} color={COLORS.error} />
            <Text style={styles.stateText}>Could not load assignments.</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => refetchAssignments()}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !assignments || assignments.length === 0 ? (
          <View style={styles.centerState}>
            <Ionicons name="checkmark-circle-outline" size={48} color={COLORS.success} />
            <Text style={styles.stateText}>No payouts assigned to this agent yet.</Text>
          </View>
        ) : (
          assignments.map((assignment: AgentAssignment) => (
            <AssignmentCard key={assignment.assignment_id} assignment={assignment} onChanged={onAssignmentChanged} />
          ))
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminAgentPayoutsScreen() {
  return (
    <AdminGuard>
      <AdminAgentPayoutsContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
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
  headerTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text, flex: 1 },
  agentPickerWrap: {
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 52,
    justifyContent: 'center',
  },
  agentPickerContent: { gap: 8, alignItems: 'center' },
  agentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.background,
  },
  agentChipActive: { backgroundColor: COLORS.primary },
  agentChipText: { fontSize: 13, fontWeight: '500', color: COLORS.textSecondary },
  agentChipTextActive: { color: COLORS.white },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  errorText: { fontSize: 13, color: COLORS.textSecondary, paddingHorizontal: 4 },
  content: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  centerState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64, gap: 12 },
  stateText: { fontSize: 15, color: COLORS.textSecondary, textAlign: 'center' },
  retryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: { color: COLORS.white, fontSize: 14, fontWeight: '600' },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardLabel: { fontSize: 12, color: COLORS.textSecondary },
  cardValue: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusBadgeText: { fontSize: 12, fontWeight: '600' },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  detailLabel: { fontSize: 13, color: COLORS.textSecondary },
  detailValue: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  actionsBlock: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  otpButton: { backgroundColor: COLORS.purple },
  verifyButton: { backgroundColor: COLORS.blue, paddingHorizontal: 20 },
  markPaidButton: { backgroundColor: COLORS.success },
  actionButtonText: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  otpPreview: { fontSize: 12, color: COLORS.textSecondary, fontStyle: 'italic' },
  otpRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  otpInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: COLORS.background,
  },
});

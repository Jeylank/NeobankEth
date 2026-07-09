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
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AdminGuard from '../../components/AdminGuard';
import { adminService } from '../../services/adminService';

const COLORS = {
  primary:   '#006633',
  white:     '#FFFFFF',
  background:'#F5F5F5',
  text:      '#1F2937',
  textSec:   '#6B7280',
  border:    '#E5E7EB',
  green:     '#10B981',
  red:       '#EF4444',
  amber:     '#F59E0B',
  blue:      '#3B82F6',
  purple:    '#8B5CF6',
  darkRed:   '#DC2626',
  card:      '#FFFFFF',
};

type ActionType = 'freeze' | 'unfreeze' | 'review' | 'active';

interface ConfirmState {
  visible: boolean;
  type: ActionType;
  userId: string;
  displayId: string;
}

const EMPTY_CONFIRM: ConfirmState = {
  visible: false,
  type: 'freeze',
  userId: '',
  displayId: '',
};

const KILL_SWITCH_KEYS = [
  { key: 'remittance_enabled',        labelKey: 'adminRisk.remittance',       icon: 'send-outline' as const,          color: COLORS.primary },
  { key: 'wallet_topup_enabled',      labelKey: 'adminRisk.topup',            icon: 'wallet-outline' as const,        color: COLORS.blue },
  { key: 'recurring_support_enabled', labelKey: 'adminRisk.recurringSupport', icon: 'repeat-outline' as const,        color: COLORS.purple },
  { key: 'fx_marketplace_enabled',    labelKey: 'adminRisk.fxMarketplace',    icon: 'trending-up-outline' as const,   color: '#0891B2' },
  { key: 'campaign_payout_enabled',   labelKey: 'adminRisk.campaigns',        icon: 'megaphone-outline' as const,     color: COLORS.darkRed },
  { key: 'referral_rewards_enabled',  labelKey: 'adminRisk.referralRewards',  icon: 'gift-outline' as const,          color: COLORS.amber },
];

const REASON_META: Record<string, { labelKey: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  limit_exceeded:   { labelKey: 'adminRisk.limitExceeded',      color: COLORS.darkRed, icon: 'ban-outline' },
  velocity_blocked: { labelKey: 'adminRisk.velocityBlocked',    color: COLORS.amber,   icon: 'speedometer-outline' },
  safety_guard:     { labelKey: 'adminRisk.safetyGuard',        color: COLORS.purple,  icon: 'shield-outline' },
  kill_switch:      { labelKey: 'adminRisk.killSwitchBlocked',  color: COLORS.red,     icon: 'power-outline' },
  account_frozen:   { labelKey: 'adminRisk.accountFrozen',      color: COLORS.blue,    icon: 'snow-outline' },
  review_required:  { labelKey: 'adminRisk.reviewRequiredBlock',color: COLORS.amber,   icon: 'eye-outline' },
};

function getFlagLabel(flag: any): string {
  if (flag.isFrozen || flag.isBlocked) return 'frozen';
  if (flag.reviewRequired) return 'review';
  return 'active';
}

function SectionHeader({ title, icon }: { title: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={18} color={COLORS.primary} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.statPill, { borderLeftColor: color }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function AdminRiskControlsContent() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(EMPTY_CONFIRM);
  const [toggleTarget, setToggleTarget] = useState<{ key: string; label: string; toEnabled: boolean } | null>(null);

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ['admin-risk-summary'],
    queryFn: () => adminService.getRiskSummary(),
  });

  const {
    data: metrics,
    isLoading: metricsLoading,
    refetch: refetchMetrics,
  } = useQuery({
    queryKey: ['admin-risk-metrics'],
    queryFn: () => adminService.getRiskBlockedMetrics(),
  });

  const {
    data: flags,
    isLoading: flagsLoading,
    refetch: refetchFlags,
  } = useQuery({
    queryKey: ['admin-risk-flags'],
    queryFn: () => adminService.getRiskFlags(200),
  });

  const {
    data: riskQueue,
    isLoading: riskQueueLoading,
    refetch: refetchRiskQueue,
  } = useQuery({
    queryKey: ['admin-risk-queue'],
    queryFn: () => adminService.getRiskQueue(100),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-risk-summary'] });
    queryClient.invalidateQueries({ queryKey: ['admin-risk-metrics'] });
    queryClient.invalidateQueries({ queryKey: ['admin-risk-flags'] });
    queryClient.invalidateQueries({ queryKey: ['admin-risk-queue'] });
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchSummary(), refetchMetrics(), refetchFlags(), refetchRiskQueue()]);
    setRefreshing(false);
  }, [refetchSummary, refetchMetrics, refetchFlags, refetchRiskQueue]);

  const toggleMutation = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      adminService.toggleKillSwitch(key, enabled),
    onSuccess: () => {
      invalidateAll();
      setToggleTarget(null);
    },
    onError: () => {
      setToggleTarget(null);
      Alert.alert(t('admin.error'), t('adminRisk.actionError'));
    },
  });

  const freezeMutation = useMutation({
    mutationFn: (uid: string) => adminService.freezeRiskUser(uid),
    onSuccess: () => { invalidateAll(); setConfirm(EMPTY_CONFIRM); },
    onError: () => Alert.alert(t('admin.error'), t('admin.adminRisk.actionError')),
  });

  const unfreezeMutation = useMutation({
    mutationFn: (uid: string) => adminService.unfreezeRiskUser(uid),
    onSuccess: () => { invalidateAll(); setConfirm(EMPTY_CONFIRM); },
    onError: () => Alert.alert(t('admin.error'), t('admin.adminRisk.actionError')),
  });

  const reviewMutation = useMutation({
    mutationFn: (uid: string) => adminService.markRiskUserReview(uid),
    onSuccess: () => { invalidateAll(); setConfirm(EMPTY_CONFIRM); },
    onError: () => Alert.alert(t('admin.error'), t('admin.adminRisk.actionError')),
  });

  const activeMutation = useMutation({
    mutationFn: (uid: string) => adminService.restoreRiskUserActive(uid),
    onSuccess: () => { invalidateAll(); setConfirm(EMPTY_CONFIRM); },
    onError: () => Alert.alert(t('admin.error'), t('admin.adminRisk.actionError')),
  });

  const handleConfirmAction = () => {
    const { type, userId } = confirm;
    if (type === 'freeze') freezeMutation.mutate(userId);
    else if (type === 'unfreeze') unfreezeMutation.mutate(userId);
    else if (type === 'review') reviewMutation.mutate(userId);
    else if (type === 'active') activeMutation.mutate(userId);
  };

  const isActionPending =
    freezeMutation.isPending || unfreezeMutation.isPending ||
    reviewMutation.isPending || activeMutation.isPending;

  const getConfirmMessage = () => {
    switch (confirm.type) {
      case 'freeze':   return t('admin.adminRisk.confirmFreeze');
      case 'unfreeze': return t('admin.adminRisk.confirmUnfreeze');
      case 'review':   return t('admin.adminRisk.confirmMarkReview');
      case 'active':   return t('admin.adminRisk.confirmRestoreActive');
    }
  };

  const getConfirmTitle = () => {
    switch (confirm.type) {
      case 'freeze':   return t('admin.adminRisk.freezeUser');
      case 'unfreeze': return t('admin.adminRisk.unfreezeUser');
      case 'review':   return t('admin.adminRisk.markReview');
      case 'active':   return t('admin.adminRisk.restoreActive');
    }
  };

  const systemControls: Record<string, boolean> = summary?.systemControls ?? {};
  const userStats = summary?.users ?? { frozen: 0, inReview: 0 };
  const todayStats = summary?.today ?? {};

  const flagList: any[] = flags ?? [];
  const frozenList  = flagList.filter((f) => f.isFrozen || f.isBlocked);
  const reviewList  = flagList.filter((f) => f.reviewRequired && !f.isFrozen && !f.isBlocked);
  const queueList   = [...frozenList, ...reviewList];

  const isLoading = summaryLoading || metricsLoading || flagsLoading;

  const kycPendingList: any[] = riskQueue?.kycPending ?? [];
  const fraudReviewList: any[] = riskQueue?.fraudReview ?? [];

  const formatQueueDate = (value: any): string => {
    if (!value) return '—';
    const millis = value?.seconds ? value.seconds * 1000 : value?._seconds ? value._seconds * 1000 : value;
    const d = new Date(millis);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  };

  const shortenId = (id: string): string =>
    id.length > 14 ? id.slice(0, 7) + '…' + id.slice(-5) : id;

  const renderKycPendingRow = (item: any) => (
    <View key={item.userId} style={styles.queueRow}>
      <View style={styles.queueLeft}>
        <View style={[styles.flagBadge, { backgroundColor: COLORS.amber + '20' }]}>
          <Text style={[styles.flagBadgeText, { color: COLORS.amber }]}>{t('admin.adminRisk.kycPending')}</Text>
        </View>
        <View>
          <Text style={styles.queueUid}>{shortenId(item.userId)}</Text>
          <Text style={styles.queueDate}>
            {item.documentType ? `${t('admin.adminRisk.documentType')}: ${item.documentType} · ` : ''}
            {formatQueueDate(item.submittedAt)}
          </Text>
        </View>
      </View>
    </View>
  );

  const renderFraudReviewRow = (item: any) => (
    <View key={item.decisionId} style={styles.queueRow}>
      <View style={styles.queueLeft}>
        <View style={[styles.flagBadge, { backgroundColor: COLORS.purple + '20' }]}>
          <Text style={[styles.flagBadgeText, { color: COLORS.purple }]}>{t('admin.adminRisk.fraudReview')}</Text>
        </View>
        <View>
          <Text style={styles.queueUid}>{shortenId(item.userId ?? '—')}</Text>
          <Text style={styles.queueDate}>
            {t('admin.adminRisk.score')}: {item.score} · {t('admin.adminRisk.amount')}: {item.amount} {item.currency ?? ''} · {formatQueueDate(item.timestamp)}
          </Text>
        </View>
      </View>
    </View>
  );

  const renderKillSwitch = ({ key, labelKey, icon, color }: typeof KILL_SWITCH_KEYS[0]) => {
    const enabled = systemControls[key] !== false;
    return (
      <View key={key} style={styles.switchRow}>
        <View style={[styles.switchIcon, { backgroundColor: enabled ? color + '20' : '#F3F4F6' }]}>
          <Ionicons name={icon} size={18} color={enabled ? color : COLORS.textSec} />
        </View>
        <Text style={styles.switchLabel}>{t(labelKey)}</Text>
        <View style={styles.switchRight}>
          <Text style={[styles.switchStatus, { color: enabled ? COLORS.green : COLORS.red }]}>
            {enabled ? t('admin.adminRisk.enabled') : t('admin.adminRisk.disabled')}
          </Text>
          <Switch
            value={enabled}
            onValueChange={(val) => {
              setToggleTarget({ key, label: t(labelKey), toEnabled: val });
            }}
            trackColor={{ false: '#D1D5DB', true: COLORS.green + '80' }}
            thumbColor={enabled ? COLORS.green : '#9CA3AF'}
          />
        </View>
      </View>
    );
  };

  const renderReasonRow = (reasonKey: string, todayCount: number, weekCount: number) => {
    const meta = REASON_META[reasonKey];
    if (!meta) return null;
    return (
      <View key={reasonKey} style={styles.reasonRow}>
        <View style={styles.reasonLeft}>
          <Ionicons name={meta.icon} size={14} color={meta.color} />
          <Text style={styles.reasonLabel}>{t(meta.labelKey)}</Text>
        </View>
        <View style={styles.reasonCounts}>
          <Text style={[styles.reasonCount, { color: meta.color }]}>{todayCount}</Text>
          <Text style={styles.reasonSep}>·</Text>
          <Text style={[styles.reasonCountWk, { color: COLORS.textSec }]}>{weekCount}</Text>
        </View>
      </View>
    );
  };

  const renderFlaggedUser = (flag: any) => {
    const status = getFlagLabel(flag);
    const statusColor = status === 'frozen' ? COLORS.blue : COLORS.amber;
    const uid: string = flag.userId ?? flag.uid ?? '—';
    const shortId = uid.length > 14 ? uid.slice(0, 7) + '…' + uid.slice(-5) : uid;
    const updatedAt: string = flag.updatedAt
      ? new Date(flag.updatedAt?.seconds ? flag.updatedAt.seconds * 1000 : flag.updatedAt).toLocaleDateString()
      : '—';

    return (
      <View key={uid} style={styles.queueRow}>
        <View style={styles.queueLeft}>
          <View style={[styles.flagBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.flagBadgeText, { color: statusColor }]}>{status.toUpperCase()}</Text>
          </View>
          <View>
            <Text style={styles.queueUid}>{shortId}</Text>
            <Text style={styles.queueDate}>{updatedAt}</Text>
          </View>
        </View>
        <View style={styles.queueActions}>
          {(status === 'frozen') && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#ECFDF5' }]}
              onPress={() => setConfirm({ visible: true, type: 'unfreeze', userId: uid, displayId: shortId })}
            >
              <Ionicons name="checkmark-circle-outline" size={14} color={COLORS.green} />
            </TouchableOpacity>
          )}
          {(status === 'review') && (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#FEF2F2' }]}
                onPress={() => setConfirm({ visible: true, type: 'freeze', userId: uid, displayId: shortId })}
              >
                <Ionicons name="snow-outline" size={14} color={COLORS.blue} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#ECFDF5' }]}
                onPress={() => setConfirm({ visible: true, type: 'active', userId: uid, displayId: shortId })}
              >
                <Ionicons name="checkmark-circle-outline" size={14} color={COLORS.green} />
              </TouchableOpacity>
            </>
          )}
          {(status === 'active') && (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#EFF6FF' }]}
                onPress={() => setConfirm({ visible: true, type: 'review', userId: uid, displayId: shortId })}
              >
                <Ionicons name="eye-outline" size={14} color={COLORS.blue} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#FEF2F2' }]}
                onPress={() => setConfirm({ visible: true, type: 'freeze', userId: uid, displayId: shortId })}
              >
                <Ionicons name="snow-outline" size={14} color={COLORS.darkRed} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Ionicons name="shield-half-outline" size={22} color={COLORS.white} />
          <Text style={styles.headerTitle}>{t('admin.adminRisk.title')}</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {isLoading && !refreshing ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>{t('admin.loading')}</Text>
        </View>
      ) : summaryError ? (
        <View style={styles.loadingBox}>
          <Ionicons name="alert-circle-outline" size={40} color={COLORS.red} />
          <Text style={styles.errorText}>{t('admin.error')}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => refetchSummary()}>
            <Text style={styles.retryText}>{t('admin.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Kill Switches ─────────────────────────────── */}
          <View style={styles.card}>
            <SectionHeader title={t('admin.adminRisk.killSwitches')} icon="toggle-outline" />
            <Text style={styles.cardSubtitle}>{t('admin.adminRisk.killSwitchDesc')}</Text>
            {KILL_SWITCH_KEYS.map(renderKillSwitch)}
          </View>

          {/* ── Blocked Metrics ───────────────────────────── */}
          <View style={styles.card}>
            <SectionHeader title={t('admin.adminRisk.blockedMetrics')} icon="analytics-outline" />
            <View style={styles.pillRow}>
              <StatPill
                label={t('admin.adminRisk.blockedToday')}
                value={metrics?.today?.total ?? todayStats.blockedTransactions ?? 0}
                color={COLORS.darkRed}
              />
              <StatPill
                label={t('admin.adminRisk.blockedThisWeek')}
                value={metrics?.week?.total ?? 0}
                color={COLORS.amber}
              />
            </View>

            <Text style={styles.reasonHeader}>{t('admin.adminRisk.byReason')}</Text>
            <View style={styles.reasonHeaderRow}>
              <Text style={styles.reasonHeaderLabel} />
              <View style={styles.reasonCounts}>
                <Text style={styles.reasonHeaderCount}>{t('admin.today')}</Text>
                <Text style={styles.reasonSep}>·</Text>
                <Text style={styles.reasonHeaderCount}>7d</Text>
              </View>
            </View>
            {Object.keys(REASON_META).map((k) =>
              renderReasonRow(
                k,
                metrics?.today?.byReason?.[k] ?? 0,
                metrics?.week?.byReason?.[k] ?? 0,
              )
            )}
          </View>

          {/* ── User Status ───────────────────────────────── */}
          <View style={styles.card}>
            <SectionHeader title={t('admin.adminRisk.userStatus')} icon="people-outline" />
            <View style={styles.pillRow}>
              <StatPill
                label={t('admin.adminRisk.frozenUsers')}
                value={userStats.frozen}
                color={COLORS.blue}
              />
              <StatPill
                label={t('admin.adminRisk.reviewUsers')}
                value={userStats.inReview}
                color={COLORS.amber}
              />
              <StatPill
                label={t('admin.adminRisk.active')}
                value={Math.max(0, (flagList.length) - userStats.frozen - userStats.inReview)}
                color={COLORS.green}
              />
            </View>
          </View>

          {/* ── Closed-Beta Readiness Queue (KYC + Fraud REVIEW) ──── */}
          <View style={styles.card}>
            <SectionHeader title={t('admin.adminRisk.betaReadinessQueue')} icon="checkmark-done-outline" />
            <Text style={styles.cardSubtitle}>{t('admin.adminRisk.betaReadinessDesc')}</Text>
            {riskQueueLoading ? (
              <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 12 }} />
            ) : kycPendingList.length === 0 && fraudReviewList.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="checkmark-circle-outline" size={32} color={COLORS.green} />
                <Text style={styles.emptyText}>{t('admin.adminRisk.noBetaQueue')}</Text>
              </View>
            ) : (
              <>
                {kycPendingList.map(renderKycPendingRow)}
                {fraudReviewList.map(renderFraudReviewRow)}
              </>
            )}
          </View>

          {/* ── Review Queue ──────────────────────────────── */}
          <View style={styles.card}>
            <SectionHeader title={t('admin.adminRisk.reviewQueue')} icon="list-outline" />
            {queueList.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="checkmark-circle-outline" size={32} color={COLORS.green} />
                <Text style={styles.emptyText}>{t('admin.adminRisk.noQueue')}</Text>
              </View>
            ) : (
              <>
                <View style={styles.queueHeaderRow}>
                  <Text style={[styles.queueHeaderCell, { flex: 2 }]}>{t('admin.adminRisk.userId')}</Text>
                  <Text style={[styles.queueHeaderCell, { flex: 1 }]}>{t('admin.adminRisk.flag')}</Text>
                  <Text style={[styles.queueHeaderCell, { flex: 1, textAlign: 'right' }]}>{t('admin.actions')}</Text>
                </View>
                {queueList.map(renderFlaggedUser)}
              </>
            )}
            <View style={styles.auditNote}>
              <Ionicons name="document-text-outline" size={12} color={COLORS.textSec} />
              <Text style={styles.auditNoteText}>{t('admin.adminRisk.auditTrail')}</Text>
            </View>
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      {/* ── Kill Switch Toggle Confirm Modal ────────────── */}
      <Modal visible={!!toggleTarget} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Ionicons
              name={toggleTarget?.toEnabled ? 'checkmark-circle-outline' : 'power-outline'}
              size={36}
              color={toggleTarget?.toEnabled ? COLORS.green : COLORS.darkRed}
            />
            <Text style={styles.modalTitle}>{t('admin.adminRisk.toggleConfirm')}</Text>
            <Text style={styles.modalMsg}>
              {t('admin.adminRisk.toggleConfirmMsg', {
                action: toggleTarget?.toEnabled ? t('admin.adminRisk.enable') : t('admin.adminRisk.disable'),
                feature: toggleTarget?.label ?? '',
              })}
            </Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setToggleTarget(null)}
              >
                <Text style={styles.cancelBtnText}>{t('admin.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: toggleTarget?.toEnabled ? COLORS.green : COLORS.darkRed }]}
                onPress={() => {
                  if (toggleTarget) {
                    toggleMutation.mutate({ key: toggleTarget.key, enabled: toggleTarget.toEnabled });
                  }
                }}
                disabled={toggleMutation.isPending}
              >
                {toggleMutation.isPending
                  ? <ActivityIndicator size="small" color={COLORS.white} />
                  : <Text style={styles.confirmBtnText}>{t('admin.confirm')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── User Action Confirm Modal ────────────────────── */}
      <Modal visible={confirm.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Ionicons
              name={
                confirm.type === 'freeze' ? 'snow-outline' :
                confirm.type === 'unfreeze' ? 'checkmark-circle-outline' :
                confirm.type === 'review' ? 'eye-outline' : 'person-outline'
              }
              size={36}
              color={
                confirm.type === 'freeze' ? COLORS.blue :
                confirm.type === 'unfreeze' ? COLORS.green :
                confirm.type === 'review' ? COLORS.amber : COLORS.green
              }
            />
            <Text style={styles.modalTitle}>{getConfirmTitle()}</Text>
            <Text style={styles.modalUserId}>{confirm.displayId}</Text>
            <Text style={styles.modalMsg}>{getConfirmMessage()}</Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setConfirm(EMPTY_CONFIRM)}
                disabled={isActionPending}
              >
                <Text style={styles.cancelBtnText}>{t('admin.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, {
                  backgroundColor:
                    confirm.type === 'freeze' ? COLORS.blue :
                    confirm.type === 'unfreeze' ? COLORS.green :
                    confirm.type === 'review' ? COLORS.amber : COLORS.green,
                }]}
                onPress={handleConfirmAction}
                disabled={isActionPending}
              >
                {isActionPending
                  ? <ActivityIndicator size="small" color={COLORS.white} />
                  : <Text style={styles.confirmBtnText}>{t('admin.confirm')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default function AdminRiskControlsScreen() {
  return (
    <AdminGuard>
      <AdminRiskControlsContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: { width: 40, alignItems: 'flex-start' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { color: COLORS.white, fontSize: 17, fontWeight: '700' },

  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: COLORS.textSec, fontSize: 14 },
  errorText: { color: COLORS.red, fontSize: 15, fontWeight: '600' },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 8, backgroundColor: COLORS.primary, borderRadius: 8 },
  retryText: { color: COLORS.white, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 14 },

  card: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  cardSubtitle: { fontSize: 12, color: COLORS.textSec, marginTop: -6 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  switchIcon: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  switchLabel: { flex: 1, fontSize: 14, color: COLORS.text, fontWeight: '500' },
  switchRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchStatus: { fontSize: 12, fontWeight: '600', minWidth: 54, textAlign: 'right' },

  pillRow: { flexDirection: 'row', gap: 10 },
  statPill: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    alignItems: 'center',
  },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 11, color: COLORS.textSec, textAlign: 'center', marginTop: 2 },

  reasonHeader: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: -4 },
  reasonHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  reasonHeaderLabel: { flex: 2 },
  reasonHeaderCount: { fontSize: 11, color: COLORS.textSec, fontWeight: '600', minWidth: 24, textAlign: 'center' },
  reasonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  reasonLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 2 },
  reasonLabel: { fontSize: 13, color: COLORS.text },
  reasonCounts: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reasonCount: { fontSize: 14, fontWeight: '700', minWidth: 24, textAlign: 'center' },
  reasonSep: { color: COLORS.textSec, fontSize: 12 },
  reasonCountWk: { fontSize: 13, fontWeight: '500', minWidth: 24, textAlign: 'center' },

  queueHeaderRow: {
    flexDirection: 'row',
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  queueHeaderCell: { fontSize: 11, fontWeight: '700', color: COLORS.textSec, textTransform: 'uppercase' },

  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  queueLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  flagBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  flagBadgeText: { fontSize: 10, fontWeight: '800' },
  queueUid: { fontSize: 13, fontWeight: '600', color: COLORS.text, fontFamily: 'monospace' },
  queueDate: { fontSize: 11, color: COLORS.textSec },
  queueActions: { flexDirection: 'row', gap: 6 },
  actionBtn: {
    width: 30, height: 30, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
  },

  emptyBox: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  emptyText: { color: COLORS.textSec, fontSize: 14 },

  auditNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  auditNoteText: { fontSize: 11, color: COLORS.textSec, fontStyle: 'italic', flex: 1 },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: COLORS.white, borderRadius: 16,
    padding: 24, width: '100%', maxWidth: 360,
    alignItems: 'center', gap: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text, textAlign: 'center' },
  modalUserId: { fontSize: 12, color: COLORS.textSec, fontFamily: 'monospace', textAlign: 'center' },
  modalMsg: { fontSize: 14, color: COLORS.textSec, textAlign: 'center', lineHeight: 20 },
  modalBtns: { flexDirection: 'row', gap: 12, width: '100%', marginTop: 4 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  cancelBtn: { backgroundColor: '#F3F4F6' },
  cancelBtnText: { color: COLORS.text, fontWeight: '600', fontSize: 14 },
  confirmBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 14 },
});

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { recurringSupportService, calculateNextPayoutDate } from '../services/firestoreRecurringSupport';
import { useAuth } from '../hooks/useAuth';
import type { RecurringSchedule, ScheduleExecution, ScheduleFrequency, ScheduleStatus } from '../types';

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
  amber: '#F59E0B',
  purple: '#8B5CF6',
  cyan: '#06B6D4',
  orange: '#F97316',
};

const RELATIONSHIP_VALUES = ['mother', 'father', 'brother', 'sister', 'spouse', 'other'] as const;
const FREQUENCY_VALUES: ScheduleFrequency[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'semester'];
const CURRENCY_VALUES: RecurringSchedule['currency'][] = ['EUR', 'USD', 'GBP'];
const PAYOUT_METHOD_VALUES: RecurringSchedule['payoutMethod'][] = ['telebirr', 'direct_transfer', 'cash_pickup'];

const RELATIONSHIP_I18N: Record<string, string> = {
  mother: 'familyWallet.mother',
  father: 'familyWallet.father',
  brother: 'familyWallet.brother',
  sister: 'familyWallet.sister',
  spouse: 'familyWallet.spouse',
  other: 'familyWallet.other',
};

const FREQUENCY_I18N: Record<ScheduleFrequency, string> = {
  weekly: 'recurringSupport.weekly',
  biweekly: 'recurringSupport.biweekly',
  monthly: 'recurringSupport.monthly',
  quarterly: 'recurringSupport.quarterly',
  semester: 'recurringSupport.semester',
};

const PAYOUT_METHOD_I18N: Record<RecurringSchedule['payoutMethod'], string> = {
  telebirr: 'familyWallet.telebirr',
  direct_transfer: 'familyWallet.directTransfer',
  cash_pickup: 'familyWallet.cashPickup',
};

const STATUS_COLORS: Record<ScheduleStatus, string> = {
  active: COLORS.success,
  paused: COLORS.amber,
  cancelled: COLORS.error,
};

const EXEC_STATUS_ICONS: Record<ScheduleExecution['status'], { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  queued: { icon: 'time-outline', color: COLORS.amber },
  processing: { icon: 'sync-outline', color: COLORS.blue },
  sent: { icon: 'checkmark-circle', color: COLORS.success },
  failed: { icon: 'close-circle', color: COLORS.error },
};

export default function RecurringSupportScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.uid ?? '';

  const [schedules, setSchedules] = useState<RecurringSchedule[]>([]);
  const [executions, setExecutions] = useState<ScheduleExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<RecurringSchedule | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [formMemberName, setFormMemberName] = useState('');
  const [formRelationship, setFormRelationship] = useState<string>('mother');
  const [formAmount, setFormAmount] = useState('');
  const [formCurrency, setFormCurrency] = useState<RecurringSchedule['currency']>('EUR');
  const [formFrequency, setFormFrequency] = useState<ScheduleFrequency>('monthly');
  const [formPayoutMethod, setFormPayoutMethod] = useState<RecurringSchedule['payoutMethod']>('telebirr');
  const [formNote, setFormNote] = useState('');

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [schedulesData, executionsData] = await Promise.all([
        recurringSupportService.getSchedules(userId),
        recurringSupportService.getExecutionHistory(userId),
      ]);
      setSchedules(schedulesData);
      setExecutions(executionsData);
    } catch (err) {
      console.error('Failed to load recurring support data:', err);
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

  const activeSchedules = schedules.filter((s) => s.status === 'active');
  const totalMonthlyCommitment = activeSchedules.reduce((sum, s) => {
    switch (s.frequency) {
      case 'weekly': return sum + s.amount * 4.33;
      case 'biweekly': return sum + s.amount * 2.17;
      case 'monthly': return sum + s.amount;
      case 'quarterly': return sum + s.amount / 3;
      case 'semester': return sum + s.amount / 6;
      default: return sum + s.amount;
    }
  }, 0);

  const nextPayoutDate = activeSchedules.length > 0
    ? activeSchedules.reduce((earliest, s) => {
        const d = new Date(s.nextPayoutDate);
        return d < earliest ? d : earliest;
      }, new Date(activeSchedules[0].nextPayoutDate))
    : null;

  const resetForm = () => {
    setFormMemberName('');
    setFormRelationship('mother');
    setFormAmount('');
    setFormCurrency('EUR');
    setFormFrequency('monthly');
    setFormPayoutMethod('telebirr');
    setFormNote('');
    setEditingSchedule(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (schedule: RecurringSchedule) => {
    setEditingSchedule(schedule);
    setFormMemberName(schedule.memberName);
    setFormRelationship(schedule.relationship);
    setFormAmount(schedule.amount.toString());
    setFormCurrency(schedule.currency);
    setFormFrequency(schedule.frequency);
    setFormPayoutMethod(schedule.payoutMethod);
    setFormNote(schedule.note || '');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formMemberName.trim() || !formAmount.trim()) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }
    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }

    try {
      if (editingSchedule) {
        await recurringSupportService.updateSchedule(userId, editingSchedule.id, {
          memberName: formMemberName.trim(),
          relationship: formRelationship,
          amount,
          currency: formCurrency,
          frequency: formFrequency,
          payoutMethod: formPayoutMethod,
          note: formNote.trim() || undefined,
        });
        Alert.alert(t('common.success'), t('recurringSupport.scheduleUpdated'));
      } else {
        const now = new Date();
        const nextPayout = calculateNextPayoutDate(formFrequency, now.toISOString());
        await recurringSupportService.createSchedule(userId, {
          userId,
          memberId: `member_${userId}_${formMemberName.trim().toLowerCase().replace(/\s+/g, '_')}`,
          memberName: formMemberName.trim(),
          relationship: formRelationship,
          amount,
          currency: formCurrency,
          frequency: formFrequency,
          payoutMethod: formPayoutMethod,
          nextPayoutDate: nextPayout,
          status: 'active',
          note: formNote.trim() || undefined,
        });
        Alert.alert(t('common.success'), t('recurringSupport.scheduleCreated'));
      }
      setShowModal(false);
      resetForm();
      await loadData();
    } catch (err) {
      Alert.alert(t('common.error'), t('common.error'));
    }
  };

  const handlePauseResume = async (schedule: RecurringSchedule) => {
    try {
      if (schedule.status === 'active') {
        await recurringSupportService.pauseSchedule(userId, schedule.id);
        Alert.alert(t('common.success'), t('recurringSupport.pauseSuccess'));
      } else {
        await recurringSupportService.resumeSchedule(userId, schedule.id);
        Alert.alert(t('common.success'), t('recurringSupport.resumeSuccess'));
      }
      await loadData();
    } catch (err) {
      Alert.alert(t('common.error'), t('common.error'));
    }
  };

  const handleCancel = (schedule: RecurringSchedule) => {
    Alert.alert(
      t('recurringSupport.confirmCancel'),
      t('recurringSupport.cancelMsg', { name: schedule.memberName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('recurringSupport.cancel'),
          style: 'destructive',
          onPress: async () => {
            try {
              await recurringSupportService.cancelSchedule(userId, schedule.id);
              Alert.alert(t('common.success'), t('recurringSupport.cancelSuccess'));
              await loadData();
            } catch (err) {
              Alert.alert(t('common.error'), t('common.error'));
            }
          },
        },
      ]
    );
  };

  const handleProcessNow = async () => {
    setProcessing(true);
    try {
      const results = await recurringSupportService.processDueSchedules(userId);
      const sentCount = results.filter((r) => r.status === 'sent').length;
      const failedCount = results.filter((r) => r.status === 'failed').length;
      Alert.alert(
        t('recurringSupport.processComplete'),
        t('recurringSupport.processResult', { sent: sentCount, failed: failedCount, total: results.length })
      );
      await loadData();
    } catch (err) {
      Alert.alert(t('common.error'), t('common.error'));
    } finally {
      setProcessing(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Ionicons name="cloud-offline-outline" size={48} color={COLORS.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setLoading(true);
              setError(null);
              loadData();
            }}
          >
            <Ionicons name="refresh" size={18} color={COLORS.white} />
            <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="repeat-outline" size={64} color={COLORS.textSecondary} />
      </View>
      <Text style={styles.emptyTitle}>{t('recurringSupport.noSchedules')}</Text>
      <Text style={styles.emptyMessage}>{t('recurringSupport.emptyMessage')}</Text>
      <TouchableOpacity style={styles.emptyAddButton} onPress={openAddModal}>
        <Ionicons name="add-circle" size={22} color={COLORS.white} />
        <Text style={styles.emptyAddButtonText}>{t('recurringSupport.addSchedule')}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderScheduleCard = (schedule: RecurringSchedule) => {
    const statusColor = STATUS_COLORS[schedule.status];
    const canToggle = schedule.status === 'active' || schedule.status === 'paused';

    return (
      <View key={schedule.id} style={styles.scheduleCard}>
        <View style={styles.cardHeader}>
          <View style={styles.memberAvatar}>
            <Ionicons name="person" size={24} color={COLORS.primary} />
          </View>
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>{schedule.memberName}</Text>
            <Text style={styles.memberRelationship}>
              {t(RELATIONSHIP_I18N[schedule.relationship] || schedule.relationship)}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {t(`recurringSupport.${schedule.status}`)}
            </Text>
          </View>
        </View>

        <View style={styles.cardDetails}>
          <View style={styles.detailRow}>
            <Ionicons name="cash-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.detailText}>
              {schedule.currency} {schedule.amount}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="repeat-outline" size={16} color={COLORS.textSecondary} />
            <View style={styles.frequencyBadge}>
              <Text style={styles.frequencyBadgeText}>
                {t(FREQUENCY_I18N[schedule.frequency])}
              </Text>
            </View>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="calendar-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.detailText}>
              {t('recurringSupport.nextPayout')}: {formatDate(schedule.nextPayoutDate)}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="send-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.detailText}>
              {t(PAYOUT_METHOD_I18N[schedule.payoutMethod])}
            </Text>
          </View>
          {schedule.lastPayoutDate && (
            <View style={styles.detailRow}>
              <Ionicons
                name={schedule.lastPayoutStatus === 'sent' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                size={16}
                color={schedule.lastPayoutStatus === 'sent' ? COLORS.success : COLORS.error}
              />
              <Text style={styles.detailText}>
                {t('recurringSupport.lastPayout')}: {formatDate(schedule.lastPayoutDate)}
              </Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Ionicons name="stats-chart-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.detailText}>
              {t('recurringSupport.totalSent')}: {schedule.totalSent} / {t('recurringSupport.totalPayouts')}: {schedule.totalPayouts}
            </Text>
          </View>
        </View>

        <View style={styles.cardActions}>
          {canToggle && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => handlePauseResume(schedule)}
            >
              <Ionicons
                name={schedule.status === 'active' ? 'pause-outline' : 'play-outline'}
                size={18}
                color={COLORS.amber}
              />
              <Text style={[styles.actionButtonText, { color: COLORS.amber }]}>
                {schedule.status === 'active' ? t('recurringSupport.pause') : t('recurringSupport.resume')}
              </Text>
            </TouchableOpacity>
          )}
          {schedule.status !== 'cancelled' && (
            <>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => openEditModal(schedule)}
              >
                <Ionicons name="create-outline" size={18} color={COLORS.primary} />
                <Text style={styles.actionButtonText}>{t('recurringSupport.edit')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleCancel(schedule)}
              >
                <Ionicons name="trash-outline" size={18} color={COLORS.error} />
                <Text style={[styles.actionButtonText, { color: COLORS.error }]}>
                  {t('recurringSupport.cancel')}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  };

  const renderExecutionHistory = () => {
    if (executions.length === 0) {
      return (
        <View style={styles.emptyHistoryContainer}>
          <Text style={styles.emptyHistoryText}>{t('recurringSupport.noExecutions')}</Text>
        </View>
      );
    }

    return executions.slice(0, 10).map((exec) => {
      const statusInfo = EXEC_STATUS_ICONS[exec.status];
      return (
        <View key={exec.id} style={styles.executionRow}>
          <Ionicons name={statusInfo.icon} size={20} color={statusInfo.color} />
          <View style={styles.executionInfo}>
            <Text style={styles.executionName}>{exec.memberName}</Text>
            <Text style={styles.executionDate}>{formatDate(exec.executedAt)}</Text>
          </View>
          <View style={styles.executionRight}>
            <Text style={styles.executionAmount}>
              {exec.currency} {exec.amount}
            </Text>
            <Text style={[styles.executionStatus, { color: statusInfo.color }]}>
              {t(`recurringSupport.${exec.status}`)}
            </Text>
          </View>
        </View>
      );
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('recurringSupport.title')}</Text>
          <Text style={styles.subtitle}>{t('recurringSupport.subtitle')}</Text>
        </View>

        {schedules.length === 0 ? (
          renderEmptyState()
        ) : (
          <>
            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, { backgroundColor: '#ECFDF5' }]}>
                <Ionicons name="cash-outline" size={24} color={COLORS.success} />
                <Text style={[styles.summaryValue, { color: COLORS.success }]}>
                  €{Math.round(totalMonthlyCommitment)}
                </Text>
                <Text style={styles.summaryLabel}>{t('recurringSupport.monthlyCommitment')}</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: '#EFF6FF' }]}>
                <Ionicons name="repeat-outline" size={24} color={COLORS.blue} />
                <Text style={[styles.summaryValue, { color: COLORS.blue }]}>
                  {activeSchedules.length}
                </Text>
                <Text style={styles.summaryLabel}>{t('recurringSupport.activeSchedules')}</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: '#FFFBEB' }]}>
                <Ionicons name="calendar-outline" size={24} color={COLORS.amber} />
                <Text style={[styles.summaryValue, { color: COLORS.amber }]} numberOfLines={1}>
                  {nextPayoutDate ? formatDate(nextPayoutDate.toISOString()) : 'N/A'}
                </Text>
                <Text style={styles.summaryLabel}>{t('recurringSupport.nextPayoutDue')}</Text>
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('recurringSupport.title')}</Text>
                <TouchableOpacity style={styles.addButton} onPress={openAddModal}>
                  <Ionicons name="add" size={20} color={COLORS.white} />
                  <Text style={styles.addButtonText}>{t('recurringSupport.addSchedule')}</Text>
                </TouchableOpacity>
              </View>
              {schedules.map(renderScheduleCard)}
            </View>

            <TouchableOpacity
              style={[styles.processButton, processing && styles.processButtonDisabled]}
              onPress={handleProcessNow}
              disabled={processing}
            >
              {processing ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Ionicons name="play-circle" size={22} color={COLORS.white} />
              )}
              <Text style={styles.processButtonText}>
                {processing ? t('recurringSupport.processing') : t('recurringSupport.processNow')}
              </Text>
            </TouchableOpacity>

            <View style={styles.section}>
              <TouchableOpacity
                style={styles.historyHeader}
                onPress={() => setShowHistory(!showHistory)}
              >
                <Text style={styles.sectionTitle}>{t('recurringSupport.executionHistory')}</Text>
                <Ionicons
                  name={showHistory ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={COLORS.textSecondary}
                />
              </TouchableOpacity>
              {showHistory && (
                <View style={styles.historyContainer}>
                  {renderExecutionHistory()}
                </View>
              )}
            </View>
          </>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>

      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setShowModal(false);
          resetForm();
        }}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                setShowModal(false);
                resetForm();
              }}
            >
              <Ionicons name="close" size={28} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editingSchedule ? t('recurringSupport.editSchedule') : t('recurringSupport.addSchedule')}
            </Text>
            <View style={{ width: 28 }} />
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('recurringSupport.memberName')} *</Text>
              <TextInput
                style={styles.formInput}
                value={formMemberName}
                onChangeText={setFormMemberName}
                placeholder={t('recurringSupport.memberName')}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('recurringSupport.relationship')}</Text>
              <View style={styles.pickerRow}>
                {RELATIONSHIP_VALUES.map((rel) => (
                  <TouchableOpacity
                    key={rel}
                    style={[
                      styles.pickerOption,
                      formRelationship === rel && styles.pickerOptionActive,
                    ]}
                    onPress={() => setFormRelationship(rel)}
                  >
                    <Text
                      style={[
                        styles.pickerOptionText,
                        formRelationship === rel && styles.pickerOptionTextActive,
                      ]}
                    >
                      {t(RELATIONSHIP_I18N[rel])}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('recurringSupport.amount')} *</Text>
              <View style={styles.amountRow}>
                <TextInput
                  style={[styles.formInput, { flex: 1 }]}
                  value={formAmount}
                  onChangeText={setFormAmount}
                  keyboardType="numeric"
                  placeholder="0.00"
                />
                <View style={styles.currencyPicker}>
                  {CURRENCY_VALUES.map((cur) => (
                    <TouchableOpacity
                      key={cur}
                      style={[
                        styles.currencyOption,
                        formCurrency === cur && styles.currencyOptionActive,
                      ]}
                      onPress={() => setFormCurrency(cur)}
                    >
                      <Text
                        style={[
                          styles.currencyOptionText,
                          formCurrency === cur && styles.currencyOptionTextActive,
                        ]}
                      >
                        {cur}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('recurringSupport.frequency')}</Text>
              <View style={styles.pickerRow}>
                {FREQUENCY_VALUES.map((freq) => (
                  <TouchableOpacity
                    key={freq}
                    style={[
                      styles.pillOption,
                      formFrequency === freq && styles.pillOptionActive,
                    ]}
                    onPress={() => setFormFrequency(freq)}
                  >
                    <Text
                      style={[
                        styles.pillOptionText,
                        formFrequency === freq && styles.pillOptionTextActive,
                      ]}
                    >
                      {t(FREQUENCY_I18N[freq])}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('recurringSupport.payoutMethod')}</Text>
              <View style={styles.pickerRow}>
                {PAYOUT_METHOD_VALUES.map((method) => (
                  <TouchableOpacity
                    key={method}
                    style={[
                      styles.pickerOption,
                      formPayoutMethod === method && styles.pickerOptionActive,
                    ]}
                    onPress={() => setFormPayoutMethod(method)}
                  >
                    <Text
                      style={[
                        styles.pickerOptionText,
                        formPayoutMethod === method && styles.pickerOptionTextActive,
                      ]}
                    >
                      {t(PAYOUT_METHOD_I18N[method])}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('recurringSupport.note')}</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea]}
                value={formNote}
                onChangeText={setFormNote}
                placeholder={t('recurringSupport.note')}
                multiline
                numberOfLines={3}
              />
            </View>

            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
              <Text style={styles.saveButtonText}>{t('recurringSupport.save')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => {
                setShowModal(false);
                resetForm();
              }}
            >
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    marginTop: 16,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
  },
  summaryLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  section: {
    paddingHorizontal: 16,
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 4,
  },
  addButtonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
  },
  scheduleCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
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
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInfo: {
    flex: 1,
    marginLeft: 12,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  memberRelationship: {
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
  cardDetails: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  detailText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  frequencyBadge: {
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  frequencyBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  cardActions: {
    flexDirection: 'row',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.background,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.primary,
  },
  processButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    marginHorizontal: 16,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  processButtonDisabled: {
    opacity: 0.7,
  },
  processButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  historyContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  executionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 10,
  },
  executionInfo: {
    flex: 1,
  },
  executionName: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  executionDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  executionRight: {
    alignItems: 'flex-end',
  },
  executionAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  executionStatus: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  emptyHistoryContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyHistoryText: {
    fontSize: 14,
    color: COLORS.textSecondary,
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
    marginBottom: 24,
  },
  emptyAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  emptyAddButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalBody: {
    flex: 1,
    padding: 16,
  },
  formGroup: {
    marginBottom: 20,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  formInput: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.text,
  },
  formTextArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  amountRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  currencyPicker: {
    flexDirection: 'row',
    gap: 4,
  },
  currencyOption: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  currencyOptionActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  currencyOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  currencyOptionTextActive: {
    color: COLORS.white,
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickerOption: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pickerOptionActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  pickerOptionText: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  pickerOptionTextActive: {
    color: COLORS.white,
  },
  pillOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pillOptionActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  pillOptionText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
  },
  pillOptionTextActive: {
    color: COLORS.white,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
  },
  saveButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
  cancelButtonText: {
    color: COLORS.textSecondary,
    fontSize: 16,
    fontWeight: '500',
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
  bottomPadding: {
    height: 40,
  },
});

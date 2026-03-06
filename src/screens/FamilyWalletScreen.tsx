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
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { firestoreFamilyWalletService } from '../services/firestoreFamilyWallet';
import { useAuth } from '../hooks/useAuth';
import type { FamilyMember, MonthlyAllocation } from '../types';

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
  pink: '#EC4899',
  purple: '#8B5CF6',
  cyan: '#06B6D4',
  orange: '#F97316',
};

const RELATIONSHIP_VALUES: FamilyMember['relationship'][] = ['mother', 'father', 'brother', 'sister', 'spouse', 'other'];
const PAYOUT_METHOD_VALUES: FamilyMember['payoutMethod'][] = ['telebirr', 'direct_transfer', 'cash_pickup'];
const PAYOUT_METHOD_I18N: Record<FamilyMember['payoutMethod'], string> = {
  telebirr: 'familyWallet.telebirr',
  direct_transfer: 'familyWallet.directTransfer',
  cash_pickup: 'familyWallet.cashPickup',
};
const RELATIONSHIP_I18N: Record<FamilyMember['relationship'], string> = {
  mother: 'familyWallet.mother',
  father: 'familyWallet.father',
  brother: 'familyWallet.brother',
  sister: 'familyWallet.sister',
  spouse: 'familyWallet.spouse',
  other: 'familyWallet.other',
};
const CURRENCY_VALUES: FamilyMember['currency'][] = ['EUR', 'USD', 'GBP'];

const MEMBER_COLORS = [COLORS.primary, COLORS.blue, COLORS.pink, COLORS.purple, COLORS.cyan, COLORS.orange];
const BUDGET_LIMIT = 1000;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function FamilyWalletScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [sentThisMonth, setSentThisMonth] = useState<MonthlyAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [editingMember, setEditingMember] = useState<FamilyMember | null>(null);
  const [sendingMember, setSendingMember] = useState<FamilyMember | null>(null);
  const [sending, setSending] = useState(false);

  const [formName, setFormName] = useState('');
  const [formRelationship, setFormRelationship] = useState<FamilyMember['relationship']>('mother');
  const [formPhone, setFormPhone] = useState('');
  const [formPayoutMethod, setFormPayoutMethod] = useState<FamilyMember['payoutMethod']>('telebirr');
  const [formNote, setFormNote] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formCurrency, setFormCurrency] = useState<FamilyMember['currency']>('USD');

  const userId = user?.uid ?? '';

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [membersData, sentData] = await Promise.all([
        firestoreFamilyWalletService.getFamilyMembers(userId),
        firestoreFamilyWalletService.getSentThisMonth(userId),
      ]);
      setMembers(membersData);
      setSentThisMonth(sentData);
    } catch (err) {
      console.error('Failed to load family wallet data:', err);
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

  const activeMembers = members.filter(m => m.status === 'active');
  const totalMonthly = activeMembers.reduce((sum, m) => sum + m.monthlyAmount, 0);
  const totalSentThisMonth = sentThisMonth.reduce((sum, a) => sum + a.amount, 0);
  const nextPayoutDate = activeMembers.length > 0
    ? activeMembers.reduce((earliest, m) => {
        const d = new Date(m.nextPayoutDate);
        return d < earliest ? d : earliest;
      }, new Date(activeMembers[0].nextPayoutDate))
    : null;

  const resetForm = () => {
    setFormName('');
    setFormRelationship('mother');
    setFormPhone('');
    setFormPayoutMethod('telebirr');
    setFormNote('');
    setFormAmount('');
    setFormCurrency('USD');
    setEditingMember(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowAddModal(true);
  };

  const openEditModal = (member: FamilyMember) => {
    setEditingMember(member);
    setFormName(member.name);
    setFormRelationship(member.relationship);
    setFormPhone(member.phone);
    setFormPayoutMethod(member.payoutMethod);
    setFormNote(member.note || '');
    setFormAmount(member.monthlyAmount.toString());
    setFormCurrency(member.currency);
    setShowAddModal(true);
  };

  const handleSaveForm = async () => {
    if (!formName.trim() || !formPhone.trim() || !formAmount.trim()) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }
    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }

    try {
      if (editingMember) {
        await firestoreFamilyWalletService.updateFamilyMember(userId, editingMember.id, {
          name: formName.trim(),
          relationship: formRelationship,
          phone: formPhone.trim(),
          payoutMethod: formPayoutMethod,
          monthlyAmount: amount,
          currency: formCurrency,
          note: formNote.trim() || undefined,
        });
        Alert.alert(t('common.success'), t('familyWallet.memberUpdated'));
      } else {
        await firestoreFamilyWalletService.addFamilyMember(userId, {
          userId,
          name: formName.trim(),
          relationship: formRelationship,
          phone: formPhone.trim(),
          payoutMethod: formPayoutMethod,
          monthlyAmount: amount,
          currency: formCurrency,
          status: 'active',
          nextPayoutDate: new Date(new Date().setMonth(new Date().getMonth() + 1, 1)).toISOString(),
          note: formNote.trim() || undefined,
        });
        Alert.alert(t('common.success'), t('familyWallet.memberAdded'));
      }
      setShowAddModal(false);
      resetForm();
      await loadData();
    } catch (err) {
      Alert.alert(t('common.error'), t('common.error'));
    }
  };

  const handleToggleStatus = async (member: FamilyMember) => {
    try {
      await firestoreFamilyWalletService.toggleMemberStatus(userId, member.id);
      await loadData();
    } catch (err) {
      Alert.alert(t('common.error'), t('common.error'));
    }
  };

  const handleDelete = (member: FamilyMember) => {
    Alert.alert(
      t('familyWallet.confirmDelete'),
      t('familyWallet.deleteMsg', { name: member.name }),
      [
        { text: t('familyWallet.cancel'), style: 'cancel' },
        {
          text: t('familyWallet.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await firestoreFamilyWalletService.deleteFamilyMember(userId, member.id);
              Alert.alert(t('common.success'), t('familyWallet.memberDeleted'));
              await loadData();
            } catch (err) {
              Alert.alert(t('common.error'), t('common.error'));
            }
          },
        },
      ]
    );
  };

  const openSendModal = (member: FamilyMember) => {
    setSendingMember(member);
    setShowSendModal(true);
  };

  const handleConfirmSend = async () => {
    if (!sendingMember) return;
    setSending(true);
    try {
      await firestoreFamilyWalletService.sendFamilySupport(userId, sendingMember);
      setShowSendModal(false);
      setSendingMember(null);
      Alert.alert(t('common.success'), t('familyWallet.supportSent'));
      await loadData();
    } catch (err) {
      Alert.alert(t('common.error'), t('common.error'));
    } finally {
      setSending(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getPayoutLabel = (method: FamilyMember['payoutMethod']) => {
    return t(PAYOUT_METHOD_I18N[method] || method);
  };

  const getRelationshipLabel = (rel: FamilyMember['relationship']) => {
    return t(RELATIONSHIP_I18N[rel] || rel);
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

  const renderDonutChart = () => {
    if (activeMembers.length === 0) return null;
    const total = activeMembers.reduce((s, m) => s + m.monthlyAmount, 0);
    if (total === 0) return null;

    const size = 140;
    const strokeWidth = 24;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    let accumulatedAngle = 0;

    return (
      <View style={styles.chartSection}>
        <Text style={styles.sectionTitle}>{t('familyWallet.allocationSplit')}</Text>
        <View style={styles.chartContainer}>
          <View style={styles.donutContainer}>
            <View style={{ width: size, height: size }}>
              {activeMembers.map((member, index) => {
                const percentage = member.monthlyAmount / total;
                const strokeDasharray = `${circumference * percentage} ${circumference * (1 - percentage)}`;
                const rotation = accumulatedAngle * 360 - 90;
                accumulatedAngle += percentage;
                const color = MEMBER_COLORS[index % MEMBER_COLORS.length];

                return (
                  <View
                    key={member.id}
                    style={[
                      styles.donutSegment,
                      {
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        borderWidth: strokeWidth,
                        borderColor: color,
                        position: 'absolute',
                        opacity: 0.85 + (index * 0.05),
                      },
                    ]}
                  />
                );
              })}
              <View style={styles.donutCenter}>
                <Text style={styles.donutCenterAmount}>${total}</Text>
                <Text style={styles.donutCenterLabel}>/ month</Text>
              </View>
            </View>
          </View>
          <View style={styles.legendContainer}>
            {activeMembers.map((member, index) => (
              <View key={member.id} style={styles.legendItem}>
                <View
                  style={[
                    styles.legendDot,
                    { backgroundColor: MEMBER_COLORS[index % MEMBER_COLORS.length] },
                  ]}
                />
                <Text style={styles.legendText} numberOfLines={1}>
                  {member.name}
                </Text>
                <Text style={styles.legendAmount}>
                  ${member.monthlyAmount}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="people-outline" size={64} color={COLORS.textSecondary} />
      </View>
      <Text style={styles.emptyTitle}>{t('familyWallet.emptyTitle')}</Text>
      <Text style={styles.emptyMessage}>
        {t('familyWallet.emptyMessage')}
      </Text>
      <TouchableOpacity style={styles.emptyAddButton} onPress={openAddModal}>
        <Ionicons name="add-circle" size={22} color={COLORS.white} />
        <Text style={styles.emptyAddButtonText}>{t('familyWallet.addMember')}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('familyWallet.title')}</Text>
          <Text style={styles.subtitle}>{t('familyWallet.subtitle')}</Text>
        </View>

        {members.length === 0 ? (
          renderEmptyState()
        ) : (
          <>
            {totalMonthly > BUDGET_LIMIT && (
              <View style={styles.budgetWarning}>
                <Ionicons name="warning" size={20} color={COLORS.amber} />
                <Text style={styles.budgetWarningText}>
                  {t('familyWallet.budgetWarning')}
                </Text>
              </View>
            )}

            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, { backgroundColor: '#ECFDF5' }]}>
                <Ionicons name="cash-outline" size={24} color={COLORS.success} />
                <Text style={[styles.summaryValue, { color: COLORS.success }]}>
                  ${totalMonthly}
                </Text>
                <Text style={styles.summaryLabel}>{t('familyWallet.totalMonthly')}</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: '#EFF6FF' }]}>
                <Ionicons name="people-outline" size={24} color={COLORS.blue} />
                <Text style={[styles.summaryValue, { color: COLORS.blue }]}>
                  {members.length}
                </Text>
                <Text style={styles.summaryLabel}>{t('familyWallet.members')}</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: '#FFFBEB' }]}>
                <Ionicons name="calendar-outline" size={24} color={COLORS.amber} />
                <Text style={[styles.summaryValue, { color: COLORS.amber }]} numberOfLines={1}>
                  {nextPayoutDate ? formatDate(nextPayoutDate.toISOString()) : 'N/A'}
                </Text>
                <Text style={styles.summaryLabel}>{t('familyWallet.nextSupport')}</Text>
              </View>
            </View>

            <View style={styles.monthlySummarySection}>
              <Text style={styles.sectionTitle}>{t('familyWallet.plannedMonth')}</Text>
              <View style={styles.monthlySummaryRow}>
                <View style={styles.monthlySummaryItem}>
                  <Text style={styles.monthlySummaryLabel}>{t('familyWallet.plannedMonth')}</Text>
                  <Text style={[styles.monthlySummaryValue, { color: COLORS.primary }]}>
                    ${totalMonthly}
                  </Text>
                </View>
                <View style={styles.monthlySummaryDivider} />
                <View style={styles.monthlySummaryItem}>
                  <Text style={styles.monthlySummaryLabel}>{t('familyWallet.sentMonth')}</Text>
                  <Text style={[styles.monthlySummaryValue, { color: COLORS.success }]}>
                    ${totalSentThisMonth}
                  </Text>
                </View>
              </View>
            </View>

            {renderDonutChart()}

            <View style={styles.membersSection}>
              <View style={styles.membersSectionHeader}>
                <Text style={styles.sectionTitle}>{t('familyWallet.members')}</Text>
                <TouchableOpacity style={styles.addButton} onPress={openAddModal}>
                  <Ionicons name="add" size={20} color={COLORS.white} />
                  <Text style={styles.addButtonText}>Add</Text>
                </TouchableOpacity>
              </View>

              {members.map((member) => (
                <View key={member.id} style={styles.memberCard}>
                  <View style={styles.memberHeader}>
                    <View style={styles.memberAvatar}>
                      <Ionicons name="person" size={24} color={COLORS.primary} />
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName}>{member.name}</Text>
                      <Text style={styles.memberRelationship}>
                        {getRelationshipLabel(member.relationship)}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        member.status === 'active'
                          ? styles.statusActive
                          : styles.statusPaused,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          member.status === 'active'
                            ? styles.statusTextActive
                            : styles.statusTextPaused,
                        ]}
                      >
                        {member.status === 'active' ? t('familyWallet.active') : t('familyWallet.paused')}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.memberDetails}>
                    <View style={styles.memberDetailRow}>
                      <Ionicons name="call-outline" size={16} color={COLORS.textSecondary} />
                      <Text style={styles.memberDetailText}>{member.phone}</Text>
                    </View>
                    <View style={styles.memberDetailRow}>
                      <Ionicons name="cash-outline" size={16} color={COLORS.textSecondary} />
                      <Text style={styles.memberDetailText}>
                        {member.currency} {member.monthlyAmount} / month
                      </Text>
                    </View>
                    <View style={styles.memberDetailRow}>
                      <Ionicons name="send-outline" size={16} color={COLORS.textSecondary} />
                      <Text style={styles.memberDetailText}>
                        {getPayoutLabel(member.payoutMethod)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.memberActions}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => openEditModal(member)}
                    >
                      <Ionicons name="create-outline" size={18} color={COLORS.primary} />
                      <Text style={styles.actionButtonText}>{t('common.edit')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleToggleStatus(member)}
                    >
                      <Ionicons
                        name={member.status === 'active' ? 'pause-outline' : 'play-outline'}
                        size={18}
                        color={COLORS.amber}
                      />
                      <Text style={[styles.actionButtonText, { color: COLORS.amber }]}>
                        {member.status === 'active' ? t('familyWallet.pause') : t('familyWallet.resume')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleDelete(member)}
                    >
                      <Ionicons name="trash-outline" size={18} color={COLORS.error} />
                      <Text style={[styles.actionButtonText, { color: COLORS.error }]}>{t('familyWallet.delete')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.sendNowButton]}
                      onPress={() => openSendModal(member)}
                    >
                      <Ionicons name="paper-plane" size={16} color={COLORS.white} />
                      <Text style={styles.sendNowButtonText}>{t('familyWallet.sendNow')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>

      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setShowAddModal(false);
          resetForm();
        }}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                setShowAddModal(false);
                resetForm();
              }}
            >
              <Ionicons name="close" size={28} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editingMember ? t('familyWallet.editMember') : t('familyWallet.addMember')}
            </Text>
            <View style={{ width: 28 }} />
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('familyWallet.name')} *</Text>
              <TextInput
                style={styles.formInput}
                value={formName}
                onChangeText={setFormName}
                placeholder="Enter full name"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('familyWallet.relationship')}</Text>
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
              <Text style={styles.formLabel}>{t('familyWallet.phone')} *</Text>
              <TextInput
                style={styles.formInput}
                value={formPhone}
                onChangeText={setFormPhone}
                placeholder="+251..."
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('familyWallet.payoutMethod')}</Text>
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
              <Text style={styles.formLabel}>{t('familyWallet.monthlyAmount')} *</Text>
              <TextInput
                style={styles.formInput}
                value={formAmount}
                onChangeText={setFormAmount}
                placeholder="0.00"
                keyboardType="decimal-pad"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('familyWallet.currency')}</Text>
              <View style={styles.pickerRow}>
                {CURRENCY_VALUES.map((cur) => (
                  <TouchableOpacity
                    key={cur}
                    style={[
                      styles.pickerOption,
                      formCurrency === cur && styles.pickerOptionActive,
                    ]}
                    onPress={() => setFormCurrency(cur)}
                  >
                    <Text
                      style={[
                        styles.pickerOptionText,
                        formCurrency === cur && styles.pickerOptionTextActive,
                      ]}
                    >
                      {cur}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('familyWallet.note')}</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea]}
                value={formNote}
                onChangeText={setFormNote}
                placeholder="Add a note..."
                multiline
              />
            </View>

            <TouchableOpacity style={styles.saveButton} onPress={handleSaveForm}>
              <Ionicons name="checkmark-circle" size={22} color={COLORS.white} />
              <Text style={styles.saveButtonText}>
                {editingMember ? t('familyWallet.save') : t('familyWallet.addMember')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => {
                setShowAddModal(false);
                resetForm();
              }}
            >
              <Text style={styles.cancelButtonText}>{t('familyWallet.cancel')}</Text>
            </TouchableOpacity>

            <View style={styles.bottomPadding} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={showSendModal}
        animationType="fade"
        transparent
        onRequestClose={() => {
          setShowSendModal(false);
          setSendingMember(null);
        }}
      >
        <View style={styles.sendModalOverlay}>
          <View style={styles.sendModalContent}>
            <View style={styles.sendModalHeader}>
              <Ionicons name="paper-plane" size={32} color={COLORS.primary} />
              <Text style={styles.sendModalTitle}>{t('familyWallet.confirmSend')}</Text>
            </View>
            {sendingMember && (
              <View style={styles.sendModalDetails}>
                <View style={styles.sendModalRow}>
                  <Text style={styles.sendModalLabel}>To</Text>
                  <Text style={styles.sendModalValue}>{sendingMember.name}</Text>
                </View>
                <View style={styles.sendModalRow}>
                  <Text style={styles.sendModalLabel}>Amount</Text>
                  <Text style={styles.sendModalValue}>
                    {sendingMember.currency} {sendingMember.monthlyAmount}
                  </Text>
                </View>
                <View style={styles.sendModalRow}>
                  <Text style={styles.sendModalLabel}>Method</Text>
                  <Text style={styles.sendModalValue}>
                    {getPayoutLabel(sendingMember.payoutMethod)}
                  </Text>
                </View>
              </View>
            )}
            <View style={styles.sendModalActions}>
              <TouchableOpacity
                style={styles.sendModalCancel}
                onPress={() => {
                  setShowSendModal(false);
                  setSendingMember(null);
                }}
              >
                <Text style={styles.sendModalCancelText}>{t('familyWallet.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sendModalConfirm, sending && { opacity: 0.6 }]}
                onPress={handleConfirmSend}
                disabled={sending}
              >
                {sending ? (
                  <ActivityIndicator color={COLORS.white} size="small" />
                ) : (
                  <Text style={styles.sendModalConfirmText}>{t('familyWallet.confirmSend')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  budgetWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  budgetWarningText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 13,
    color: '#92400E',
    fontWeight: '500',
  },
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 16,
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 6,
  },
  summaryLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },
  monthlySummarySection: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  monthlySummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  monthlySummaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  monthlySummaryLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  monthlySummaryValue: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  monthlySummaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: COLORS.border,
  },
  chartSection: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
  },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  donutContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutSegment: {
    position: 'absolute',
  },
  donutCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  donutCenterAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  donutCenterLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  legendContainer: {
    flex: 1,
    marginLeft: 20,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  legendText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
  },
  legendAmount: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  membersSection: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  membersSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 4,
  },
  addButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  memberCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.background,
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
  statusActive: {
    backgroundColor: '#ECFDF5',
  },
  statusPaused: {
    backgroundColor: '#F3F4F6',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusTextActive: {
    color: COLORS.success,
  },
  statusTextPaused: {
    color: COLORS.textSecondary,
  },
  memberDetails: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  memberDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  memberDetailText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  memberActions: {
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
  sendNowButton: {
    backgroundColor: COLORS.primary,
    marginLeft: 'auto',
  },
  sendNowButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
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
  sendModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  sendModalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  sendModalHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  sendModalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 10,
  },
  sendModalDetails: {
    marginBottom: 20,
  },
  sendModalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sendModalLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  sendModalValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  sendModalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  sendModalCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  sendModalCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  sendModalConfirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: COLORS.primary,
  },
  sendModalConfirmText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
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

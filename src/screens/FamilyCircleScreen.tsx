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
import { familyCircleService } from '../services/firestoreFamilyCircle';
import { useAuth } from '../hooks/useAuth';
import type { FamilyCircle, CircleMember, CircleContribution, CircleBeneficiary } from '../types';

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
const PAYOUT_METHOD_VALUES: CircleBeneficiary['payoutMethod'][] = ['telebirr', 'direct_transfer', 'cash_pickup'];
const CURRENCY_VALUES: CircleMember['currency'][] = ['EUR', 'USD', 'GBP'];
const FREQUENCY_VALUES: FamilyCircle['frequency'][] = ['monthly', 'quarterly'];

const RELATIONSHIP_I18N: Record<string, string> = {
  mother: 'familyWallet.mother',
  father: 'familyWallet.father',
  brother: 'familyWallet.brother',
  sister: 'familyWallet.sister',
  spouse: 'familyWallet.spouse',
  other: 'familyWallet.other',
};

const PAYOUT_METHOD_I18N: Record<CircleBeneficiary['payoutMethod'], string> = {
  telebirr: 'familyWallet.telebirr',
  direct_transfer: 'familyWallet.directTransfer',
  cash_pickup: 'familyWallet.cashPickup',
};

const STATUS_COLORS: Record<string, string> = {
  active: COLORS.success,
  paused: COLORS.amber,
  completed: COLORS.blue,
  invited: COLORS.purple,
  left: COLORS.textSecondary,
  pledged: COLORS.amber,
  sent: COLORS.success,
  failed: COLORS.error,
};

export default function FamilyCircleScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.uid ?? '';

  const [circles, setCircles] = useState<FamilyCircle[]>([]);
  const [contributions, setContributions] = useState<CircleContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedCircle, setSelectedCircle] = useState<FamilyCircle | null>(null);
  const [circleContributions, setCircleContributions] = useState<CircleContribution[]>([]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showContributeModal, setShowContributeModal] = useState(false);
  const [editingCircle, setEditingCircle] = useState<FamilyCircle | null>(null);
  const [processing, setProcessing] = useState(false);

  const [formCircleName, setFormCircleName] = useState('');
  const [formBeneficiaryName, setFormBeneficiaryName] = useState('');
  const [formBeneficiaryRelationship, setFormBeneficiaryRelationship] = useState<string>('mother');
  const [formBeneficiaryPhone, setFormBeneficiaryPhone] = useState('');
  const [formBeneficiaryPayoutMethod, setFormBeneficiaryPayoutMethod] = useState<CircleBeneficiary['payoutMethod']>('telebirr');
  const [formTargetAmount, setFormTargetAmount] = useState('');
  const [formCurrency, setFormCurrency] = useState<CircleMember['currency']>('USD');
  const [formFrequency, setFormFrequency] = useState<FamilyCircle['frequency']>('monthly');

  const [formMemberName, setFormMemberName] = useState('');
  const [formMemberLocation, setFormMemberLocation] = useState('');
  const [formMemberAmount, setFormMemberAmount] = useState('');
  const [formMemberCurrency, setFormMemberCurrency] = useState<CircleMember['currency']>('USD');

  const [contributingMember, setContributingMember] = useState<CircleMember | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [circlesData, contributionsData] = await Promise.all([
        familyCircleService.getCircles(userId),
        familyCircleService.getContributions(userId),
      ]);
      setCircles(circlesData);
      setContributions(contributionsData);
    } catch (err) {
      console.error('Failed to load family circle data:', err);
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

  const loadCircleContributions = useCallback(async (circleId: string) => {
    try {
      const data = await familyCircleService.getContributions(userId, circleId);
      setCircleContributions(data);
    } catch (err) {
      console.error('Failed to load circle contributions:', err);
    }
  }, [userId]);

  const openCircleDetail = async (circle: FamilyCircle) => {
    setSelectedCircle(circle);
    await loadCircleContributions(circle.id);
  };

  const closeCircleDetail = () => {
    setSelectedCircle(null);
    setCircleContributions([]);
  };

  const resetCreateForm = () => {
    setFormCircleName('');
    setFormBeneficiaryName('');
    setFormBeneficiaryRelationship('mother');
    setFormBeneficiaryPhone('');
    setFormBeneficiaryPayoutMethod('telebirr');
    setFormTargetAmount('');
    setFormCurrency('USD');
    setFormFrequency('monthly');
    setEditingCircle(null);
  };

  const openCreateModal = () => {
    resetCreateForm();
    setShowCreateModal(true);
  };

  const openEditModal = (circle: FamilyCircle) => {
    setEditingCircle(circle);
    setFormCircleName(circle.name);
    setFormBeneficiaryName(circle.beneficiary.name);
    setFormBeneficiaryRelationship(circle.beneficiary.relationship);
    setFormBeneficiaryPhone(circle.beneficiary.phone);
    setFormBeneficiaryPayoutMethod(circle.beneficiary.payoutMethod);
    setFormTargetAmount(circle.totalTarget.toString());
    setFormCurrency(circle.currency as CircleMember['currency']);
    setFormFrequency(circle.frequency);
    setShowCreateModal(true);
  };

  const handleSaveCircle = async () => {
    if (!formCircleName.trim() || !formBeneficiaryName.trim() || !formBeneficiaryPhone.trim() || !formTargetAmount.trim()) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }
    const target = parseFloat(formTargetAmount);
    if (isNaN(target) || target <= 0) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }

    try {
      const beneficiary: CircleBeneficiary = {
        name: formBeneficiaryName.trim(),
        relationship: formBeneficiaryRelationship,
        phone: formBeneficiaryPhone.trim(),
        payoutMethod: formBeneficiaryPayoutMethod,
      };

      if (editingCircle) {
        const updated = await familyCircleService.updateCircle(userId, editingCircle.id, {
          name: formCircleName.trim(),
          beneficiary,
          totalTarget: target,
          currency: formCurrency,
          frequency: formFrequency,
        });
        Alert.alert(t('common.success'), t('familyCircle.circleUpdated'));
        if (selectedCircle && selectedCircle.id === editingCircle.id) {
          setSelectedCircle(updated);
        }
      } else {
        const nextDate = new Date();
        if (formFrequency === 'monthly') {
          nextDate.setMonth(nextDate.getMonth() + 1, 1);
        } else {
          nextDate.setMonth(nextDate.getMonth() + 3, 1);
        }

        await familyCircleService.createCircle(userId, {
          userId,
          name: formCircleName.trim(),
          members: [],
          beneficiary,
          totalTarget: target,
          currency: formCurrency,
          frequency: formFrequency,
          status: 'active',
          nextPayoutDate: nextDate.toISOString(),
        });
        Alert.alert(t('common.success'), t('familyCircle.circleCreated'));
      }

      setShowCreateModal(false);
      resetCreateForm();
      await loadData();
    } catch (err) {
      Alert.alert(t('common.error'), t('common.error'));
    }
  };

  const resetMemberForm = () => {
    setFormMemberName('');
    setFormMemberLocation('');
    setFormMemberAmount('');
    setFormMemberCurrency('USD');
  };

  const openAddMemberModal = () => {
    resetMemberForm();
    setShowAddMemberModal(true);
  };

  const handleAddMember = async () => {
    if (!selectedCircle) return;
    if (!formMemberName.trim() || !formMemberLocation.trim() || !formMemberAmount.trim()) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }
    const amount = parseFloat(formMemberAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }

    try {
      const updated = await familyCircleService.addMember(userId, selectedCircle.id, {
        name: formMemberName.trim(),
        location: formMemberLocation.trim(),
        amount,
        currency: formMemberCurrency,
      });
      Alert.alert(t('common.success'), t('familyCircle.memberAdded'));
      setSelectedCircle(updated);
      setShowAddMemberModal(false);
      resetMemberForm();
      await loadData();
    } catch (err) {
      Alert.alert(t('common.error'), t('common.error'));
    }
  };

  const handleRemoveMember = (member: CircleMember) => {
    if (!selectedCircle) return;
    Alert.alert(
      t('familyCircle.removeMember'),
      t('familyCircle.removeMember') + ': ' + member.name + '?',
      [
        { text: t('familyCircle.cancel'), style: 'cancel' },
        {
          text: t('familyCircle.removeMember'),
          style: 'destructive',
          onPress: async () => {
            try {
              const updated = await familyCircleService.removeMember(userId, selectedCircle.id, member.id);
              Alert.alert(t('common.success'), t('familyCircle.memberRemoved'));
              setSelectedCircle(updated);
              await loadData();
            } catch (err) {
              Alert.alert(t('common.error'), t('common.error'));
            }
          },
        },
      ]
    );
  };

  const handleSendPayout = async (circle: FamilyCircle) => {
    Alert.alert(
      t('familyCircle.payoutReady'),
      t('familyCircle.allContributed'),
      [
        { text: t('familyCircle.cancel'), style: 'cancel' },
        {
          text: t('familyCircle.sendPayout'),
          onPress: async () => {
            setProcessing(true);
            try {
              await familyCircleService.processCirclePayout(userId, circle.id);
              Alert.alert(t('common.success'), t('familyCircle.payoutInitiated'));
              await loadData();
              if (selectedCircle?.id === circle.id) {
                const updatedCircles = await familyCircleService.getCircles(userId);
                const updated = updatedCircles.find(c => c.id === circle.id);
                if (updated) setSelectedCircle(updated);
                await loadCircleContributions(circle.id);
              }
            } catch (err) {
              Alert.alert(t('common.error'), t('familyCircle.payoutFailed'));
            } finally {
              setProcessing(false);
            }
          },
        },
      ]
    );
  };

  const openContributeModal = (member: CircleMember) => {
    setContributingMember(member);
    setShowContributeModal(true);
  };

  const handleContribute = async () => {
    if (!selectedCircle || !contributingMember) return;

    try {
      const now = new Date();
      const period = selectedCircle.frequency === 'monthly'
        ? `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`
        : `${now.getFullYear()}_Q${Math.ceil((now.getMonth() + 1) / 3)}`;

      await familyCircleService.recordContribution(userId, {
        circleId: selectedCircle.id,
        memberId: contributingMember.id,
        memberName: contributingMember.name,
        amount: contributingMember.amount,
        currency: contributingMember.currency,
        status: 'sent',
        period,
      });

      Alert.alert(t('common.success'), t('familyCircle.contributeSuccess'));
      setShowContributeModal(false);
      setContributingMember(null);

      const updatedCircles = await familyCircleService.getCircles(userId);
      setCircles(updatedCircles);
      const current = updatedCircles.find(c => c.id === selectedCircle.id);
      if (current) {
        setSelectedCircle(current);
      }
      await loadCircleContributions(selectedCircle.id);
      await loadData();
    } catch (err) {
      Alert.alert(t('common.error'), t('common.error'));
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getProgressPercent = (circle: FamilyCircle) => {
    if (circle.totalTarget <= 0) return 0;
    return Math.min((circle.totalContributed / circle.totalTarget) * 100, 100);
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
        <Ionicons name="people-circle-outline" size={64} color={COLORS.textSecondary} />
      </View>
      <Text style={styles.emptyTitle}>{t('familyCircle.noCircles')}</Text>
      <Text style={styles.emptyMessage}>{t('familyCircle.emptyMessage')}</Text>
      <TouchableOpacity style={styles.emptyAddButton} onPress={openCreateModal}>
        <Ionicons name="add-circle" size={22} color={COLORS.white} />
        <Text style={styles.emptyAddButtonText}>{t('familyCircle.createCircle')}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderCircleCard = (circle: FamilyCircle) => {
    const progress = getProgressPercent(circle);
    const activeMembers = circle.members.filter(m => m.status === 'active' || m.status === 'invited');
    const statusColor = STATUS_COLORS[circle.status] || COLORS.textSecondary;

    return (
      <TouchableOpacity
        key={circle.id}
        style={styles.circleCard}
        onPress={() => openCircleDetail(circle)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={styles.circleAvatar}>
            <Ionicons name="people-circle" size={28} color={COLORS.primary} />
          </View>
          <View style={styles.cardHeaderInfo}>
            <Text style={styles.circleName}>{circle.name}</Text>
            <Text style={styles.beneficiaryLabel}>
              {circle.beneficiary.name} — {t(RELATIONSHIP_I18N[circle.beneficiary.relationship] || circle.beneficiary.relationship)}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {t(`familyCircle.${circle.status}`)}
            </Text>
          </View>
        </View>

        <View style={styles.cardDetails}>
          <View style={styles.detailRow}>
            <Ionicons name="people-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.detailText}>
              {t('familyCircle.members')}: {activeMembers.length}
            </Text>
            <View style={styles.memberAvatars}>
              {activeMembers.slice(0, 3).map((m, i) => (
                <View key={m.id} style={[styles.miniAvatar, { marginLeft: i > 0 ? -8 : 0 }]}>
                  <Text style={styles.miniAvatarText}>{m.name.charAt(0).toUpperCase()}</Text>
                </View>
              ))}
              {activeMembers.length > 3 && (
                <View style={[styles.miniAvatar, { marginLeft: -8, backgroundColor: COLORS.textSecondary }]}>
                  <Text style={styles.miniAvatarText}>+{activeMembers.length - 3}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.detailRow}>
            <Ionicons name="cash-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.detailText}>
              {t('familyCircle.targetAmount')}: {circle.currency} {circle.totalTarget}
            </Text>
          </View>

          <View style={styles.progressContainer}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>{t('familyCircle.progress')}</Text>
              <Text style={styles.progressValue}>
                {circle.currency} {circle.totalContributed} {t('familyCircle.of')} {circle.currency} {circle.totalTarget}
              </Text>
            </View>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
            </View>
          </View>

          <View style={styles.cardFooter}>
            <View style={styles.frequencyBadge}>
              <Text style={styles.frequencyBadgeText}>
                {t(`familyCircle.${circle.frequency === 'monthly' ? 'monthlyFreq' : 'quarterlyFreq'}`)}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="calendar-outline" size={14} color={COLORS.textSecondary} />
              <Text style={styles.detailTextSmall}>
                {t('familyCircle.nextPayout')}: {formatDate(circle.nextPayoutDate)}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderCircleDetailView = () => {
    if (!selectedCircle) return null;
    const progress = getProgressPercent(selectedCircle);
    const activeMembers = selectedCircle.members.filter(m => m.status !== 'left');

    return (
      <Modal
        visible={!!selectedCircle}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeCircleDetail}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeCircleDetail}>
              <Ionicons name="arrow-back" size={28} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{t('familyCircle.details')}</Text>
            <TouchableOpacity onPress={() => openEditModal(selectedCircle)}>
              <Ionicons name="create-outline" size={24} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailCircleName}>{selectedCircle.name}</Text>
              <View style={styles.detailBeneficiaryRow}>
                <Ionicons name="person-outline" size={18} color={COLORS.textSecondary} />
                <Text style={styles.detailBeneficiaryText}>
                  {selectedCircle.beneficiary.name} — {t(RELATIONSHIP_I18N[selectedCircle.beneficiary.relationship] || selectedCircle.beneficiary.relationship)}
                </Text>
              </View>
              <View style={styles.detailBeneficiaryRow}>
                <Ionicons name="call-outline" size={16} color={COLORS.textSecondary} />
                <Text style={styles.detailBeneficiaryText}>{selectedCircle.beneficiary.phone}</Text>
              </View>
              <View style={styles.detailBeneficiaryRow}>
                <Ionicons name="send-outline" size={16} color={COLORS.textSecondary} />
                <Text style={styles.detailBeneficiaryText}>
                  {t(PAYOUT_METHOD_I18N[selectedCircle.beneficiary.payoutMethod])}
                </Text>
              </View>
            </View>

            <View style={styles.progressSection}>
              <Text style={styles.sectionTitle}>{t('familyCircle.progress')}</Text>
              <View style={styles.progressHeader}>
                <Text style={styles.progressLabel}>
                  {t('familyCircle.collected')}: {selectedCircle.currency} {selectedCircle.totalContributed}
                </Text>
                <Text style={styles.progressValue}>
                  {t('familyCircle.remaining')}: {selectedCircle.currency} {Math.max(selectedCircle.totalTarget - selectedCircle.totalContributed, 0)}
                </Text>
              </View>
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
              </View>
              <Text style={styles.progressPercent}>
                {t('familyCircle.progressLabel')}: {Math.round(progress)}%
              </Text>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('familyCircle.members')}</Text>
                <TouchableOpacity style={styles.addButton} onPress={openAddMemberModal}>
                  <Ionicons name="add" size={20} color={COLORS.white} />
                  <Text style={styles.addButtonText}>{t('familyCircle.addMember')}</Text>
                </TouchableOpacity>
              </View>

              {activeMembers.length === 0 ? (
                <Text style={styles.emptyListText}>{t('familyCircle.noCircles')}</Text>
              ) : (
                activeMembers.map((member) => {
                  const memberStatusColor = STATUS_COLORS[member.status] || COLORS.textSecondary;
                  return (
                    <View key={member.id} style={styles.memberCard}>
                      <View style={styles.memberHeader}>
                        <View style={styles.memberAvatar}>
                          <Text style={styles.memberAvatarText}>{member.name.charAt(0).toUpperCase()}</Text>
                        </View>
                        <View style={styles.memberInfo}>
                          <Text style={styles.memberName}>{member.name}</Text>
                          <Text style={styles.memberLocation}>
                            <Ionicons name="location-outline" size={12} color={COLORS.textSecondary} /> {member.location}
                          </Text>
                        </View>
                        <View style={[styles.statusBadge, { backgroundColor: memberStatusColor + '20' }]}>
                          <Text style={[styles.statusText, { color: memberStatusColor }]}>
                            {member.status === 'active' ? t('familyCircle.active') :
                             member.status === 'invited' ? t('familyCircle.invited') :
                             t('familyCircle.left')}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.memberDetails}>
                        <Text style={styles.memberAmountText}>
                          {t('familyCircle.contributionAmount')}: {member.currency} {member.amount}
                        </Text>
                      </View>
                      <View style={styles.memberActions}>
                        {member.status === 'active' && (
                          <TouchableOpacity
                            style={[styles.actionButton, styles.contributeButton]}
                            onPress={() => openContributeModal(member)}
                          >
                            <Ionicons name="paper-plane" size={16} color={COLORS.white} />
                            <Text style={styles.contributeButtonText}>{t('familyCircle.contributeNow')}</Text>
                          </TouchableOpacity>
                        )}
                        {member.status !== 'left' && (
                          <TouchableOpacity
                            style={styles.actionButton}
                            onPress={() => handleRemoveMember(member)}
                          >
                            <Ionicons name="person-remove-outline" size={16} color={COLORS.error} />
                            <Text style={[styles.actionButtonText, { color: COLORS.error }]}>{t('familyCircle.removeMember')}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('familyCircle.recentContributions')}</Text>
              {circleContributions.length === 0 ? (
                <View style={styles.emptyHistoryContainer}>
                  <Text style={styles.emptyHistoryText}>{t('familyCircle.noContributions')}</Text>
                </View>
              ) : (
                <View style={styles.contributionsList}>
                  {circleContributions.slice(0, 10).map((contrib) => {
                    const contribStatusColor = STATUS_COLORS[contrib.status] || COLORS.textSecondary;
                    return (
                      <View key={contrib.id} style={styles.contributionRow}>
                        <View style={styles.contributionInfo}>
                          <Text style={styles.contributionName}>{contrib.memberName}</Text>
                          <Text style={styles.contributionDate}>{formatDate(contrib.createdAt)}</Text>
                        </View>
                        <View style={styles.contributionRight}>
                          <Text style={styles.contributionAmount}>
                            {contrib.currency} {contrib.amount}
                          </Text>
                          <Text style={[styles.contributionStatus, { color: contribStatusColor }]}>
                            {contrib.status === 'pledged' ? t('familyCircle.pledged') :
                             contrib.status === 'sent' ? t('familyCircle.sent') :
                             t('familyCircle.failed')}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {selectedCircle && selectedCircle.status === 'active' && selectedCircle.totalContributed >= selectedCircle.totalTarget && (
              <TouchableOpacity
                style={[styles.payoutButton, processing && { opacity: 0.6 }]}
                onPress={() => handleSendPayout(selectedCircle)}
                disabled={processing}
              >
                {processing ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <>
                    <Ionicons name="rocket" size={20} color={COLORS.white} />
                    <Text style={styles.payoutButtonText}>{t('familyCircle.sendPayout')}</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            <View style={styles.bottomPadding} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    );
  };

  const renderCreateEditModal = () => (
    <Modal
      visible={showCreateModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        setShowCreateModal(false);
        resetCreateForm();
      }}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={() => {
              setShowCreateModal(false);
              resetCreateForm();
            }}
          >
            <Ionicons name="close" size={28} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>
            {editingCircle ? t('familyCircle.editCircle') : t('familyCircle.createCircle')}
          </Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView style={styles.modalBody}>
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('familyCircle.circleName')} *</Text>
            <TextInput
              style={styles.formInput}
              value={formCircleName}
              onChangeText={setFormCircleName}
              placeholder={t('familyCircle.circleName')}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('familyCircle.beneficiaryName')} *</Text>
            <TextInput
              style={styles.formInput}
              value={formBeneficiaryName}
              onChangeText={setFormBeneficiaryName}
              placeholder={t('familyCircle.beneficiaryName')}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('familyCircle.beneficiaryRelationship')}</Text>
            <View style={styles.pickerRow}>
              {RELATIONSHIP_VALUES.map((rel) => (
                <TouchableOpacity
                  key={rel}
                  style={[
                    styles.pickerOption,
                    formBeneficiaryRelationship === rel && styles.pickerOptionActive,
                  ]}
                  onPress={() => setFormBeneficiaryRelationship(rel)}
                >
                  <Text
                    style={[
                      styles.pickerOptionText,
                      formBeneficiaryRelationship === rel && styles.pickerOptionTextActive,
                    ]}
                  >
                    {t(RELATIONSHIP_I18N[rel])}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('familyCircle.beneficiaryPhone')} *</Text>
            <TextInput
              style={styles.formInput}
              value={formBeneficiaryPhone}
              onChangeText={setFormBeneficiaryPhone}
              placeholder={t('familyCircle.beneficiaryPhone')}
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
                    formBeneficiaryPayoutMethod === method && styles.pickerOptionActive,
                  ]}
                  onPress={() => setFormBeneficiaryPayoutMethod(method)}
                >
                  <Text
                    style={[
                      styles.pickerOptionText,
                      formBeneficiaryPayoutMethod === method && styles.pickerOptionTextActive,
                    ]}
                  >
                    {t(PAYOUT_METHOD_I18N[method])}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('familyCircle.targetAmount')} *</Text>
            <View style={styles.amountRow}>
              <TextInput
                style={[styles.formInput, { flex: 1 }]}
                value={formTargetAmount}
                onChangeText={setFormTargetAmount}
                placeholder="0.00"
                keyboardType="decimal-pad"
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
            <Text style={styles.formLabel}>{t('familyCircle.frequency')}</Text>
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
                    {t(`familyCircle.${freq === 'monthly' ? 'monthlyFreq' : 'quarterlyFreq'}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity style={styles.saveButton} onPress={handleSaveCircle}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
            <Text style={styles.saveButtonText}>{t('familyCircle.save')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => {
              setShowCreateModal(false);
              resetCreateForm();
            }}
          >
            <Text style={styles.cancelButtonText}>{t('familyCircle.cancel')}</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  const renderAddMemberModal = () => (
    <Modal
      visible={showAddMemberModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        setShowAddMemberModal(false);
        resetMemberForm();
      }}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={() => {
              setShowAddMemberModal(false);
              resetMemberForm();
            }}
          >
            <Ionicons name="close" size={28} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>{t('familyCircle.addMember')}</Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView style={styles.modalBody}>
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('familyCircle.memberName')} *</Text>
            <TextInput
              style={styles.formInput}
              value={formMemberName}
              onChangeText={setFormMemberName}
              placeholder={t('familyCircle.memberName')}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('familyCircle.memberLocation')} *</Text>
            <TextInput
              style={styles.formInput}
              value={formMemberLocation}
              onChangeText={setFormMemberLocation}
              placeholder={t('familyCircle.memberLocation')}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('familyCircle.memberAmount')} *</Text>
            <View style={styles.amountRow}>
              <TextInput
                style={[styles.formInput, { flex: 1 }]}
                value={formMemberAmount}
                onChangeText={setFormMemberAmount}
                placeholder="0.00"
                keyboardType="decimal-pad"
              />
              <View style={styles.currencyPicker}>
                {CURRENCY_VALUES.map((cur) => (
                  <TouchableOpacity
                    key={cur}
                    style={[
                      styles.currencyOption,
                      formMemberCurrency === cur && styles.currencyOptionActive,
                    ]}
                    onPress={() => setFormMemberCurrency(cur)}
                  >
                    <Text
                      style={[
                        styles.currencyOptionText,
                        formMemberCurrency === cur && styles.currencyOptionTextActive,
                      ]}
                    >
                      {cur}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.saveButton} onPress={handleAddMember}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
            <Text style={styles.saveButtonText}>{t('familyCircle.save')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => {
              setShowAddMemberModal(false);
              resetMemberForm();
            }}
          >
            <Text style={styles.cancelButtonText}>{t('familyCircle.cancel')}</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  const renderContributeModal = () => (
    <Modal
      visible={showContributeModal}
      animationType="fade"
      transparent
      onRequestClose={() => {
        setShowContributeModal(false);
        setContributingMember(null);
      }}
    >
      <View style={styles.contributeOverlay}>
        <View style={styles.contributeSheet}>
          <Text style={styles.contributeTitle}>{t('familyCircle.contributeNow')}</Text>
          {contributingMember && (
            <>
              <Text style={styles.contributeMsg}>
                {t('familyCircle.contributeMsg', { name: contributingMember.name })}
              </Text>
              <View style={styles.contributeAmountBox}>
                <Text style={styles.contributeAmountLabel}>{t('familyCircle.contributionAmount')}</Text>
                <Text style={styles.contributeAmountValue}>
                  {contributingMember.currency} {contributingMember.amount}
                </Text>
              </View>
            </>
          )}
          <View style={styles.contributeActions}>
            <TouchableOpacity
              style={styles.contributeCancelBtn}
              onPress={() => {
                setShowContributeModal(false);
                setContributingMember(null);
              }}
            >
              <Text style={styles.contributeCancelText}>{t('familyCircle.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmContributeBtn}
              onPress={handleContribute}
            >
              <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
              <Text style={styles.confirmContributeText}>{t('familyCircle.confirmContribute')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('familyCircle.title')}</Text>
          <Text style={styles.subtitle}>{t('familyCircle.subtitle')}</Text>
        </View>

        {circles.length === 0 ? (
          renderEmptyState()
        ) : (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('familyCircle.title')}</Text>
              <TouchableOpacity style={styles.addButton} onPress={openCreateModal}>
                <Ionicons name="add" size={20} color={COLORS.white} />
                <Text style={styles.addButtonText}>{t('familyCircle.createCircle')}</Text>
              </TouchableOpacity>
            </View>
            {circles.map(renderCircleCard)}
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>

      {circles.length > 0 && (
        <TouchableOpacity style={styles.fab} onPress={openCreateModal}>
          <Ionicons name="add" size={28} color={COLORS.white} />
        </TouchableOpacity>
      )}

      {renderCircleDetailView()}
      {renderCreateEditModal()}
      {renderAddMemberModal()}
      {renderContributeModal()}
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
  circleCard: {
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
  circleAvatar: {
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
  circleName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  beneficiaryLabel: {
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
  detailTextSmall: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  memberAvatars: {
    flexDirection: 'row',
    marginLeft: 'auto',
  },
  miniAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  miniAvatarText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
  },
  progressContainer: {
    marginTop: 4,
    marginBottom: 8,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  progressValue: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '600',
  },
  progressBarBg: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.border,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  progressPercent: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
    marginTop: 4,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
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
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 30,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
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
  emptyListText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingVertical: 20,
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
  detailHeader: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  detailCircleName: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  detailBeneficiaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  detailBeneficiaryText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  progressSection: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  memberCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primary,
  },
  memberInfo: {
    flex: 1,
    marginLeft: 12,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  memberLocation: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  memberDetails: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  memberAmountText: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  memberActions: {
    flexDirection: 'row',
    marginTop: 10,
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
  contributeButton: {
    backgroundColor: COLORS.primary,
  },
  contributeButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
  },
  contributionsList: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 12,
  },
  contributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  contributionInfo: {
    flex: 1,
  },
  contributionName: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  contributionDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  contributionRight: {
    alignItems: 'flex-end',
  },
  contributionAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  contributionStatus: {
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
  contributeOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  contributeSheet: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  contributeTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  contributeMsg: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  contributeAmountBox: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  contributeAmountLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  contributeAmountValue: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.primary,
  },
  contributeActions: {
    flexDirection: 'row',
    gap: 12,
  },
  contributeCancelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.background,
  },
  contributeCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  confirmContributeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    gap: 6,
  },
  confirmContributeText: {
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
  payoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 14,
    marginHorizontal: 16,
    marginTop: 16,
    gap: 8,
  },
  payoutButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },
  bottomPadding: {
    height: 40,
  },
});

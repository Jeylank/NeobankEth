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
import { campaignService } from '../services/firestoreCampaigns';
import { useAuth } from '../hooks/useAuth';
import type { SupportCampaign, CampaignContribution, CampaignCategory } from '../types';

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
  red: '#DC2626',
};

const CATEGORIES: Array<CampaignCategory | 'all'> = ['all', 'medical', 'funeral', 'education', 'emergency'];

const CATEGORY_ICONS: Record<CampaignCategory, keyof typeof Ionicons.glyphMap> = {
  medical: 'medkit',
  funeral: 'flower',
  education: 'school',
  emergency: 'alert-circle',
};

const CATEGORY_COLORS: Record<CampaignCategory, string> = {
  medical: COLORS.red,
  funeral: COLORS.purple,
  education: COLORS.blue,
  emergency: COLORS.orange,
};

const CURRENCY_VALUES = ['USD', 'EUR', 'GBP', 'ETB'];

export default function SupportCampaignsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.uid ?? '';
  const userName = user?.displayName ?? user?.email ?? '';

  const [campaigns, setCampaigns] = useState<SupportCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<CampaignCategory | 'all'>('all');

  const [selectedCampaign, setSelectedCampaign] = useState<SupportCampaign | null>(null);
  const [campaignContributions, setCampaignContributions] = useState<CampaignContribution[]>([]);
  const [loadingContributions, setLoadingContributions] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showContributeModal, setShowContributeModal] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState<CampaignCategory>('medical');
  const [formDescription, setFormDescription] = useState('');
  const [formBeneficiary, setFormBeneficiary] = useState('');
  const [formGoalAmount, setFormGoalAmount] = useState('');
  const [formCurrency, setFormCurrency] = useState('USD');

  const [contributeAmount, setContributeAmount] = useState('');
  const [contributeCurrency, setContributeCurrency] = useState('USD');

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const data = await campaignService.getCampaigns();
      setCampaigns(data);
    } catch (err) {
      console.error('Failed to load campaigns:', err);
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const filteredCampaigns = selectedCategory === 'all'
    ? campaigns
    : campaigns.filter(c => c.category === selectedCategory);

  const loadContributions = useCallback(async (campaignId: string) => {
    setLoadingContributions(true);
    try {
      const data = await campaignService.getContributions(campaignId);
      setCampaignContributions(data);
    } catch (err) {
      console.error('Failed to load contributions:', err);
    } finally {
      setLoadingContributions(false);
    }
  }, []);

  const openCampaignDetail = async (campaign: SupportCampaign) => {
    setSelectedCampaign(campaign);
    await loadContributions(campaign.id);
  };

  const closeCampaignDetail = () => {
    setSelectedCampaign(null);
    setCampaignContributions([]);
  };

  const resetCreateForm = () => {
    setFormTitle('');
    setFormCategory('medical');
    setFormDescription('');
    setFormBeneficiary('');
    setFormGoalAmount('');
    setFormCurrency('USD');
  };

  const openCreateModal = () => {
    resetCreateForm();
    setShowCreateModal(true);
  };

  const handleCreateCampaign = async () => {
    if (!formTitle.trim() || !formDescription.trim() || !formBeneficiary.trim() || !formGoalAmount.trim()) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }
    const goal = parseFloat(formGoalAmount);
    if (isNaN(goal) || goal <= 0) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }

    setProcessing(true);
    try {
      await campaignService.createCampaign({
        creatorId: userId,
        title: formTitle.trim(),
        description: formDescription.trim(),
        category: formCategory,
        beneficiary: formBeneficiary.trim(),
        goalAmount: goal,
        currency: formCurrency,
      });
      Alert.alert(t('common.success'), t('supportCampaign.campaignCreated'));
      setShowCreateModal(false);
      resetCreateForm();
      await loadData();
    } catch (err) {
      Alert.alert(t('common.error'), t('common.error'));
    } finally {
      setProcessing(false);
    }
  };

  const openContributeModal = () => {
    setContributeAmount('');
    setContributeCurrency(selectedCampaign?.currency || 'USD');
    setShowContributeModal(true);
  };

  const handleContribute = async () => {
    if (!selectedCampaign) return;
    if (!contributeAmount.trim()) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }
    const amount = parseFloat(contributeAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }

    setProcessing(true);
    try {
      const result = await campaignService.contribute({
        campaignId: selectedCampaign.id,
        userId,
        userName,
        amount,
        currency: contributeCurrency,
      });

      if (result.status === 'sent') {
        Alert.alert(t('common.success'), t('supportCampaign.contributionSuccess'));
      } else {
        Alert.alert(t('common.error'), t('supportCampaign.contributionFailed'));
      }

      setShowContributeModal(false);
      setContributeAmount('');

      const updated = await campaignService.getCampaignById(selectedCampaign.id);
      if (updated) {
        setSelectedCampaign(updated);
        if (updated.status === 'completed') {
          Alert.alert(t('common.success'), t('supportCampaign.goalReached'));
        }
      }
      await loadContributions(selectedCampaign.id);
      await loadData();
    } catch (err) {
      Alert.alert(t('common.error'), t('supportCampaign.contributionFailed'));
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelCampaign = () => {
    if (!selectedCampaign) return;
    Alert.alert(
      t('supportCampaign.cancelCampaign'),
      t('supportCampaign.confirmCancel'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('supportCampaign.cancel'),
          style: 'destructive',
          onPress: async () => {
            try {
              await campaignService.cancelCampaign(selectedCampaign.id);
              Alert.alert(t('common.success'), t('supportCampaign.campaignCancelled'));
              closeCampaignDetail();
              await loadData();
            } catch (err) {
              Alert.alert(t('common.error'), t('common.error'));
            }
          },
        },
      ]
    );
  };

  const getProgressPercent = (campaign: SupportCampaign) => {
    if (campaign.goalAmount <= 0) return 0;
    return Math.min((campaign.raisedAmount / campaign.goalAmount) * 100, 100);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getTimeSince = (dateStr: string) => {
    const now = new Date();
    const created = new Date(dateStr);
    const diffMs = now.getTime() - created.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return t('supportCampaign.today');
    if (diffDays === 1) return t('supportCampaign.oneDayAgo');
    if (diffDays < 30) return t('supportCampaign.daysAgo', { count: diffDays });
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths === 1) return t('supportCampaign.oneMonthAgo');
    return t('supportCampaign.monthsAgo', { count: diffMonths });
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

  const renderCategoryPills = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.pillsContainer}
    >
      {CATEGORIES.map((cat) => {
        const isActive = selectedCategory === cat;
        return (
          <TouchableOpacity
            key={cat}
            style={[styles.pillOption, isActive && styles.pillOptionActive]}
            onPress={() => setSelectedCategory(cat)}
          >
            {cat !== 'all' && (
              <Ionicons
                name={CATEGORY_ICONS[cat]}
                size={14}
                color={isActive ? COLORS.white : CATEGORY_COLORS[cat]}
                style={{ marginRight: 4 }}
              />
            )}
            <Text style={[styles.pillOptionText, isActive && styles.pillOptionTextActive]}>
              {t(`supportCampaign.${cat}`)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="heart-outline" size={64} color={COLORS.textSecondary} />
      </View>
      <Text style={styles.emptyTitle}>{t('supportCampaign.noCampaigns')}</Text>
      <Text style={styles.emptyMessage}>{t('supportCampaign.emptyMessage')}</Text>
      <TouchableOpacity style={styles.emptyAddButton} onPress={openCreateModal}>
        <Ionicons name="add-circle" size={22} color={COLORS.white} />
        <Text style={styles.emptyAddButtonText}>{t('supportCampaign.createCampaign')}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderCampaignCard = (campaign: SupportCampaign) => {
    const progress = getProgressPercent(campaign);
    const catColor = CATEGORY_COLORS[campaign.category];
    const catIcon = CATEGORY_ICONS[campaign.category];

    return (
      <TouchableOpacity
        key={campaign.id}
        style={styles.campaignCard}
        onPress={() => openCampaignDetail(campaign)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.categoryAvatar, { backgroundColor: catColor + '20' }]}>
            <Ionicons name={catIcon} size={24} color={catColor} />
          </View>
          <View style={styles.cardHeaderInfo}>
            <Text style={styles.campaignTitle} numberOfLines={1}>{campaign.title}</Text>
            <Text style={styles.beneficiaryLabel}>
              {t('supportCampaign.beneficiary')}: {campaign.beneficiary}
            </Text>
          </View>
          <View style={[styles.categoryBadge, { backgroundColor: catColor + '20' }]}>
            <Text style={[styles.categoryBadgeText, { color: catColor }]}>
              {t(`supportCampaign.${campaign.category}`)}
            </Text>
          </View>
        </View>

        <View style={styles.cardDetails}>
          <View style={styles.progressContainer}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>
                {campaign.currency} {campaign.raisedAmount} {t('supportCampaign.of')} {campaign.currency} {campaign.goalAmount}
              </Text>
              <Text style={styles.progressPercent}>{Math.round(progress)}%</Text>
            </View>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${progress}%`, backgroundColor: catColor }]} />
            </View>
          </View>

          <View style={styles.cardFooter}>
            <View style={styles.detailRow}>
              <Ionicons name="people-outline" size={14} color={COLORS.textSecondary} />
              <Text style={styles.detailTextSmall}>
                {campaign.contributorCount} {t('supportCampaign.contributors')}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
              <Text style={styles.detailTextSmall}>{getTimeSince(campaign.createdAt)}</Text>
            </View>
            <View style={[styles.statusBadge, {
              backgroundColor: campaign.status === 'active' ? COLORS.success + '20' :
                campaign.status === 'completed' ? COLORS.blue + '20' : COLORS.error + '20'
            }]}>
              <Text style={[styles.statusText, {
                color: campaign.status === 'active' ? COLORS.success :
                  campaign.status === 'completed' ? COLORS.blue : COLORS.error
              }]}>
                {t(`supportCampaign.${campaign.status}`)}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderCampaignDetailModal = () => {
    if (!selectedCampaign) return null;
    const progress = getProgressPercent(selectedCampaign);
    const catColor = CATEGORY_COLORS[selectedCampaign.category];
    const catIcon = CATEGORY_ICONS[selectedCampaign.category];
    const isCreator = selectedCampaign.creatorId === userId;

    return (
      <Modal
        visible={!!selectedCampaign}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeCampaignDetail}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeCampaignDetail}>
              <Ionicons name="arrow-back" size={28} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{t('supportCampaign.viewDetails')}</Text>
            <View style={{ width: 28 }} />
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.detailHeaderSection}>
              <Text style={styles.detailCampaignTitle}>{selectedCampaign.title}</Text>
              <View style={styles.detailCategoryRow}>
                <View style={[styles.categoryBadge, { backgroundColor: catColor + '20' }]}>
                  <Ionicons name={catIcon} size={14} color={catColor} style={{ marginRight: 4 }} />
                  <Text style={[styles.categoryBadgeText, { color: catColor }]}>
                    {t(`supportCampaign.${selectedCampaign.category}`)}
                  </Text>
                </View>
                <View style={[styles.statusBadge, {
                  backgroundColor: selectedCampaign.status === 'active' ? COLORS.success + '20' :
                    selectedCampaign.status === 'completed' ? COLORS.blue + '20' : COLORS.error + '20'
                }]}>
                  <Text style={[styles.statusText, {
                    color: selectedCampaign.status === 'active' ? COLORS.success :
                      selectedCampaign.status === 'completed' ? COLORS.blue : COLORS.error
                  }]}>
                    {t(`supportCampaign.${selectedCampaign.status}`)}
                  </Text>
                </View>
              </View>
              <Text style={styles.detailCreatorText}>
                {t('supportCampaign.createdBy')}: {selectedCampaign.creatorId === userId ? userName : selectedCampaign.creatorId}
              </Text>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.sectionTitle}>{t('supportCampaign.beneficiary')}</Text>
              <View style={styles.beneficiaryInfoCard}>
                <Ionicons name="person-outline" size={20} color={COLORS.primary} />
                <Text style={styles.beneficiaryInfoText}>{selectedCampaign.beneficiary}</Text>
              </View>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.sectionTitle}>{t('supportCampaign.progress')}</Text>
              <View style={styles.largeProgressCard}>
                <View style={styles.progressAmountsRow}>
                  <View>
                    <Text style={styles.progressAmountLabel}>{t('supportCampaign.raised')}</Text>
                    <Text style={[styles.progressAmountValue, { color: COLORS.success }]}>
                      {selectedCampaign.currency} {selectedCampaign.raisedAmount}
                    </Text>
                  </View>
                  <View style={styles.progressAmountDivider} />
                  <View>
                    <Text style={styles.progressAmountLabel}>{t('supportCampaign.goal')}</Text>
                    <Text style={[styles.progressAmountValue, { color: COLORS.primary }]}>
                      {selectedCampaign.currency} {selectedCampaign.goalAmount}
                    </Text>
                  </View>
                </View>
                <View style={styles.largeProgressBarBg}>
                  <View style={[styles.largeProgressBarFill, { width: `${progress}%`, backgroundColor: catColor }]} />
                </View>
                <Text style={styles.largeProgressPercent}>
                  {t('supportCampaign.percentage')}: {Math.round(progress)}%
                </Text>
                <Text style={styles.contributorCountText}>
                  {selectedCampaign.contributorCount} {t('supportCampaign.contributors')}
                </Text>
              </View>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.sectionTitle}>{t('supportCampaign.description')}</Text>
              <Text style={styles.descriptionText}>{selectedCampaign.description}</Text>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.sectionTitle}>{t('supportCampaign.recentContributors')}</Text>
              {loadingContributions ? (
                <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: 12 }} />
              ) : campaignContributions.length === 0 ? (
                <Text style={styles.noContributorsText}>{t('supportCampaign.noContributors')}</Text>
              ) : (
                campaignContributions.map((contrib) => (
                  <View key={contrib.id} style={styles.contributorRow}>
                    <View style={styles.contributorAvatar}>
                      <Text style={styles.contributorAvatarText}>
                        {contrib.userName.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.contributorInfo}>
                      <Text style={styles.contributorName}>{contrib.userName}</Text>
                      <Text style={styles.contributorDate}>{formatDate(contrib.createdAt)}</Text>
                    </View>
                    <View style={styles.contributorRight}>
                      <Text style={styles.contributorAmount}>
                        {contrib.currency} {contrib.amount}
                      </Text>
                      <Text style={[styles.contributorStatus, {
                        color: contrib.status === 'sent' ? COLORS.success :
                          contrib.status === 'failed' ? COLORS.error : COLORS.amber
                      }]}>
                        {t(`supportCampaign.${contrib.status}`)}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            {selectedCampaign.status === 'active' && (
              <TouchableOpacity style={styles.contributeButton} onPress={openContributeModal}>
                <Ionicons name="heart" size={20} color={COLORS.white} />
                <Text style={styles.contributeButtonText}>{t('supportCampaign.contributeNow')}</Text>
              </TouchableOpacity>
            )}

            {isCreator && selectedCampaign.status === 'active' && (
              <TouchableOpacity style={styles.cancelCampaignButton} onPress={handleCancelCampaign}>
                <Ionicons name="close-circle-outline" size={18} color={COLORS.error} />
                <Text style={styles.cancelCampaignButtonText}>{t('supportCampaign.cancelCampaign')}</Text>
              </TouchableOpacity>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    );
  };

  const renderCreateModal = () => (
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
          <TouchableOpacity onPress={() => { setShowCreateModal(false); resetCreateForm(); }}>
            <Ionicons name="close" size={28} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>{t('supportCampaign.createCampaign')}</Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView style={styles.modalBody}>
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('supportCampaign.campaignTitle')} *</Text>
            <TextInput
              style={styles.formInput}
              value={formTitle}
              onChangeText={setFormTitle}
              placeholder={t('supportCampaign.titlePlaceholder')}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('supportCampaign.category')}</Text>
            <View style={styles.pickerRow}>
              {(['medical', 'funeral', 'education', 'emergency'] as CampaignCategory[]).map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.categoryPickerOption, formCategory === cat && { backgroundColor: CATEGORY_COLORS[cat], borderColor: CATEGORY_COLORS[cat] }]}
                  onPress={() => setFormCategory(cat)}
                >
                  <Ionicons
                    name={CATEGORY_ICONS[cat]}
                    size={16}
                    color={formCategory === cat ? COLORS.white : CATEGORY_COLORS[cat]}
                  />
                  <Text style={[styles.pickerOptionText, formCategory === cat && styles.pickerOptionTextActive]}>
                    {t(`supportCampaign.${cat}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('supportCampaign.description')} *</Text>
            <TextInput
              style={[styles.formInput, styles.formTextArea]}
              value={formDescription}
              onChangeText={setFormDescription}
              placeholder={t('supportCampaign.descriptionPlaceholder')}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('supportCampaign.beneficiary')} *</Text>
            <TextInput
              style={styles.formInput}
              value={formBeneficiary}
              onChangeText={setFormBeneficiary}
              placeholder={t('supportCampaign.beneficiaryPlaceholder')}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('supportCampaign.goalAmount')} *</Text>
            <View style={styles.amountRow}>
              <TextInput
                style={[styles.formInput, { flex: 1 }]}
                value={formGoalAmount}
                onChangeText={setFormGoalAmount}
                placeholder={t('supportCampaign.goalPlaceholder')}
                keyboardType="numeric"
              />
              <View style={styles.currencyPicker}>
                {CURRENCY_VALUES.map((cur) => (
                  <TouchableOpacity
                    key={cur}
                    style={[styles.currencyOption, formCurrency === cur && styles.currencyOptionActive]}
                    onPress={() => setFormCurrency(cur)}
                  >
                    <Text style={[styles.currencyOptionText, formCurrency === cur && styles.currencyOptionTextActive]}>
                      {cur}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.saveButton, processing && styles.saveButtonDisabled]}
            onPress={handleCreateCampaign}
            disabled={processing}
          >
            {processing ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
            )}
            <Text style={styles.saveButtonText}>{t('supportCampaign.createCampaign')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => { setShowCreateModal(false); resetCreateForm(); }}
          >
            <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  const renderContributeModal = () => {
    if (!selectedCampaign) return null;
    const progress = getProgressPercent(selectedCampaign);

    return (
      <Modal
        visible={showContributeModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowContributeModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowContributeModal(false)}>
              <Ionicons name="close" size={28} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{t('supportCampaign.contribute')}</Text>
            <View style={{ width: 28 }} />
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.contributeInfoCard}>
              <Text style={styles.contributeInfoTitle}>{selectedCampaign.title}</Text>
              <View style={styles.contributeProgressRow}>
                <Text style={styles.contributeProgressText}>
                  {selectedCampaign.currency} {selectedCampaign.raisedAmount} {t('supportCampaign.of')} {selectedCampaign.currency} {selectedCampaign.goalAmount}
                </Text>
                <Text style={styles.contributeProgressPercent}>{Math.round(progress)}%</Text>
              </View>
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${progress}%`, backgroundColor: CATEGORY_COLORS[selectedCampaign.category] }]} />
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('supportCampaign.amount')} *</Text>
              <View style={styles.amountRow}>
                <TextInput
                  style={[styles.formInput, { flex: 1 }]}
                  value={contributeAmount}
                  onChangeText={setContributeAmount}
                  placeholder={t('supportCampaign.amountPlaceholder')}
                  keyboardType="numeric"
                />
                <View style={styles.currencyPicker}>
                  {CURRENCY_VALUES.map((cur) => (
                    <TouchableOpacity
                      key={cur}
                      style={[styles.currencyOption, contributeCurrency === cur && styles.currencyOptionActive]}
                      onPress={() => setContributeCurrency(cur)}
                    >
                      <Text style={[styles.currencyOptionText, contributeCurrency === cur && styles.currencyOptionTextActive]}>
                        {cur}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.contributeButton, processing && styles.saveButtonDisabled]}
              onPress={handleContribute}
              disabled={processing}
            >
              {processing ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Ionicons name="heart" size={20} color={COLORS.white} />
              )}
              <Text style={styles.contributeButtonText}>{t('supportCampaign.confirmContribute')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowContributeModal(false)}
            >
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('supportCampaign.title')}</Text>
          <Text style={styles.subtitle}>{t('supportCampaign.subtitle')}</Text>
        </View>

        {renderCategoryPills()}

        {filteredCampaigns.length === 0 ? (
          renderEmptyState()
        ) : (
          <View style={styles.campaignList}>
            {filteredCampaigns.map(renderCampaignCard)}
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={openCreateModal} activeOpacity={0.8}>
        <Ionicons name="add" size={28} color={COLORS.white} />
      </TouchableOpacity>

      {renderCampaignDetailModal()}
      {renderCreateModal()}
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
  pillsContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  pillOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
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
  campaignList: {
    paddingHorizontal: 16,
  },
  campaignCard: {
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
  categoryAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderInfo: {
    flex: 1,
    marginLeft: 12,
  },
  campaignTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  beneficiaryLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardDetails: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  progressContainer: {
    marginBottom: 10,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  progressPercent: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailTextSmall: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
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
    elevation: 6,
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
  detailHeaderSection: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  detailCampaignTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  detailCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  detailCreatorText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  detailSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  beneficiaryInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  beneficiaryInfoText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  largeProgressCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
  },
  progressAmountsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  progressAmountLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 4,
    textAlign: 'center',
  },
  progressAmountValue: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  progressAmountDivider: {
    width: 1,
    backgroundColor: COLORS.border,
  },
  largeProgressBarBg: {
    height: 12,
    backgroundColor: COLORS.border,
    borderRadius: 6,
    overflow: 'hidden',
  },
  largeProgressBarFill: {
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
  },
  largeProgressPercent: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
    textAlign: 'center',
    marginTop: 8,
  },
  contributorCountText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  descriptionText: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 22,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
  },
  noContributorsText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingVertical: 20,
  },
  contributorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  contributorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contributorAvatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  contributorInfo: {
    flex: 1,
  },
  contributorName: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  contributorDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  contributorRight: {
    alignItems: 'flex-end',
  },
  contributorAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  contributorStatus: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  contributeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
  },
  contributeButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  cancelCampaignButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 8,
    gap: 6,
  },
  cancelCampaignButtonText: {
    color: COLORS.error,
    fontSize: 15,
    fontWeight: '500',
  },
  contributeInfoCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  contributeInfoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  contributeProgressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  contributeProgressText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  contributeProgressPercent: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
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
    minHeight: 100,
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
    paddingHorizontal: 10,
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
    fontSize: 13,
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
  categoryPickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
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
  saveButtonDisabled: {
    opacity: 0.7,
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
    height: 80,
  },
});

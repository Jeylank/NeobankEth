import React, { useState, useCallback, useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
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
import { walletService } from '../services/walletService';
import { useAuth } from '../hooks/useAuth';
import type { Wallet, LedgerEntry, WalletCurrency, LedgerCategory } from '../types';

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
  cyan: '#06B6D4',
  orange: '#F97316',
};

const CURRENCIES: WalletCurrency[] = ['EUR', 'USD', 'GBP'];

const CURRENCY_SYMBOLS: Record<WalletCurrency, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
};

const CURRENCY_COLORS: Record<WalletCurrency, string> = {
  EUR: COLORS.blue,
  USD: COLORS.success,
  GBP: COLORS.purple,
};

const CATEGORY_I18N: Record<LedgerCategory, string> = {
  TOPUP: 'wallet.topup',
  REMITTANCE: 'wallet.remittance',
  BILL_PAYMENT: 'wallet.billPayment',
  CAMPAIGN: 'wallet.campaign',
  FAMILY_TRANSFER: 'wallet.familyTransfer',
  CONVERSION: 'wallet.conversion',
};

type ActivityFilter = 'ALL' | 'TOPUP' | 'REMITTANCE' | 'BILL_PAYMENT' | 'CAMPAIGN' | 'CONVERSION';

const ACTIVITY_FILTERS: { key: ActivityFilter; labelKey: string }[] = [
  { key: 'ALL', labelKey: 'wallet.filterAll' },
  { key: 'TOPUP', labelKey: 'wallet.filterTopups' },
  { key: 'REMITTANCE', labelKey: 'wallet.filterTransfers' },
  { key: 'BILL_PAYMENT', labelKey: 'wallet.filterBills' },
  { key: 'CAMPAIGN', labelKey: 'wallet.filterCampaigns' },
  { key: 'CONVERSION', labelKey: 'wallet.filterConversions' },
];

const PAYMENT_METHODS = ['card', 'chapa', 'telebirr'] as const;

export default function WalletScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.uid ?? '';
  const navigation = useNavigation<any>();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [showAddMoneyModal, setShowAddMoneyModal] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);

  const [addCurrency, setAddCurrency] = useState<WalletCurrency>('EUR');
  const [addAmount, setAddAmount] = useState('');
  const [addMethod, setAddMethod] = useState<typeof PAYMENT_METHODS[number]>('card');

  const [convertFrom, setConvertFrom] = useState<WalletCurrency>('EUR');
  const [convertTo, setConvertTo] = useState<WalletCurrency>('USD');
  const [convertAmount, setConvertAmount] = useState('');
  const [convertRate, setConvertRate] = useState<number>(0);
  const [convertFee, setConvertFee] = useState<number>(0);
  const [convertReceive, setConvertReceive] = useState<number>(0);
  const [loadingRate, setLoadingRate] = useState(false);

  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('ALL');
  const [allEntries, setAllEntries] = useState<LedgerEntry[]>([]);

  const loadData = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      let w = await walletService.getWallet(userId);
      if (!w) {
        w = await walletService.createWallet(userId);
      }
      setWallet(w);
      const e = await walletService.getWalletActivity(userId, 10);
      setEntries(e);
    } catch (err: any) {
      console.error('Failed to load wallet data:', err);
      if (err?.message !== 'OFFLINE') {
        setError(t('common.error'));
      }
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

  const getTotalBalance = (): { amount: number; currency: WalletCurrency } => {
    if (!wallet) return { amount: 0, currency: 'EUR' };
    const dc = wallet.defaultCurrency;
    let total = wallet.balances[dc];
    for (const cur of CURRENCIES) {
      if (cur !== dc) {
        const rate = cur === 'EUR' && dc === 'USD' ? 1.08
          : cur === 'EUR' && dc === 'GBP' ? 0.86
          : cur === 'USD' && dc === 'EUR' ? 0.93
          : cur === 'USD' && dc === 'GBP' ? 0.79
          : cur === 'GBP' && dc === 'EUR' ? 1.16
          : cur === 'GBP' && dc === 'USD' ? 1.27
          : 1;
        total += wallet.balances[cur] * rate;
      }
    }
    return { amount: Math.round(total * 100) / 100, currency: dc };
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleAddMoney = async () => {
    if (!addAmount.trim()) {
      Alert.alert(t('common.error'), t('wallet.enterAmount'));
      return;
    }
    const amount = parseFloat(addAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert(t('common.error'), t('wallet.enterAmount'));
      return;
    }

    setProcessing(true);
    try {
      await walletService.creditWallet(userId, addCurrency, amount, 'TOPUP', addMethod);
      Alert.alert(t('common.success'), t('wallet.topUpSuccess'));
      setShowAddMoneyModal(false);
      setAddAmount('');
      await loadData();
    } catch (err) {
      Alert.alert(t('common.error'), t('wallet.topUpFailed'));
    } finally {
      setProcessing(false);
    }
  };

  const fetchRate = useCallback(async (from: WalletCurrency, to: WalletCurrency, amount: string) => {
    if (from === to) {
      setConvertRate(1);
      setConvertFee(0);
      setConvertReceive(parseFloat(amount) || 0);
      return;
    }
    setLoadingRate(true);
    try {
      const rate = await walletService.getExchangeRate(from, to);
      setConvertRate(rate);
      const amt = parseFloat(amount) || 0;
      const fee = Math.round(amt * 0.015 * 100) / 100;
      const receive = Math.round((amt - fee) * rate * 100) / 100;
      setConvertFee(fee);
      setConvertReceive(receive > 0 ? receive : 0);
    } catch {
      setConvertRate(0);
      setConvertFee(0);
      setConvertReceive(0);
    } finally {
      setLoadingRate(false);
    }
  }, []);

  useEffect(() => {
    if (showConvertModal && convertAmount) {
      fetchRate(convertFrom, convertTo, convertAmount);
    }
  }, [showConvertModal, convertFrom, convertTo, convertAmount, fetchRate]);

  const handleConvert = async () => {
    if (!convertAmount.trim()) {
      Alert.alert(t('common.error'), t('wallet.enterAmount'));
      return;
    }
    const amount = parseFloat(convertAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert(t('common.error'), t('wallet.enterAmount'));
      return;
    }
    if (convertFrom === convertTo) {
      return;
    }
    if (wallet && wallet.balances[convertFrom] < amount) {
      Alert.alert(t('common.error'), t('wallet.insufficientBalance'));
      return;
    }

    setProcessing(true);
    try {
      await walletService.convertCurrency(userId, convertFrom, convertTo, amount);
      Alert.alert(t('common.success'), t('wallet.conversionSuccess'));
      setShowConvertModal(false);
      setConvertAmount('');
      await loadData();
    } catch (err: any) {
      if (err?.message === 'Insufficient balance') {
        Alert.alert(t('common.error'), t('wallet.insufficientBalance'));
      } else {
        Alert.alert(t('common.error'), t('wallet.conversionFailed'));
      }
    } finally {
      setProcessing(false);
    }
  };

  const openActivityModal = async () => {
    setActivityFilter('ALL');
    try {
      const all = await walletService.getWalletActivity(userId, 50);
      setAllEntries(all);
    } catch {
      setAllEntries([]);
    }
    setShowActivityModal(true);
  };

  const getFilteredEntries = () => {
    if (activityFilter === 'ALL') return allEntries;
    return allEntries.filter((e) => e.category === activityFilter);
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

  const totalBal = getTotalBalance();

  const renderEntryRow = (entry: LedgerEntry) => {
    const isCredit = entry.type === 'CREDIT';
    const iconName = isCredit ? 'arrow-down' : 'arrow-up';
    const iconColor = isCredit ? COLORS.success : COLORS.error;
    const sign = isCredit ? '+' : '-';
    const statusColor = entry.status === 'POSTED' ? COLORS.success
      : entry.status === 'RESERVED' ? COLORS.warning
      : COLORS.textSecondary;

    return (
      <View key={entry.entryId} style={styles.entryRow}>
        <View style={[styles.entryIcon, { backgroundColor: iconColor + '15' }]}>
          <Ionicons name={iconName} size={20} color={iconColor} />
        </View>
        <View style={styles.entryInfo}>
          <Text style={styles.entryCategory}>{t(CATEGORY_I18N[entry.category])}</Text>
          <Text style={styles.entryDate}>{formatDate(entry.createdAt)}</Text>
        </View>
        <View style={styles.entryRight}>
          <Text style={[styles.entryAmount, { color: iconColor }]}>
            {sign}{CURRENCY_SYMBOLS[entry.currency]}{entry.amount.toFixed(2)}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {t(`wallet.${entry.status.toLowerCase()}`)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderAddMoneyModal = () => (
    <Modal
      visible={showAddMoneyModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowAddMoneyModal(false)}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setShowAddMoneyModal(false)}>
            <Ionicons name="close" size={28} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>{t('wallet.addMoney')}</Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView style={styles.modalBody}>
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('wallet.selectCurrency')}</Text>
            <View style={styles.optionRow}>
              {CURRENCIES.map((cur) => (
                <TouchableOpacity
                  key={cur}
                  style={[styles.optionButton, addCurrency === cur && styles.optionButtonActive]}
                  onPress={() => setAddCurrency(cur)}
                >
                  <Text style={[styles.optionButtonText, addCurrency === cur && styles.optionButtonTextActive]}>
                    {CURRENCY_SYMBOLS[cur]} {t(`wallet.${cur.toLowerCase()}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('wallet.enterAmount')}</Text>
            <TextInput
              style={styles.formInput}
              value={addAmount}
              onChangeText={setAddAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
              placeholderTextColor={COLORS.textSecondary}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('wallet.paymentMethod')}</Text>
            {PAYMENT_METHODS.map((method) => (
              <TouchableOpacity
                key={method}
                style={[styles.methodOption, addMethod === method && styles.methodOptionActive]}
                onPress={() => setAddMethod(method)}
              >
                <Ionicons
                  name={method === 'card' ? 'card-outline' : method === 'chapa' ? 'cash-outline' : 'phone-portrait-outline'}
                  size={20}
                  color={addMethod === method ? COLORS.primary : COLORS.textSecondary}
                />
                <Text style={[styles.methodOptionText, addMethod === method && styles.methodOptionTextActive]}>
                  {t(`wallet.${method}`)}
                </Text>
                <View style={[styles.radioOuter, addMethod === method && styles.radioOuterActive]}>
                  {addMethod === method && <View style={styles.radioInner} />}
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.confirmButton, processing && styles.confirmButtonDisabled]}
            onPress={handleAddMoney}
            disabled={processing}
          >
            {processing ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
                <Text style={styles.confirmButtonText}>{t('wallet.confirmTopUp')}</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  const renderConvertModal = () => (
    <Modal
      visible={showConvertModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowConvertModal(false)}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setShowConvertModal(false)}>
            <Ionicons name="close" size={28} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>{t('wallet.convert')}</Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView style={styles.modalBody}>
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('wallet.fromCurrency')}</Text>
            <View style={styles.optionRow}>
              {CURRENCIES.map((cur) => (
                <TouchableOpacity
                  key={cur}
                  style={[styles.optionButton, convertFrom === cur && styles.optionButtonActive]}
                  onPress={() => setConvertFrom(cur)}
                >
                  <Text style={[styles.optionButtonText, convertFrom === cur && styles.optionButtonTextActive]}>
                    {CURRENCY_SYMBOLS[cur]} {t(`wallet.${cur.toLowerCase()}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {wallet && (
              <Text style={styles.balanceHint}>
                {t('wallet.availableBalance')}: {CURRENCY_SYMBOLS[convertFrom]}{wallet.balances[convertFrom].toFixed(2)}
              </Text>
            )}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('wallet.toCurrency')}</Text>
            <View style={styles.optionRow}>
              {CURRENCIES.filter((c) => c !== convertFrom).map((cur) => (
                <TouchableOpacity
                  key={cur}
                  style={[styles.optionButton, convertTo === cur && styles.optionButtonActive]}
                  onPress={() => setConvertTo(cur)}
                >
                  <Text style={[styles.optionButtonText, convertTo === cur && styles.optionButtonTextActive]}>
                    {CURRENCY_SYMBOLS[cur]} {t(`wallet.${cur.toLowerCase()}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('wallet.enterAmount')}</Text>
            <TextInput
              style={styles.formInput}
              value={convertAmount}
              onChangeText={setConvertAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
              placeholderTextColor={COLORS.textSecondary}
            />
          </View>

          {convertAmount ? (
            <View style={styles.conversionSummary}>
              {loadingRate ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{t('wallet.exchangeRate')}</Text>
                    <Text style={styles.summaryValue}>
                      1 {convertFrom} = {convertRate.toFixed(4)} {convertTo}
                    </Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{t('wallet.fee')}</Text>
                    <Text style={styles.summaryValue}>
                      {CURRENCY_SYMBOLS[convertFrom]}{convertFee.toFixed(2)}
                    </Text>
                  </View>
                  <View style={[styles.summaryRow, styles.summaryRowHighlight]}>
                    <Text style={styles.summaryLabelBold}>{t('wallet.youWillReceive')}</Text>
                    <Text style={styles.summaryValueBold}>
                      {CURRENCY_SYMBOLS[convertTo]}{convertReceive.toFixed(2)}
                    </Text>
                  </View>
                </>
              )}
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.confirmButton, processing && styles.confirmButtonDisabled]}
            onPress={handleConvert}
            disabled={processing}
          >
            {processing ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="swap-horizontal" size={20} color={COLORS.white} />
                <Text style={styles.confirmButtonText}>{t('wallet.confirmConversion')}</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  const renderActivityModal = () => {
    const filtered = getFilteredEntries();

    return (
      <Modal
        visible={showActivityModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowActivityModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowActivityModal(false)}>
              <Ionicons name="arrow-back" size={28} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{t('wallet.allActivity')}</Text>
            <View style={{ width: 28 }} />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {ACTIVITY_FILTERS.map((f) => {
              const isActive = activityFilter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.filterPill, isActive && styles.filterPillActive]}
                  onPress={() => setActivityFilter(f.key)}
                >
                  <Text style={[styles.filterPillText, isActive && styles.filterPillTextActive]}>
                    {t(f.labelKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <ScrollView style={styles.modalBody}>
            {filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="receipt-outline" size={48} color={COLORS.textSecondary} />
                <Text style={styles.emptyTitle}>{t('wallet.noActivity')}</Text>
                <Text style={styles.emptyMessage}>{t('wallet.emptyActivityMessage')}</Text>
              </View>
            ) : (
              filtered.map(renderEntryRow)
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('wallet.title')}</Text>
        <Text style={styles.headerSubtitle}>{t('wallet.subtitle')}</Text>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}
      >
        <View style={styles.totalBalanceCard}>
          <Text style={styles.totalBalanceLabel}>{t('wallet.totalBalance')}</Text>
          <Text style={styles.totalBalanceAmount}>
            {CURRENCY_SYMBOLS[totalBal.currency]}{totalBal.amount.toFixed(2)}
          </Text>
          <Text style={styles.totalBalanceCurrency}>{t(`wallet.${totalBal.currency.toLowerCase()}Name`)}</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.currencyCardsRow}
        >
          {CURRENCIES.map((cur) => {
            const balance = wallet?.balances[cur] ?? 0;
            const reserved = wallet?.reservations[cur] ?? 0;
            const curColor = CURRENCY_COLORS[cur];

            return (
              <View key={cur} style={[styles.currencyCard, { borderTopColor: curColor }]}>
                <View style={styles.currencyCardHeader}>
                  <View style={[styles.currencyIcon, { backgroundColor: curColor + '15' }]}>
                    <Text style={[styles.currencyIconText, { color: curColor }]}>{CURRENCY_SYMBOLS[cur]}</Text>
                  </View>
                  <Text style={styles.currencyName}>{t(`wallet.${cur.toLowerCase()}Name`)}</Text>
                </View>
                <Text style={styles.currencyBalance}>
                  {CURRENCY_SYMBOLS[cur]}{balance.toFixed(2)}
                </Text>
                <View style={styles.currencyDetails}>
                  <View style={styles.currencyDetailRow}>
                    <Text style={styles.currencyDetailLabel}>{t('wallet.availableBalance')}</Text>
                    <Text style={styles.currencyDetailValue}>{CURRENCY_SYMBOLS[cur]}{balance.toFixed(2)}</Text>
                  </View>
                  <View style={styles.currencyDetailRow}>
                    <Text style={styles.currencyDetailLabel}>{t('wallet.reservedBalance')}</Text>
                    <Text style={styles.currencyDetailValue}>{CURRENCY_SYMBOLS[cur]}{reserved.toFixed(2)}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.quickActionsContainer}>
          <TouchableOpacity style={styles.quickAction} onPress={() => navigation.navigate('FundingMethod')}>
            <View style={[styles.quickActionIcon, { backgroundColor: COLORS.success + '15' }]}>
              <Ionicons name="add-circle-outline" size={24} color={COLORS.success} />
            </View>
            <Text style={styles.quickActionText}>{t('wallet.addMoney')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickAction} onPress={() => Alert.alert(t('wallet.send'))}>
            <View style={[styles.quickActionIcon, { backgroundColor: COLORS.blue + '15' }]}>
              <Ionicons name="send-outline" size={24} color={COLORS.blue} />
            </View>
            <Text style={styles.quickActionText}>{t('wallet.send')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickAction} onPress={() => { setConvertAmount(''); setShowConvertModal(true); }}>
            <View style={[styles.quickActionIcon, { backgroundColor: COLORS.purple + '15' }]}>
              <Ionicons name="swap-horizontal-outline" size={24} color={COLORS.purple} />
            </View>
            <Text style={styles.quickActionText}>{t('wallet.convert')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickAction} onPress={openActivityModal}>
            <View style={[styles.quickActionIcon, { backgroundColor: COLORS.orange + '15' }]}>
              <Ionicons name="receipt-outline" size={24} color={COLORS.orange} />
            </View>
            <Text style={styles.quickActionText}>{t('wallet.viewActivity')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.recentSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('wallet.recentActivity')}</Text>
            <TouchableOpacity onPress={openActivityModal}>
              <Text style={styles.seeAllText}>{t('common.seeAll')}</Text>
            </TouchableOpacity>
          </View>

          {entries.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="receipt-outline" size={48} color={COLORS.textSecondary} />
              <Text style={styles.emptyTitle}>{t('wallet.noActivity')}</Text>
              <Text style={styles.emptyMessage}>{t('wallet.emptyActivityMessage')}</Text>
            </View>
          ) : (
            entries.map(renderEntryRow)
          )}
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>

      {renderAddMoneyModal()}
      {renderConvertModal()}
      {renderActivityModal()}
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
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    fontSize: 16,
    color: COLORS.error,
    textAlign: 'center',
    marginTop: 8,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
    marginTop: 12,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.white,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.white + 'CC',
    marginTop: 4,
  },
  content: {
    flex: 1,
  },
  totalBalanceCard: {
    backgroundColor: COLORS.primary,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  totalBalanceLabel: {
    fontSize: 14,
    color: COLORS.white + 'CC',
  },
  totalBalanceAmount: {
    fontSize: 36,
    fontWeight: '700',
    color: COLORS.white,
    marginTop: 4,
  },
  totalBalanceCurrency: {
    fontSize: 14,
    color: COLORS.gold,
    marginTop: 4,
    fontWeight: '600',
  },
  currencyCardsRow: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  currencyCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    width: 200,
    borderTopWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  currencyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  currencyIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  currencyIconText: {
    fontSize: 18,
    fontWeight: '700',
  },
  currencyName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  currencyBalance: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  currencyDetails: {
    gap: 4,
  },
  currencyDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  currencyDetailLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  currencyDetailValue: {
    fontSize: 11,
    color: COLORS.text,
    fontWeight: '500',
  },
  quickActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  quickAction: {
    alignItems: 'center',
    gap: 6,
  },
  quickActionIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickActionText: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '500',
  },
  recentSection: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  seeAllText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  entryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  entryInfo: {
    flex: 1,
  },
  entryCategory: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  entryDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  entryRight: {
    alignItems: 'flex-end',
  },
  entryAmount: {
    fontSize: 15,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 8,
  },
  emptyMessage: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 20,
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.white,
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
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  formInput: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
  },
  optionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  optionButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
    alignItems: 'center',
  },
  optionButtonActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  optionButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  optionButtonTextActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  methodOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  methodOptionActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '08',
  },
  methodOptionText: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
  },
  methodOptionTextActive: {
    fontWeight: '600',
    color: COLORS.primary,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioOuterActive: {
    borderColor: COLORS.primary,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
  },
  confirmButtonDisabled: {
    opacity: 0.6,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  balanceHint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 6,
  },
  conversionSummary: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  summaryRowHighlight: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 4,
    paddingTop: 10,
  },
  summaryLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  summaryLabelBold: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: '600',
  },
  summaryValueBold: {
    fontSize: 15,
    color: COLORS.primary,
    fontWeight: '700',
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterPillText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  filterPillTextActive: {
    color: COLORS.white,
    fontWeight: '600',
  },
});

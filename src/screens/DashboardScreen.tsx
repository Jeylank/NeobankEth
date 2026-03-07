import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transactionsApi, savingsApi, exchangeRatesApi } from '../services/api';
import { useNavigation } from '@react-navigation/native';
import '../i18n';

const COLORS = {
  primary: '#006633',
  gold: '#FFD700',
  red: '#DC2626',
  white: '#FFFFFF',
  gray: '#6B7280',
  lightGray: '#F3F4F6',
  text: '#1F2937',
};

const MOCK_TRANSACTION_SUMMARY = {
  moneySent: 2450.00,
  moneyDelivered: 2100.00,
  pendingDelivery: 350.00,
  totalTransactions: 12,
};

const MOCK_RATES = {
  USD: { ETB: 56.50, lastUpdated: new Date().toISOString() },
  EUR: { ETB: 61.20, lastUpdated: new Date().toISOString() },
  GBP: { ETB: 71.80, lastUpdated: new Date().toISOString() },
  SAR: { ETB: 15.07, lastUpdated: new Date().toISOString() },
  AED: { ETB: 15.39, lastUpdated: new Date().toISOString() },
};

export default function DashboardScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [fxAmount, setFxAmount] = useState('100');
  const [fxFromCurrency, setFxFromCurrency] = useState('USD');

  const { data: ratesData, refetch: refetchRates } = useQuery({
    queryKey: ['exchange-rates'],
    queryFn: () => exchangeRatesApi.getRates(),
  });

  const transactionSummary = MOCK_TRANSACTION_SUMMARY;

  const { data: transactionsData, isLoading: txLoading, refetch: refetchTx } = useQuery({
    queryKey: ['transactions', 'recent'],
    queryFn: () => transactionsApi.getRecent(5),
  });

  const { data: savingsData, refetch: refetchSavings } = useQuery({
    queryKey: ['savings-goals'],
    queryFn: () => savingsApi.getGoals(),
  });

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchTx(), refetchSavings(), refetchRates()]);
    setRefreshing(false);
  };

  const getETBRate = (currency: string) => {
    if (ratesData?.rates) {
      const rateKey = `${currency}_ETB`;
      if (ratesData.rates[rateKey]) return ratesData.rates[rateKey];
      if (ratesData.rates[currency]) return ratesData.rates[currency];
    }
    const fallback = MOCK_RATES[currency as keyof typeof MOCK_RATES];
    return fallback?.ETB || 56.50;
  };

  const calculateETBAmount = () => {
    const amount = parseFloat(fxAmount) || 0;
    const rate = getETBRate(fxFromCurrency);
    return (amount * rate).toFixed(2);
  };

  const formatCurrency = (amount: number, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'deposit':
        return { icon: 'arrow-down-circle', color: COLORS.primary };
      case 'withdrawal':
        return { icon: 'arrow-up-circle', color: COLORS.red };
      case 'remittance':
        return { icon: 'send', color: '#6366F1' };
      case 'bill_payment':
        return { icon: 'flash', color: '#F59E0B' };
      case 'transfer':
        return { icon: 'swap-horizontal', color: '#3B82F6' };
      default:
        return { icon: 'cash', color: COLORS.gray };
    }
  };

  const getTransactionLabel = (type: string) => {
    const typeMap: Record<string, string> = {
      'deposit': t('transactions.deposit'),
      'withdrawal': t('transactions.withdrawal'),
      'remittance': t('transactions.remittance'),
      'bill_payment': t('transactions.billPayment'),
      'transfer': t('transactions.transfer'),
    };
    return typeMap[type] || type.charAt(0).toUpperCase() + type.slice(1);
  };

  const quickActions = [
    { icon: 'send', labelKey: 'dashboard.send', screen: 'Remittance', color: COLORS.primary },
    { icon: 'add-circle', labelKey: 'dashboard.addFunds', screen: 'ChapaPayment', color: '#3B82F6' },
    { icon: 'wallet', labelKey: 'dashboard.savings', screen: 'Savings', color: '#8B5CF6' },
    { icon: 'list', labelKey: 'dashboard.history', screen: 'Transactions', color: '#F59E0B' },
  ];

  const moreServices = [
    { icon: 'flash', labelKey: 'billPayments.title', screen: 'BillPayments', color: '#EF4444' },
    { icon: 'business', labelKey: 'dashboard.bankAccounts', screen: 'BankAccounts', color: '#10B981' },
    { icon: 'phone-portrait', labelKey: 'dashboard.telebirr', screen: 'TelebirrPayment', color: '#E35205' },
    { icon: 'paper-plane', labelKey: 'remittance.trackTransfer', screen: 'RemittanceTracking', color: '#6366F1' },
    { icon: 'analytics', labelKey: 'insights.title', screen: 'Insights', color: '#8B5CF6' },
    { icon: 'card', labelKey: 'dashboard.kyc', screen: 'KYC', color: '#F59E0B' },
    { icon: 'gift', labelKey: 'dashboard.referFriend', screen: 'ReferFriend', color: '#EC4899' },
    { icon: 'help-circle', labelKey: 'profile.support', screen: 'Support', color: '#6B7280' },
    { icon: 'people', labelKey: 'dashboard.familyWallet', screen: 'FamilyWallet', color: '#EC4899' },
    { icon: 'mail', labelKey: 'dashboard.familyRequests', screen: 'FamilyRequests', color: '#3B82F6' },
    { icon: 'repeat', labelKey: 'dashboard.recurringSupport', screen: 'RecurringSupport', color: '#059669' },
    { icon: 'people-circle', labelKey: 'dashboard.familyCircle', screen: 'FamilyCircle', color: '#7C3AED' },
    { icon: 'heart', labelKey: 'dashboard.supportCampaigns', screen: 'SupportCampaigns', color: '#DC2626' },
    { icon: 'wallet', labelKey: 'dashboard.wallet', screen: 'Wallet', color: '#2563EB' },
  ];

  const appFeatures = [
    { icon: 'send', title: t('dashboard.features.sendMoney'), desc: t('dashboard.features.sendMoneyDesc'), color: COLORS.primary },
    { icon: 'flash', title: t('dashboard.features.payBills'), desc: t('dashboard.features.payBillsDesc'), color: '#EF4444' },
    { icon: 'wallet', title: t('dashboard.features.multiCurrency'), desc: t('dashboard.features.multiCurrencyDesc'), color: '#3B82F6' },
    { icon: 'language', title: t('dashboard.features.localLanguages'), desc: t('dashboard.features.localLanguagesDesc'), color: '#8B5CF6' },
  ];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Habeshare</Text>
        <Text style={styles.summarySubtitle}>{t('dashboard.transactionSummary')}</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryItem}>
            <Ionicons name="arrow-up-circle" size={24} color="#10B981" />
            <Text style={styles.summaryAmount}>{formatCurrency(transactionSummary.moneySent)}</Text>
            <Text style={styles.summaryLabel}>{t('dashboard.moneySent')}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />
            <Text style={styles.summaryAmount}>{formatCurrency(transactionSummary.moneyDelivered)}</Text>
            <Text style={styles.summaryLabel}>{t('dashboard.moneyDelivered')}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="time" size={24} color="#F59E0B" />
            <Text style={styles.summaryAmount}>{formatCurrency(transactionSummary.pendingDelivery)}</Text>
            <Text style={styles.summaryLabel}>{t('dashboard.pendingDelivery')}</Text>
          </View>
        </View>
        <View style={styles.flagAccent}>
          <View style={[styles.accentStripe, { backgroundColor: '#006633' }]} />
          <View style={[styles.accentStripe, { backgroundColor: '#FFD700' }]} />
          <View style={[styles.accentStripe, { backgroundColor: '#FF0000' }]} />
        </View>
      </View>

      <View style={styles.featuresSection}>
        <Text style={styles.featuresTitle}>{t('dashboard.features.title')}</Text>
        <View style={styles.featuresGrid}>
          {appFeatures.map((feature, index) => (
            <View key={index} style={styles.featureCard}>
              <View style={[styles.featureIcon, { backgroundColor: feature.color + '15' }]}>
                <Ionicons name={feature.icon as any} size={24} color={feature.color} />
              </View>
              <Text style={styles.featureTitle}>{feature.title}</Text>
              <Text style={styles.featureDesc}>{feature.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.statusCards}>
        <View style={[styles.statusCard, { borderLeftColor: '#10B981' }]}>
          <View style={styles.statusHeader}>
            <Ionicons name="checkmark-done-circle" size={20} color="#10B981" />
            <Text style={styles.statusTitle}>{t('dashboard.completed')}</Text>
          </View>
          <Text style={styles.statusCount}>8</Text>
          <Text style={styles.statusDesc}>{t('dashboard.completedDesc')}</Text>
        </View>
        <View style={[styles.statusCard, { borderLeftColor: '#3B82F6' }]}>
          <View style={styles.statusHeader}>
            <Ionicons name="sync-circle" size={20} color="#3B82F6" />
            <Text style={styles.statusTitle}>{t('dashboard.processing')}</Text>
          </View>
          <Text style={styles.statusCount}>2</Text>
          <Text style={styles.statusDesc}>{t('dashboard.processingDesc')}</Text>
        </View>
        <View style={[styles.statusCard, { borderLeftColor: '#F59E0B' }]}>
          <View style={styles.statusHeader}>
            <Ionicons name="hourglass" size={20} color="#F59E0B" />
            <Text style={styles.statusTitle}>{t('dashboard.initiated')}</Text>
          </View>
          <Text style={styles.statusCount}>2</Text>
          <Text style={styles.statusDesc}>{t('dashboard.initiatedDesc')}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('dashboard.fxRates')}</Text>
        <View style={styles.fxCard}>
          <View style={styles.fxRow}>
            <View style={styles.fxInputContainer}>
              <Text style={styles.fxLabel}>{t('remittance.youSend')}</Text>
              <View style={styles.fxInputRow}>
                <TextInput
                  style={styles.fxInput}
                  value={fxAmount}
                  onChangeText={setFxAmount}
                  keyboardType="decimal-pad"
                  placeholder="100"
                />
                <View style={styles.currencyPicker}>
                  {['USD', 'EUR', 'GBP'].map((curr) => (
                    <TouchableOpacity
                      key={curr}
                      style={[
                        styles.currencyOption,
                        fxFromCurrency === curr && styles.currencyOptionActive,
                      ]}
                      onPress={() => setFxFromCurrency(curr)}
                    >
                      <Text
                        style={[
                          styles.currencyOptionText,
                          fxFromCurrency === curr && styles.currencyOptionTextActive,
                        ]}
                      >
                        {curr}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </View>
          <View style={styles.fxArrow}>
            <Ionicons name="arrow-down" size={20} color={COLORS.primary} />
          </View>
          <View style={styles.fxResultRow}>
            <Text style={styles.fxLabel}>{t('remittance.theyReceive')} (ETB)</Text>
            <Text style={styles.fxResultAmount}>Br {calculateETBAmount()}</Text>
            <Text style={styles.fxRate}>
              1 {fxFromCurrency} = {getETBRate(fxFromCurrency).toFixed(2)} ETB
            </Text>
          </View>
          <TouchableOpacity
            style={styles.sendNowButton}
            onPress={() => navigation.navigate('Remittance')}
          >
            <Text style={styles.sendNowText}>{t('remittance.sendMoney')}</Text>
            <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.quickActions}>
        {quickActions.map((action, index) => (
          <TouchableOpacity
            key={index}
            style={styles.actionButton}
            onPress={() => navigation.navigate(action.screen)}
          >
            <View style={[styles.actionIcon, { backgroundColor: action.color }]}>
              <Ionicons name={action.icon as any} size={24} color={COLORS.white} />
            </View>
            <Text style={styles.actionLabel}>{t(action.labelKey)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('dashboard.moreServices')}</Text>
        <View style={styles.servicesGrid}>
          {moreServices.map((service, index) => (
            <TouchableOpacity
              key={index}
              style={styles.serviceItem}
              onPress={() => navigation.navigate(service.screen)}
            >
              <View style={[styles.serviceIcon, { backgroundColor: service.color + '15' }]}>
                <Ionicons name={service.icon as any} size={22} color={service.color} />
              </View>
              <Text style={styles.serviceLabel}>{t(service.labelKey)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {savingsData?.goals && savingsData.goals.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('dashboard.savingsGoals')}</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Savings')}>
              <Text style={styles.seeAll}>{t('common.seeAll')}</Text>
            </TouchableOpacity>
          </View>
          {savingsData.goals.slice(0, 2).map((goal) => (
            <View key={goal.id} style={styles.savingsCard}>
              <View style={styles.savingsInfo}>
                <Text style={styles.savingsName}>{goal.name}</Text>
                <Text style={styles.savingsProgress}>
                  {formatCurrency(parseFloat(goal.currentAmount))} / {formatCurrency(parseFloat(goal.targetAmount))}
                </Text>
              </View>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(
                        (parseFloat(goal.currentAmount) / parseFloat(goal.targetAmount)) * 100,
                        100
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('dashboard.recentTransactions')}</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Transactions')}>
            <Text style={styles.seeAll}>{t('common.seeAll')}</Text>
          </TouchableOpacity>
        </View>

        {txLoading ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : transactionsData?.transactions?.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={48} color={COLORS.gray} />
            <Text style={styles.emptyText}>{t('dashboard.noTransactions')}</Text>
          </View>
        ) : (
          transactionsData?.transactions?.slice(0, 5).map((tx: any) => {
            const txStyle = getTransactionIcon(tx.type);
            const isCredit = tx.type === 'deposit';
            return (
              <View key={tx.id} style={styles.transactionItem}>
                <View style={[styles.txIcon, { backgroundColor: txStyle.color + '15' }]}>
                  <Ionicons
                    name={txStyle.icon as any}
                    size={20}
                    color={txStyle.color}
                  />
                </View>
                <View style={styles.txInfo}>
                  <Text style={styles.txDescription}>
                    {tx.description || getTransactionLabel(tx.type)}
                  </Text>
                  <Text style={styles.txType}>{getTransactionLabel(tx.type)}</Text>
                </View>
                <View style={styles.txAmountContainer}>
                  <Text
                    style={[
                      styles.txAmount,
                      { color: isCredit ? COLORS.primary : COLORS.red },
                    ]}
                  >
                    {isCredit ? '+' : '-'}{formatCurrency(parseFloat(tx.amount), tx.currency)}
                  </Text>
                  <Text style={styles.txDate}>
                    {new Date(tx.createdAt).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      <View style={styles.disclaimerSection}>
        <View style={styles.disclaimerBox}>
          <Ionicons name="shield-checkmark" size={20} color={COLORS.primary} />
          <Text style={styles.disclaimerText}>
            {t('legal.disclaimer')}
          </Text>
        </View>
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
  },
  summaryCard: {
    backgroundColor: COLORS.primary,
    margin: 16,
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
  },
  summaryTitle: {
    color: COLORS.white,
    fontSize: 28,
    fontWeight: 'bold',
  },
  summarySubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    marginTop: 4,
    marginBottom: 16,
  },
  summaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryAmount: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 8,
  },
  summaryLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  statusCards: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  statusCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 3,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  statusTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  statusCount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  statusDesc: {
    fontSize: 10,
    color: COLORS.gray,
    marginTop: 4,
  },
  disclaimerSection: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  disclaimerBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#E8F5E9',
    padding: 12,
    borderRadius: 8,
    gap: 10,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 11,
    color: COLORS.text,
    lineHeight: 16,
  },
  flagAccent: {
    flexDirection: 'row',
    marginTop: 16,
    width: 80,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  accentStripe: {
    flex: 1,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  actionButton: {
    alignItems: 'center',
  },
  actionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionLabel: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '500',
  },
  section: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  seeAll: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  servicesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  serviceItem: {
    width: '25%',
    alignItems: 'center',
    marginBottom: 16,
  },
  serviceIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  serviceLabel: {
    fontSize: 11,
    color: COLORS.text,
    textAlign: 'center',
  },
  savingsCard: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  savingsInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  savingsName: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  savingsProgress: {
    fontSize: 12,
    color: COLORS.gray,
  },
  progressBar: {
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  txIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.lightGray,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  txInfo: {
    flex: 1,
  },
  txDescription: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    textTransform: 'capitalize',
  },
  txType: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  txAmountContainer: {
    alignItems: 'flex-end',
  },
  txDate: {
    fontSize: 11,
    color: COLORS.gray,
    marginTop: 2,
  },
  txAmount: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    textAlign: 'center',
    color: COLORS.gray,
    marginTop: 8,
  },
  bottomPadding: {
    height: 20,
  },
  featuresSection: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  featuresTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  featureCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    width: '48%',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  featureDesc: {
    fontSize: 12,
    color: COLORS.gray,
  },
  walletsScroll: {
    marginTop: 8,
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  walletCard: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: 16,
    marginRight: 12,
    minWidth: 140,
  },
  walletHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  walletFlag: {
    fontSize: 20,
    marginRight: 8,
  },
  walletCurrency: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  walletAmount: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  walletEtbValue: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 4,
  },
  fxCard: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  fxRow: {
    marginBottom: 8,
  },
  fxInputContainer: {
    flex: 1,
  },
  fxLabel: {
    fontSize: 12,
    color: COLORS.gray,
    marginBottom: 8,
  },
  fxInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fxInput: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: 12,
    fontSize: 18,
    fontWeight: '600',
    marginRight: 12,
  },
  currencyPicker: {
    flexDirection: 'row',
  },
  currencyOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    marginLeft: 4,
  },
  currencyOptionActive: {
    backgroundColor: COLORS.primary,
  },
  currencyOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  currencyOptionTextActive: {
    color: COLORS.white,
  },
  fxArrow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  fxResultRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  fxResultAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.primary,
    marginVertical: 4,
  },
  fxRate: {
    fontSize: 12,
    color: COLORS.gray,
  },
  sendNowButton: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 10,
    marginTop: 12,
  },
  sendNowText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
    marginRight: 8,
  },
});

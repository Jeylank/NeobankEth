import React, { useState, useEffect } from 'react';
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
import { useAuth } from '../hooks/useAuth';
import { getUnreadCount } from '../services/firestoreNotifications';
import '../i18n';

const PRIMARY   = '#006633';
const PRIMARY_D = '#004D26';
const WHITE     = '#FFFFFF';
const TEXT      = '#111827';
const SUBTEXT   = '#6B7280';
const BG        = '#F3F4F6';
const CARD      = '#FFFFFF';
const BORDER    = '#E5E7EB';
const RED       = '#DC2626';
const GOLD      = '#FFD700';

const MOCK_SUMMARY = {
  moneySent: 2450.00,
  moneyDelivered: 2100.00,
  pendingDelivery: 350.00,
  totalTransactions: 12,
};

const MOCK_RATES: Record<string, number> = {
  USD: 56.50,
  EUR: 61.20,
  GBP: 71.80,
  SAR: 15.07,
  AED: 15.39,
};

const BEST_RATE_BANKS: Record<string, string> = {
  USD: 'Awash Bank',
  EUR: 'Dashen Bank',
  GBP: 'CBE',
};

const MOCK_RECENT_TRANSFERS = [
  { id: 'tx1', name: 'Alemu Kebede',    amount: 200,  currency: 'EUR', status: 'DELIVERED',  date: '2026-03-22' },
  { id: 'tx2', name: 'Tigist Haile',   amount: 150,  currency: 'USD', status: 'PROCESSING',  date: '2026-03-21' },
  { id: 'tx3', name: 'Bekele Tadesse', amount: 300,  currency: 'GBP', status: 'DELIVERED',  date: '2026-03-19' },
];

const MOCK_FAMILY = [
  { id: 'f1', name: 'Alemu Kebede',    relationship: 'Father',  monthlyETB: 3000 },
  { id: 'f2', name: 'Tigist Haile',   relationship: 'Mother',  monthlyETB: 2500 },
  { id: 'f3', name: 'Selamawit B.',   relationship: 'Sister',  monthlyETB: 1500 },
];

const CURRENCIES = ['USD', 'EUR', 'GBP'] as const;
type Currency = typeof CURRENCIES[number];

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: '$', EUR: '€', GBP: '£',
};

export default function DashboardScreen() {
  const { t }          = useTranslation();
  const navigation     = useNavigation<any>();
  const { user }       = useAuth();
  const [fxAmount, setFxAmount]               = useState('200');
  const [fxCurrency, setFxCurrency]           = useState<Currency>('EUR');
  const [unreadCount, setUnreadCount]         = useState(0);
  const [refreshing, setRefreshing]           = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = getUnreadCount(user.uid, setUnreadCount);
    return () => unsub();
  }, [user?.uid]);

  const { data: ratesData, refetch: refetchRates } = useQuery({
    queryKey: ['exchange-rates'],
    queryFn: () => exchangeRatesApi.getRates(),
  });

  const { data: transactionsData, isLoading: txLoading, refetch: refetchTx } = useQuery({
    queryKey: ['transactions', 'recent'],
    queryFn: () => transactionsApi.getRecent(5),
  });

  const { data: savingsData, refetch: refetchSavings } = useQuery({
    queryKey: ['savings-goals'],
    queryFn: () => savingsApi.getGoals(),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchTx(), refetchSavings(), refetchRates()]);
    setRefreshing(false);
  };

  const getRate = (curr: string): number => {
    if (ratesData?.rates) {
      const k1 = `${curr}_ETB`, k2 = curr;
      if (ratesData.rates[k1]) return ratesData.rates[k1];
      if (ratesData.rates[k2]) return ratesData.rates[k2];
    }
    return MOCK_RATES[curr] ?? 56.50;
  };

  const etbResult = (): string => {
    const n = parseFloat(fxAmount) || 0;
    return (n * getRate(fxCurrency)).toLocaleString('en-US', { maximumFractionDigits: 0 });
  };

  const fmt = (n: number, curr = 'USD'): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: curr }).format(n);

  const txIcon = (type: string) => {
    const MAP: Record<string, { icon: string; color: string }> = {
      deposit:      { icon: 'arrow-down-circle', color: PRIMARY },
      withdrawal:   { icon: 'arrow-up-circle',   color: RED },
      remittance:   { icon: 'send',               color: '#6366F1' },
      bill_payment: { icon: 'flash',              color: '#F59E0B' },
      transfer:     { icon: 'swap-horizontal',    color: '#3B82F6' },
    };
    return MAP[type] ?? { icon: 'cash', color: SUBTEXT };
  };

  const txLabel = (type: string) => {
    const M: Record<string, string> = {
      deposit: t('transactions.deposit'), withdrawal: t('transactions.withdrawal'),
      remittance: t('transactions.remittance'), bill_payment: t('transactions.billPayment'),
      transfer: t('transactions.transfer'),
    };
    return M[type] ?? type;
  };

  const firstName = user?.displayName?.split(' ')[0] ?? '';

  const quickActions = [
    { icon: 'send',       labelKey: 'dashboard.send',    screen: 'Remittance',    color: PRIMARY },
    { icon: 'add-circle', labelKey: 'dashboard.addFunds', screen: 'FundingMethod', color: '#3B82F6' },
    { icon: 'wallet',     labelKey: 'dashboard.savings',  screen: 'Savings',       color: '#8B5CF6' },
    { icon: 'list',       labelKey: 'dashboard.history',  screen: 'Transactions',  color: '#F59E0B' },
  ];

  const moreServices = [
    { icon: 'flash',          labelKey: 'billPayments.title',          screen: 'BillPayments',      color: '#EF4444' },
    { icon: 'business',       labelKey: 'dashboard.bankAccounts',       screen: 'BankAccounts',      color: '#10B981' },
    { icon: 'phone-portrait', labelKey: 'dashboard.telebirr',           screen: 'TelebirrPayment',   color: '#E35205' },
    { icon: 'paper-plane',    labelKey: 'remittance.trackTransfer',     screen: 'RemittanceTracking',color: '#6366F1' },
    { icon: 'analytics',      labelKey: 'insights.title',               screen: 'Insights',          color: '#8B5CF6' },
    { icon: 'card',           labelKey: 'dashboard.kyc',                screen: 'KYC',               color: '#F59E0B' },
    { icon: 'gift',           labelKey: 'dashboard.referFriend',        screen: 'ReferFriend',       color: '#EC4899' },
    { icon: 'help-circle',    labelKey: 'profile.support',              screen: 'Support',           color: SUBTEXT },
    { icon: 'people',         labelKey: 'dashboard.familyWallet',       screen: 'FamilyWallet',      color: '#EC4899' },
    { icon: 'mail',           labelKey: 'dashboard.familyRequests',     screen: 'FamilyRequests',    color: '#3B82F6' },
    { icon: 'repeat',         labelKey: 'dashboard.recurringSupport',   screen: 'RecurringSupport',  color: '#059669' },
    { icon: 'people-circle',  labelKey: 'dashboard.familyCircle',       screen: 'FamilyCircle',      color: '#7C3AED' },
    { icon: 'heart',          labelKey: 'dashboard.supportCampaigns',   screen: 'SupportCampaigns',  color: RED },
    { icon: 'wallet',         labelKey: 'dashboard.wallet',             screen: 'Wallet',            color: '#2563EB' },
    { icon: 'swap-horizontal',labelKey: 'dashboard.transparentFX',      screen: 'TransparentFX',     color: '#0891B2' },
    { icon: 'trending-up',    labelKey: 'dashboard.bestFxRates',        screen: 'FxMarketplace',     color: '#059669' },
  ];

  const recentTransfers = transactionsData?.transactions?.slice(0, 3) ?? MOCK_RECENT_TRANSFERS;

  return (
    <ScrollView
      style={s.container}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />}
    >

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.logo}>
            <View style={[s.logoStripe, { backgroundColor: PRIMARY }]} />
            <View style={[s.logoStripe, { backgroundColor: GOLD }]} />
            <View style={[s.logoStripe, { backgroundColor: RED }]} />
          </View>
          <View>
            <Text style={s.headerBrand}>Habeshare</Text>
            {firstName ? (
              <Text style={s.headerGreeting}>{t('dashboard.welcome', { name: firstName })}</Text>
            ) : null}
          </View>
        </View>
        <TouchableOpacity style={s.bellBtn} onPress={() => navigation.navigate('Notifications')}>
          <Ionicons name="notifications-outline" size={24} color={TEXT} />
          {unreadCount > 0 && (
            <View style={s.bellBadge}>
              <Text style={s.bellBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── TRUST BANNER ────────────────────────────────────────── */}
      <View style={s.trustBanner}>
        {[
          { icon: 'shield-checkmark', key: 'dashboard.trustSecure' },
          { icon: 'business',         key: 'dashboard.trustLicensed' },
          { icon: 'radio-button-on',  key: 'dashboard.trustTracking' },
        ].map((item) => (
          <View key={item.key} style={s.trustItem}>
            <Ionicons name={item.icon as any} size={14} color={PRIMARY} />
            <Text style={s.trustText}>{t(item.key)}</Text>
          </View>
        ))}
      </View>

      {/* ── HERO SEND BUTTON ────────────────────────────────────── */}
      <View style={s.heroPad}>
        <TouchableOpacity
          style={s.heroBtn}
          activeOpacity={0.88}
          onPress={() => navigation.navigate('Remittance')}
        >
          <View style={s.heroBtnLeft}>
            <View style={s.heroIconWrap}>
              <Ionicons name="send" size={22} color={WHITE} />
            </View>
            <View>
              <Text style={s.heroBtnTitle}>{t('dashboard.sendToEthiopia')}</Text>
              <Text style={s.heroBtnSub}>{t('dashboard.heroBtnSub')}</Text>
            </View>
          </View>
          <Ionicons name="arrow-forward-circle" size={28} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
      </View>

      {/* ── QUICK FX CALCULATOR ─────────────────────────────────── */}
      <View style={[s.card, s.fxCard]}>
        <View style={s.fxHeader}>
          <Text style={s.cardTitle}>{t('dashboard.receiverGets')}</Text>
          <TouchableOpacity onPress={() => navigation.navigate('FxMarketplace')}>
            <Text style={s.linkText}>{t('dashboard.allRates')}</Text>
          </TouchableOpacity>
        </View>

        {/* Send row */}
        <View style={s.fxSendRow}>
          <View style={s.fxSendLeft}>
            <Text style={s.fxSendLabel}>{t('remittance.youSend')}</Text>
            <View style={s.fxAmountRow}>
              <Text style={s.fxSymbol}>{CURRENCY_SYMBOLS[fxCurrency]}</Text>
              <TextInput
                style={s.fxInput}
                value={fxAmount}
                onChangeText={setFxAmount}
                keyboardType="decimal-pad"
                placeholder="200"
                placeholderTextColor={SUBTEXT}
              />
            </View>
          </View>
          <View style={s.fxCurrPicker}>
            {CURRENCIES.map((c) => (
              <TouchableOpacity
                key={c}
                style={[s.fxCurrBtn, fxCurrency === c && s.fxCurrBtnActive]}
                onPress={() => setFxCurrency(c)}
              >
                <Text style={[s.fxCurrText, fxCurrency === c && s.fxCurrTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Divider */}
        <View style={s.fxDivider}>
          <View style={s.fxDividerLine} />
          <View style={s.fxArrowCircle}>
            <Ionicons name="arrow-down" size={16} color={WHITE} />
          </View>
          <View style={s.fxDividerLine} />
        </View>

        {/* Receive row */}
        <View style={s.fxReceiveRow}>
          <View>
            <Text style={s.fxReceiveLabel}>{t('dashboard.receiverGetsLabel')}</Text>
            <Text style={s.fxReceiveAmount}>Br {etbResult()}</Text>
          </View>
          <View style={s.fxRateInfo}>
            <Text style={s.fxRateLabel}>{t('dashboard.bestRate')}</Text>
            <Text style={s.fxRateBank}>{BEST_RATE_BANKS[fxCurrency] ?? 'Dashen'}</Text>
            <Text style={s.fxRateValue}>
              1 {fxCurrency} = {getRate(fxCurrency).toFixed(2)} ETB
            </Text>
          </View>
        </View>

        <TouchableOpacity style={s.fxSendBtn} onPress={() => navigation.navigate('Remittance')}>
          <Text style={s.fxSendBtnText}>{t('remittance.sendMoney')}</Text>
          <Ionicons name="arrow-forward" size={18} color={WHITE} />
        </TouchableOpacity>
      </View>

      {/* ── QUICK ACTIONS ───────────────────────────────────────── */}
      <View style={s.quickActionsRow}>
        {quickActions.map((a, i) => (
          <TouchableOpacity key={i} style={s.qaBtn} onPress={() => navigation.navigate(a.screen)}>
            <View style={[s.qaIcon, { backgroundColor: a.color }]}>
              <Ionicons name={a.icon as any} size={24} color={WHITE} />
            </View>
            <Text style={s.qaLabel}>{t(a.labelKey)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── TRANSACTION SUMMARY ─────────────────────────────────── */}
      <View style={[s.card, s.summaryCard]}>
        <Text style={s.cardTitle}>{t('dashboard.transactionSummary')}</Text>
        <View style={s.summaryGrid}>
          <View style={[s.summaryPill, { borderColor: '#10B981' }]}>
            <Ionicons name="arrow-up-circle" size={20} color="#10B981" />
            <Text style={s.summaryAmt}>{fmt(MOCK_SUMMARY.moneySent)}</Text>
            <Text style={s.summaryLbl}>{t('dashboard.moneySent')}</Text>
          </View>
          <View style={[s.summaryPill, { borderColor: PRIMARY }]}>
            <Ionicons name="checkmark-circle" size={20} color={PRIMARY} />
            <Text style={s.summaryAmt}>{fmt(MOCK_SUMMARY.moneyDelivered)}</Text>
            <Text style={s.summaryLbl}>{t('dashboard.moneyDelivered')}</Text>
          </View>
          <View style={[s.summaryPill, { borderColor: '#F59E0B' }]}>
            <Ionicons name="time" size={20} color="#F59E0B" />
            <Text style={s.summaryAmt}>{fmt(MOCK_SUMMARY.pendingDelivery)}</Text>
            <Text style={s.summaryLbl}>{t('dashboard.pendingDelivery')}</Text>
          </View>
        </View>
      </View>

      {/* ── RECENT TRANSFERS ────────────────────────────────────── */}
      <View style={s.card}>
        <View style={s.sectionHeader}>
          <Text style={s.cardTitle}>{t('dashboard.recentTransfers')}</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Transactions')}>
            <Text style={s.linkText}>{t('common.seeAll')}</Text>
          </TouchableOpacity>
        </View>

        {txLoading ? (
          <ActivityIndicator color={PRIMARY} style={{ paddingVertical: 16 }} />
        ) : (
          recentTransfers.slice(0, 3).map((tx: any, i: number) => {
            const isDelivered = (tx.status ?? '').toUpperCase() === 'DELIVERED' || tx.type === 'deposit';
            const name = tx.name ?? tx.description ?? txLabel(tx.type);
            const amount = tx.amount ?? 0;
            const curr   = tx.currency ?? 'USD';
            return (
              <View key={tx.id ?? i} style={[s.txRow, i < 2 && s.txRowBorder]}>
                <View style={[s.txAvatar, { backgroundColor: PRIMARY + '15' }]}>
                  <Text style={s.txAvatarText}>
                    {String(name).charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={s.txMeta}>
                  <Text style={s.txName} numberOfLines={1}>{name}</Text>
                  <Text style={s.txDate}>
                    {tx.date
                      ? new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : tx.createdAt
                        ? new Date(tx.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : ''}
                  </Text>
                </View>
                <View style={s.txRight}>
                  <Text style={s.txAmount}>
                    {CURRENCY_SYMBOLS[curr as Currency] ?? ''}{Number(amount).toLocaleString()}
                  </Text>
                  <View style={[s.statusBadge, isDelivered ? s.statusDelivered : s.statusProcessing]}>
                    <Text style={[s.statusText, { color: isDelivered ? PRIMARY : '#1D4ED8' }]}>
                      {isDelivered ? t('dashboard.delivered') : t('dashboard.processing')}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })
        )}

        {!txLoading && recentTransfers.length === 0 && (
          <View style={s.emptyState}>
            <Ionicons name="receipt-outline" size={40} color={SUBTEXT} />
            <Text style={s.emptyText}>{t('dashboard.noTransactions')}</Text>
          </View>
        )}
      </View>

      {/* ── YOUR FAMILY ─────────────────────────────────────────── */}
      <View style={s.card}>
        <View style={s.sectionHeader}>
          <Text style={s.cardTitle}>{t('dashboard.yourFamily')}</Text>
          <TouchableOpacity onPress={() => navigation.navigate('FamilyWallet')}>
            <Text style={s.linkText}>{t('dashboard.manageFamily')}</Text>
          </TouchableOpacity>
        </View>
        {MOCK_FAMILY.map((member, i) => (
          <View key={member.id} style={[s.familyRow, i < MOCK_FAMILY.length - 1 && s.txRowBorder]}>
            <View style={s.familyAvatar}>
              <Text style={s.familyAvatarText}>{member.name.charAt(0)}</Text>
            </View>
            <View style={s.familyMeta}>
              <Text style={s.familyName}>{member.name}</Text>
              <Text style={s.familyRelation}>{member.relationship}</Text>
              <Text style={s.familySupport}>
                {t('dashboard.monthlySupport')}: Br {member.monthlyETB.toLocaleString()}
              </Text>
            </View>
            <TouchableOpacity
              style={s.familyQuickSend}
              onPress={() => navigation.navigate('FamilyWallet')}
            >
              <Ionicons name="send" size={14} color={WHITE} />
              <Text style={s.familyQuickSendText}>{t('dashboard.quickSend')}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      {/* ── MORE SERVICES ───────────────────────────────────────── */}
      <View style={s.card}>
        <Text style={s.cardTitle}>{t('dashboard.moreServices')}</Text>
        <View style={s.servicesGrid}>
          {moreServices.map((svc, i) => (
            <TouchableOpacity
              key={i}
              style={s.svcItem}
              onPress={() => navigation.navigate(svc.screen)}
            >
              <View style={[s.svcIcon, { backgroundColor: svc.color + '15' }]}>
                <Ionicons name={svc.icon as any} size={22} color={svc.color} />
              </View>
              <Text style={s.svcLabel}>{t(svc.labelKey)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── SAVINGS (conditional) ───────────────────────────────── */}
      {savingsData?.goals && savingsData.goals.length > 0 && (
        <View style={s.card}>
          <View style={s.sectionHeader}>
            <Text style={s.cardTitle}>{t('dashboard.savingsGoals')}</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Savings')}>
              <Text style={s.linkText}>{t('common.seeAll')}</Text>
            </TouchableOpacity>
          </View>
          {savingsData.goals.slice(0, 2).map((goal: any) => (
            <View key={goal.id} style={s.savingsRow}>
              <View style={s.savingsInfo}>
                <Text style={s.savingsName}>{goal.name}</Text>
                <Text style={s.savingsProgress}>
                  {fmt(parseFloat(goal.currentAmount))} / {fmt(parseFloat(goal.targetAmount))}
                </Text>
              </View>
              <View style={s.progressBar}>
                <View
                  style={[
                    s.progressFill,
                    { width: `${Math.min((parseFloat(goal.currentAmount) / parseFloat(goal.targetAmount)) * 100, 100)}%` as any },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── DISCLAIMER ──────────────────────────────────────────── */}
      <View style={s.disclaimerWrap}>
        <Ionicons name="shield-checkmark" size={16} color={PRIMARY} />
        <Text style={s.disclaimerText}>{t('legal.disclaimer')}</Text>
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

/* ─── STYLES ─────────────────────────────────────────────────────────────── */

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: WHITE,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    flexDirection: 'row',
    width: 24,
    height: 24,
    borderRadius: 6,
    overflow: 'hidden',
  },
  logoStripe: {
    flex: 1,
  },
  headerBrand: {
    fontSize: 20,
    fontWeight: '800',
    color: PRIMARY,
    letterSpacing: -0.5,
  },
  headerGreeting: {
    fontSize: 12,
    color: SUBTEXT,
    marginTop: 1,
  },
  bellBtn: {
    position: 'relative',
    padding: 6,
  },
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: RED,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 2,
    borderColor: WHITE,
  },
  bellBadgeText: {
    color: WHITE,
    fontSize: 9,
    fontWeight: '800',
  },

  /* Trust Banner */
  trustBanner: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#ECFDF5',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#D1FAE5',
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  trustText: {
    fontSize: 11,
    color: PRIMARY_D,
    fontWeight: '600',
  },

  /* Hero Button */
  heroPad: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  heroBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  heroBtnLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBtnTitle: {
    color: WHITE,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  heroBtnSub: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    marginTop: 2,
  },

  /* Card base */
  card: {
    backgroundColor: CARD,
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  /* FX Calculator */
  fxCard: {
    paddingBottom: 14,
  },
  fxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: -0.3,
  },
  linkText: {
    color: PRIMARY,
    fontSize: 13,
    fontWeight: '600',
  },
  fxSendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: BG,
    borderRadius: 12,
    padding: 12,
  },
  fxSendLeft: {
    flex: 1,
    marginRight: 8,
  },
  fxSendLabel: {
    fontSize: 11,
    color: SUBTEXT,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fxAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fxSymbol: {
    fontSize: 24,
    fontWeight: '700',
    color: TEXT,
    marginRight: 2,
  },
  fxInput: {
    fontSize: 28,
    fontWeight: '800',
    color: TEXT,
    flex: 1,
    minWidth: 80,
    padding: 0,
  },
  fxCurrPicker: {
    gap: 4,
  },
  fxCurrBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  fxCurrBtnActive: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  fxCurrText: {
    fontSize: 12,
    fontWeight: '700',
    color: TEXT,
  },
  fxCurrTextActive: {
    color: WHITE,
  },
  fxDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
    paddingHorizontal: 4,
  },
  fxDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: BORDER,
  },
  fxArrowCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  fxReceiveRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  fxReceiveLabel: {
    fontSize: 11,
    color: PRIMARY_D,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  fxReceiveAmount: {
    fontSize: 30,
    fontWeight: '800',
    color: PRIMARY,
    letterSpacing: -0.5,
  },
  fxRateInfo: {
    alignItems: 'flex-end',
  },
  fxRateLabel: {
    fontSize: 10,
    color: SUBTEXT,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  fxRateBank: {
    fontSize: 13,
    fontWeight: '700',
    color: TEXT,
    marginBottom: 2,
  },
  fxRateValue: {
    fontSize: 11,
    color: SUBTEXT,
  },
  fxSendBtn: {
    backgroundColor: PRIMARY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 12,
    gap: 8,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  fxSendBtnText: {
    color: WHITE,
    fontSize: 16,
    fontWeight: '700',
  },

  /* Quick Actions */
  quickActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: WHITE,
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  qaBtn: {
    alignItems: 'center',
    flex: 1,
  },
  qaIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  qaLabel: {
    fontSize: 11,
    color: TEXT,
    fontWeight: '600',
    textAlign: 'center',
  },

  /* Transaction Summary */
  summaryCard: {
    paddingBottom: 14,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  summaryPill: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: BG,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1.5,
    gap: 4,
  },
  summaryAmt: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT,
  },
  summaryLbl: {
    fontSize: 10,
    color: SUBTEXT,
    fontWeight: '500',
    textAlign: 'center',
  },

  /* Section headers */
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },

  /* Recent Transfers */
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  txRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  txAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txAvatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: PRIMARY,
  },
  txMeta: {
    flex: 1,
  },
  txName: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },
  txDate: {
    fontSize: 12,
    color: SUBTEXT,
    marginTop: 2,
  },
  txRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  txAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  statusDelivered: {
    backgroundColor: '#DCFCE7',
  },
  statusProcessing: {
    backgroundColor: '#DBEAFE',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  /* Family Section */
  familyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  familyAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PRIMARY + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  familyAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: PRIMARY,
  },
  familyMeta: {
    flex: 1,
  },
  familyName: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },
  familyRelation: {
    fontSize: 11,
    color: SUBTEXT,
    marginTop: 1,
  },
  familySupport: {
    fontSize: 12,
    color: PRIMARY,
    fontWeight: '600',
    marginTop: 2,
  },
  familyQuickSend: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PRIMARY,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 5,
  },
  familyQuickSendText: {
    color: WHITE,
    fontSize: 12,
    fontWeight: '700',
  },

  /* More Services */
  servicesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  svcItem: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: 8,
  },
  svcIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  svcLabel: {
    fontSize: 10,
    color: TEXT,
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 13,
  },

  /* Savings */
  savingsRow: {
    marginBottom: 12,
  },
  savingsInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  savingsName: {
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
  },
  savingsProgress: {
    fontSize: 12,
    color: SUBTEXT,
  },
  progressBar: {
    height: 6,
    backgroundColor: BG,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    backgroundColor: PRIMARY,
    borderRadius: 3,
  },

  /* Empty state */
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyText: {
    color: SUBTEXT,
    fontSize: 13,
  },

  /* Disclaimer */
  disclaimerWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: '#ECFDF5',
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 11,
    color: TEXT,
    lineHeight: 16,
  },
});

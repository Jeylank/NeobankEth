import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute } from '@react-navigation/native';
import { remittanceApi, beneficiariesApi, balanceApi } from '../services/api';
import { requireBiometricConfirmation } from '../utils/security';
import FeeBreakdownCard from '../components/FeeBreakdownCard';
import DeliveryTimeBadge from '../components/DeliveryTimeBadge';
import { RateLockTimer } from '../components/RateLockTimer';
import { estimateDeliveryTime } from '../services/deliveryEstimator';
import { rateLockService } from '../services/rateLockService';
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

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
];

const PAYMENT_METHODS = [
  { id: 'wallet', nameKey: 'remittance.wallet', icon: 'wallet', descKey: 'remittance.walletDesc' },
  { id: 'card', nameKey: 'remittance.cardTopUp', icon: 'card', descKey: 'remittance.cardDesc' },
  { id: 'bank', nameKey: 'remittance.bankTransfer', icon: 'business', descKey: 'remittance.bankDesc' },
];

const PAYOUT_METHODS = [
  { id: 'bank_account', nameKey: 'remittance.bankAccount', icon: 'business', descKey: 'remittance.bankAccountDesc' },
  { id: 'mobile_wallet', nameKey: 'remittance.mobileWallet', icon: 'phone-portrait', descKey: 'remittance.mobileWalletDesc' },
  { id: 'cash_pickup', nameKey: 'remittance.cashPickup', icon: 'cash', descKey: 'remittance.cashPickupDesc' },
];

export default function RemittanceScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const prefilled = route.params?.prefilled;
  const selectedQuote = route.params?.selectedQuote;
  const incomingRecipient = route.params?.selectedRecipient;
  const [amount, setAmount] = useState(prefilled ? String(route.params?.amount ?? '') : '');
  const [fromCurrency, setFromCurrency] = useState(prefilled ? (route.params?.fromCurrency ?? 'USD') : 'USD');
  const [toCurrency, setToCurrency] = useState(prefilled ? (route.params?.toCurrency ?? 'ETB') : 'ETB');
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<number | null>(prefilled ? (route.params?.beneficiaryId ?? null) : null);
  const [description, setDescription] = useState(prefilled ? (route.params?.description ?? '') : '');
  const [paymentMethod, setPaymentMethod] = useState(prefilled ? (route.params?.paymentMethod ?? 'wallet') : 'wallet');
  const [payoutMethod, setPayoutMethod] = useState(prefilled ? (route.params?.payoutMethod ?? 'bank_account') : 'bank_account');
  const [selectedRecipientName, setSelectedRecipientName] = useState<string | null>(incomingRecipient?.name || null);

  React.useEffect(() => {
    if (incomingRecipient) {
      setSelectedRecipientName(incomingRecipient.name);
    }
  }, [incomingRecipient]);

  const { data: balanceData } = useQuery({
    queryKey: ['balance'],
    queryFn: () => balanceApi.getBalance(),
  });

  const { data: ratesData } = useQuery({
    queryKey: ['exchange-rates'],
    queryFn: () => remittanceApi.getExchangeRates(),
  });

  const { data: beneficiariesData, isLoading: loadingBeneficiaries } = useQuery({
    queryKey: ['beneficiaries'],
    queryFn: () => beneficiariesApi.getAll(),
  });

  const sendMutation = useMutation({
    mutationFn: remittanceApi.initiateTransfer,
    onSuccess: () => {
      Alert.alert(t('common.success'), t('remittance.transferSuccess'));
      setAmount('');
      setDescription('');
      setSelectedBeneficiary(null);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
    },
    onError: (error: any) => {
      Alert.alert(t('common.error'), error.message || t('remittance.transferFailed') || 'Failed to initiate transfer');
    },
  });

  const getExchangeRate = () => {
    if (!ratesData?.rates) return 1;
    const key = `${fromCurrency}_${toCurrency}`;
    return ratesData.rates[key] || 1;
  };

  const convertedAmount = amount ? (parseFloat(amount) * getExchangeRate()).toFixed(2) : '0.00';

  const handleSend = () => {
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert(t('common.error'), t('remittance.enterValidAmount') || 'Please enter a valid amount');
      return;
    }

    if (!selectedBeneficiary) {
      Alert.alert(t('common.error'), t('remittance.selectBeneficiary') || 'Please select a beneficiary');
      return;
    }

    if (parseFloat(amount) > (balanceData?.balance || 0)) {
      Alert.alert(t('common.error'), t('remittance.insufficientBalance') || 'Insufficient balance');
      return;
    }

    Alert.alert(
      t('remittance.review'),
      `${t('remittance.sendMoney')}: ${fromCurrency} ${amount} (${toCurrency} ${convertedAmount})`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: async () => {
            const confirmed = await requireBiometricConfirmation(
              t('security.confirmSensitive')
            );
            if (!confirmed) return;
            sendMutation.mutate({
              amount: parseFloat(amount),
              fromCurrency,
              toCurrency,
              beneficiaryId: selectedBeneficiary,
              description,
              paymentMethod,
              payoutMethod,
              ...(selectedQuote?.quoteId ? { quoteId: selectedQuote.quoteId } : {}),
            });
          },
        },
      ]
    );
  };

  const formatCurrency = (value: number, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(value);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>{t('dashboard.totalBalance')}</Text>
        <Text style={styles.balanceAmount}>
          {formatCurrency(balanceData?.balance || 0)}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('remittance.amount')}</Text>
        
        <View style={styles.amountRow}>
          <View style={styles.currencyPicker}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {CURRENCIES.slice(0, 4).map((currency) => (
                <TouchableOpacity
                  key={currency.code}
                  style={[
                    styles.currencyOption,
                    fromCurrency === currency.code && styles.currencyOptionActive,
                  ]}
                  onPress={() => setFromCurrency(currency.code)}
                >
                  <Text
                    style={[
                      styles.currencyText,
                      fromCurrency === currency.code && styles.currencyTextActive,
                    ]}
                  >
                    {currency.code}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          
          <TextInput
            style={styles.amountInput}
            placeholder="0.00"
            placeholderTextColor={COLORS.gray}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
        </View>

        <View style={styles.exchangeRow}>
          <Ionicons name="swap-vertical" size={24} color={COLORS.primary} />
          <Text style={styles.exchangeRate}>
            1 {fromCurrency} = {getExchangeRate().toFixed(4)} {toCurrency}
          </Text>
        </View>

        <View style={styles.amountRow}>
          <View style={styles.currencyPicker}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {CURRENCIES.map((currency) => (
                <TouchableOpacity
                  key={currency.code}
                  style={[
                    styles.currencyOption,
                    toCurrency === currency.code && styles.currencyOptionActive,
                  ]}
                  onPress={() => setToCurrency(currency.code)}
                >
                  <Text
                    style={[
                      styles.currencyText,
                      toCurrency === currency.code && styles.currencyTextActive,
                    ]}
                  >
                    {currency.code}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          
          <View style={styles.convertedAmount}>
            <Text style={styles.convertedText}>{convertedAmount}</Text>
          </View>
        </View>
      </View>

      {amount && parseFloat(amount) > 0 && (
        <FeeBreakdownCard
          sendAmount={parseFloat(amount)}
          sendCurrency={fromCurrency}
          receiveAmount={parseFloat(convertedAmount)}
          receiveCurrency={toCurrency}
          fxRate={getExchangeRate()}
          platformFee={Math.max(parseFloat(amount) * 0.0075, 0.50)}
          bankFee={parseFloat(amount) > 100 ? 0.40 : 0.20}
        />
      )}

      {selectedQuote && (
        <View style={[styles.section, { backgroundColor: '#F0FFF4', borderWidth: 1, borderColor: COLORS.primary + '30', borderRadius: 12, padding: 14 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
            <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.primary }}>
              {t('fxMarketplace.selected')}: {selectedQuote.bank}
            </Text>
          </View>
          <Text style={{ fontSize: 13, color: COLORS.gray }}>
            {t('fxMarketplace.rate')}: {selectedQuote.rate} | {t('fxMarketplace.receive')}: {selectedQuote.receiveAmount?.toLocaleString()} ETB | {t('fxMarketplace.fee')}: €{selectedQuote.fee}
          </Text>
          <View style={{ marginTop: 10 }}>
            <RateLockTimer
              onLock={async () => {
                const lock = await rateLockService.lockRate('user', selectedQuote.quoteId, selectedQuote.rate);
                return { lockId: lock.lockId, expiresAt: lock.expiresAt };
              }}
              onExpired={() => {
                Alert.alert(t('rateLock.rateExpired'), t('rateLock.refreshRate'));
              }}
            />
          </View>
        </View>
      )}

      {!selectedQuote && amount && parseFloat(amount) > 0 && toCurrency === 'ETB' && (
        <TouchableOpacity
          style={{ backgroundColor: '#059669', marginHorizontal: 16, marginBottom: 8, paddingVertical: 12, borderRadius: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}
          onPress={() => navigation.navigate('FxMarketplace', {
            amount: parseFloat(amount),
            currency: fromCurrency,
            payoutMethod: payoutMethod === 'bank_account' ? 'bank' : payoutMethod === 'mobile_wallet' ? 'mobile' : 'cash',
            beneficiaryId: selectedBeneficiary,
            description,
            paymentMethod,
          })}
        >
          <Ionicons name="trending-up" size={18} color="#FFFFFF" />
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>{t('fxMarketplace.chooseRate')}</Text>
        </TouchableOpacity>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('remittance.paymentMethod')}</Text>
        <Text style={styles.sectionSubtitle}>{t('remittance.howToPay') || 'How would you like to pay?'}</Text>
        {PAYMENT_METHODS.map((method) => (
          <TouchableOpacity
            key={method.id}
            style={[
              styles.methodCard,
              paymentMethod === method.id && styles.methodCardActive,
            ]}
            onPress={() => setPaymentMethod(method.id)}
          >
            <View style={[styles.methodIcon, paymentMethod === method.id && styles.methodIconActive]}>
              <Ionicons
                name={method.icon as any}
                size={22}
                color={paymentMethod === method.id ? COLORS.white : COLORS.primary}
              />
            </View>
            <View style={styles.methodInfo}>
              <Text style={styles.methodName}>{t(method.nameKey)}</Text>
              <Text style={styles.methodDescription}>{t(method.descKey)}</Text>
            </View>
            {paymentMethod === method.id && (
              <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
            )}
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('remittance.payoutMethod')}</Text>
        <Text style={styles.sectionSubtitle}>{t('remittance.howToReceive') || 'How should they receive the money?'}</Text>
        {PAYOUT_METHODS.map((method) => (
          <TouchableOpacity
            key={method.id}
            style={[
              styles.methodCard,
              payoutMethod === method.id && styles.methodCardActive,
            ]}
            onPress={() => setPayoutMethod(method.id)}
          >
            <View style={[styles.methodIcon, payoutMethod === method.id && styles.methodIconActive]}>
              <Ionicons
                name={method.icon as any}
                size={22}
                color={payoutMethod === method.id ? COLORS.white : COLORS.primary}
              />
            </View>
            <View style={styles.methodInfo}>
              <Text style={styles.methodName}>{t(method.nameKey)}</Text>
              <Text style={styles.methodDescription}>{t(method.descKey)}</Text>
            </View>
            {payoutMethod === method.id && (
              <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
            )}
          </TouchableOpacity>
        ))}
      </View>

      {payoutMethod && (
        <View style={{ marginHorizontal: 16, marginBottom: 8 }}>
          {(() => {
            const estimate = estimateDeliveryTime('default', payoutMethod === 'bank_account' ? 'bank_transfer' : payoutMethod === 'mobile_wallet' ? 'mobile_wallet' : 'cash_pickup');
            return <DeliveryTimeBadge estimate={estimate} />;
          })()}
        </View>
      )}

      <TouchableOpacity
        style={{ backgroundColor: COLORS.white, marginHorizontal: 16, marginBottom: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: selectedRecipientName ? COLORS.primary + '40' : '#E5E7EB' }}
        onPress={() => navigation.navigate('Recipients', { selectMode: true })}
      >
        <Ionicons name="people" size={20} color={COLORS.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text }}>{t('recipient.savedRecipients')}</Text>
          {selectedRecipientName && (
            <Text style={{ fontSize: 12, color: COLORS.primary, marginTop: 2 }}>{selectedRecipientName}</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={COLORS.gray} />
      </TouchableOpacity>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Select Beneficiary</Text>
        
        {loadingBeneficiaries ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : beneficiariesData?.beneficiaries?.length === 0 ? (
          <View style={styles.emptyBeneficiary}>
            <Ionicons name="people-outline" size={40} color={COLORS.gray} />
            <Text style={styles.emptyText}>No beneficiaries added yet</Text>
          </View>
        ) : (
          beneficiariesData?.beneficiaries?.map((beneficiary) => (
            <TouchableOpacity
              key={beneficiary.id}
              style={[
                styles.beneficiaryCard,
                selectedBeneficiary === beneficiary.id && styles.beneficiaryCardActive,
              ]}
              onPress={() => setSelectedBeneficiary(beneficiary.id)}
            >
              <View style={styles.beneficiaryIcon}>
                <Ionicons name="person" size={24} color={COLORS.primary} />
              </View>
              <View style={styles.beneficiaryInfo}>
                <Text style={styles.beneficiaryName}>{beneficiary.name}</Text>
                <Text style={styles.beneficiaryBank}>
                  {beneficiary.bankName} • {beneficiary.country}
                </Text>
              </View>
              {selectedBeneficiary === beneficiary.id && (
                <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />
              )}
            </TouchableOpacity>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Description (Optional)</Text>
        <TextInput
          style={styles.descriptionInput}
          placeholder="Add a note for this transfer"
          placeholderTextColor={COLORS.gray}
          value={description}
          onChangeText={setDescription}
          multiline
        />
      </View>

      <TouchableOpacity
        style={[styles.sendButton, sendMutation.isPending && styles.sendButtonDisabled]}
        onPress={handleSend}
        disabled={sendMutation.isPending}
      >
        {sendMutation.isPending ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <>
            <Ionicons name="send" size={20} color={COLORS.white} />
            <Text style={styles.sendButtonText}>{t('remittance.sendMoney')}</Text>
          </>
        )}
      </TouchableOpacity>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
  },
  balanceCard: {
    backgroundColor: COLORS.primary,
    margin: 16,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  balanceLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
  },
  balanceAmount: {
    color: COLORS.white,
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 4,
  },
  section: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.gray,
    marginBottom: 12,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.lightGray,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  methodCardActive: {
    backgroundColor: COLORS.primary + '10',
    borderColor: COLORS.primary,
  },
  methodIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  methodIconActive: {
    backgroundColor: COLORS.primary,
  },
  methodInfo: {
    flex: 1,
  },
  methodName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  methodDescription: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  amountRow: {
    marginBottom: 12,
  },
  currencyPicker: {
    marginBottom: 8,
  },
  currencyOption: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.lightGray,
    marginRight: 8,
  },
  currencyOptionActive: {
    backgroundColor: COLORS.primary,
  },
  currencyText: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  currencyTextActive: {
    color: COLORS.white,
  },
  amountInput: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: 16,
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'center',
  },
  exchangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  exchangeRate: {
    fontSize: 14,
    color: COLORS.gray,
    marginLeft: 8,
  },
  convertedAmount: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  convertedText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  emptyBeneficiary: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  emptyText: {
    color: COLORS.gray,
    marginTop: 8,
  },
  beneficiaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: COLORS.lightGray,
    marginBottom: 8,
  },
  beneficiaryCardActive: {
    backgroundColor: COLORS.primary + '10',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  beneficiaryIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  beneficiaryInfo: {
    flex: 1,
  },
  beneficiaryName: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
  },
  beneficiaryBank: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  descriptionInput: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    color: COLORS.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  sendButton: {
    flexDirection: 'row',
    backgroundColor: COLORS.primary,
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.7,
  },
  sendButtonText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
  bottomPadding: {
    height: 40,
  },
});

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
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  remittanceApi,
  beneficiariesApi,
  balanceApi,
  type RemittanceApiResponse,
} from '../services/api';
import {
  getRecipients,
  getWalletBalanceFallback,
} from '../services/remittanceFirestoreService';
import { executeRemittanceFlow } from '../services/mobileRemittanceFlow';
import { getAuth } from 'firebase/auth';
import { requireBiometricConfirmation } from '../utils/security';
import FeeBreakdownCard from '../components/FeeBreakdownCard';
import DeliveryTimeBadge from '../components/DeliveryTimeBadge';
import { RateLockTimer } from '../components/RateLockTimer';
import { estimateDeliveryTime } from '../services/deliveryEstimator';
import { rateLockService } from '../services/rateLockService';
import TrustBadges from '../components/TrustBadges';
import AnimatedPressable from '../components/AnimatedPressable';
import SmartEmptyState from '../components/SmartEmptyState';
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
  const prefillSource: string | undefined = route.params?.prefillSource;
  const [showPrefillBanner, setShowPrefillBanner] = useState(!!prefilled && !!prefillSource);
  const [amount, setAmount] = useState(prefilled ? String(route.params?.amount ?? '') : '');
  const [fromCurrency, setFromCurrency] = useState(prefilled ? (route.params?.fromCurrency ?? 'USD') : 'USD');
  const [toCurrency, setToCurrency] = useState(prefilled ? (route.params?.toCurrency ?? 'ETB') : 'ETB');
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<number | null>(prefilled ? (route.params?.beneficiaryId ?? null) : null);
  const [description, setDescription] = useState(prefilled ? (route.params?.description ?? '') : '');
  const [paymentMethod, setPaymentMethod] = useState(prefilled ? (route.params?.paymentMethod ?? 'wallet') : 'wallet');
  const [payoutMethod, setPayoutMethod] = useState(prefilled ? (route.params?.payoutMethod ?? 'bank_account') : 'bank_account');
  const [selectedRecipientName, setSelectedRecipientName] = useState<string | null>(incomingRecipient?.name || null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [transferStatus, setTransferStatus] = useState<string | null>(null);

  const clearPrefill = () => {
    setShowPrefillBanner(false);
    setAmount('');
    setFromCurrency('USD');
    setToCurrency('ETB');
    setSelectedBeneficiary(null);
    setDescription('');
    setPaymentMethod('wallet');
    setPayoutMethod('bank_account');
    setSelectedRecipientName(null);
  };

  React.useEffect(() => {
    if (incomingRecipient) {
      setSelectedRecipientName(incomingRecipient.name);
    }
  }, [incomingRecipient]);

  const { data: balanceData } = useQuery({
    queryKey: ['balance'],
    queryFn: async () => {
      try {
        return await balanceApi.getBalance();
      } catch {
        const fallback = await getWalletBalanceFallback();
        return { balance: fallback, currency: 'USD' };
      }
    },
  });

  const { data: ratesData } = useQuery({
    queryKey: ['exchange-rates'],
    queryFn: async () => {
      try {
        return await remittanceApi.getExchangeRates();
      } catch {
        return {
          rates: {
            USD_ETB: 57.5, EUR_ETB: 62.0, GBP_ETB: 72.0,
            USD_EUR: 0.92, USD_GBP: 0.79, EUR_USD: 1.09,
            ETB_USD: 0.0174, ETB_EUR: 0.016, ETB_GBP: 0.0139,
          },
        };
      }
    },
  });

  const { data: beneficiariesData, isLoading: loadingBeneficiaries } = useQuery({
    queryKey: ['beneficiaries'],
    queryFn: async () => {
      try {
        const apiResult = await beneficiariesApi.getAll();
        if (apiResult?.beneficiaries?.length > 0) return apiResult;
        throw new Error('empty');
      } catch {
        const recipients = await getRecipients();
        return { beneficiaries: recipients };
      }
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: {
      amount: number;
      fromCurrency: string;
      toCurrency: string;
      beneficiaryId: number;
      description?: string;
      paymentMethod?: string;
      payoutMethod?: string;
      quoteId?: string;
    }) => {
      const userId = getAuth().currentUser?.uid;
      if (!userId) throw new Error('You must be signed in to send money.');
      const backendPayoutMethod =
        payload.payoutMethod === 'cash_pickup' ? 'agent_cash'
          : payload.payoutMethod === 'bank_account' ? 'bank'
            : 'mobile_money';

      return executeRemittanceFlow(remittanceApi, {
        userId,
        recipientId: String(payload.beneficiaryId),
        amount: payload.amount,
        currency: payload.fromCurrency,
        ...(payload.quoteId ? { quoteId: payload.quoteId } : {}),
        payout_method: backendPayoutMethod,
      }, pending => setTransferStatus(pending.status));
    },
    onSuccess: (data: RemittanceApiResponse) => {
      setTransferStatus(data.status);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      const recipientObj = beneficiariesData?.beneficiaries?.find((b: any) => b.id === selectedBeneficiary);

      if (data.status === 'PENDING_LIQUIDITY') {
        navigation.replace('PendingLiquidity', {
          transactionId: data.transactionId,
          sourceCcy: fromCurrency,
          amount: parseFloat(amount),
        });
        return;
      }

      navigation.replace('TransferSuccess', {
        recipientName:   selectedRecipientName ?? recipientObj?.name ?? 'Your recipient',
        sentAmount:      parseFloat(amount),
        sentCurrency:    fromCurrency,
        receiveAmount:   parseFloat(convertedAmount),
        receiveCurrency: toCurrency,
        deliveryTime:    '1–2 business days',
        txId:            data.transactionId,
        status:          data.status,
        payoutMethod:    data.payout_method,
        otp:             data.otp,
        otpExpiresAt:    data.otpExpiresAt,
      });
      setAmount('');
      setDescription('');
      setSelectedBeneficiary(null);
    },
    onError: (error: any) => {
      setTransferStatus(null);
      const backendMessage = error?.response?.data?.message;
      setSendError(backendMessage || error?.message || 'Something went wrong. Please try again.');
    },
  });

  const getExchangeRate = () => {
    if (!ratesData?.rates) return 1;
    const key = `${fromCurrency}_${toCurrency}`;
    return ratesData.rates[key] || 1;
  };

  const convertedAmount = amount ? (parseFloat(amount) * getExchangeRate()).toFixed(2) : '0.00';

  const handleSend = () => {
    setSendError(null);
    if (!amount || parseFloat(amount) <= 0) {
      setSendError(t('remittance.enterValidAmount') || 'Please enter a valid amount');
      return;
    }
    if (!selectedBeneficiary) {
      setSendError(t('remittance.selectBeneficiary') || 'Please select a beneficiary');
      return;
    }
    const availableBalance = balanceData?.balance ?? 10000;
    if (parseFloat(amount) > availableBalance) {
      setSendError(t('remittance.insufficientBalance') || 'Insufficient balance');
      return;
    }
    setShowConfirmModal(true);
  };

  const executeSend = async () => {
    setShowConfirmModal(false);
    setSendError(null);
    try {
      const confirmed = await requireBiometricConfirmation(
        t('security.confirmSensitive')
      );
      if (!confirmed) return;
    } catch {
    }
    sendMutation.mutate({
      amount: parseFloat(amount),
      fromCurrency,
      toCurrency,
      beneficiaryId: selectedBeneficiary!,
      description,
      paymentMethod,
      payoutMethod,
      ...(selectedQuote?.quoteId ? { quoteId: selectedQuote.quoteId } : {}),
    });
  };

  const formatCurrency = (value: number, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(value);
  };

  return (
    <ScrollView style={styles.container}>
      {showPrefillBanner && prefillSource && (
        <View style={styles.prefillBanner}>
          <View style={styles.prefillBannerLeft}>
            <Ionicons name="information-circle" size={16} color="#065F46" />
            <Text style={styles.prefillBannerText}>
              {t('sendAgain.prefillBanner', { source: prefillSource })}
            </Text>
          </View>
          <TouchableOpacity onPress={clearPrefill} style={styles.prefillClearBtn}>
            <Text style={styles.prefillClearText}>{t('sendAgain.clearPrefill')}</Text>
          </TouchableOpacity>
        </View>
      )}
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
          {toCurrency === 'ETB' && (
            <View style={styles.bestRatePill}>
              <View style={styles.bestRateDot} />
              <Text style={styles.bestRateText}>Best available</Text>
            </View>
          )}
        </View>
        <View style={styles.rateTooltip}>
          <Ionicons name="information-circle-outline" size={14} color={COLORS.gray} />
          <Text style={styles.rateTooltipText}>Rate includes all fees. No hidden charges.</Text>
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
          <SmartEmptyState
            icon="people-outline"
            title="No recipients added yet"
            subtitle="Add a recipient to start sending money to Ethiopia"
            ctaLabel="Add Recipient"
            onCta={() => navigation.navigate('Recipients')}
          />
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

      {/* Trust signals */}
      <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
        <TrustBadges variant="row" />
        <View style={styles.trustMessages}>
          {[
            { icon: 'lock-closed', text: 'Guaranteed rate for 60 seconds' },
            { icon: 'shield-checkmark', text: 'Secure transfer powered by licensed partners' },
            { icon: 'people', text: 'Trusted by Ethiopian diaspora worldwide' },
          ].map((item) => (
            <View key={item.text} style={styles.trustRow}>
              <Ionicons name={item.icon as any} size={14} color={COLORS.primary} />
              <Text style={styles.trustRowText}>{item.text}</Text>
            </View>
          ))}
        </View>
      </View>

      {sendError && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={16} color="#DC2626" />
          <View style={styles.errorBannerBody}>
            <Text style={styles.errorBannerText}>{sendError}</Text>
          </View>
          <TouchableOpacity onPress={() => {
            setSendError(null);
          }}>
            <Ionicons name="close" size={16} color="#DC2626" />
          </TouchableOpacity>
        </View>
      )}

      {transferStatus === 'PAYMENT_PENDING' && (
        <View style={styles.errorBanner}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.errorBannerText}>Payment pending confirmation…</Text>
        </View>
      )}

      <AnimatedPressable
        style={[styles.sendButton, sendMutation.isPending && styles.sendButtonDisabled]}
        onPress={handleSend}
        disabled={sendMutation.isPending}
        hapticStyle="success"
        scaleDown={0.98}
      >
        {sendMutation.isPending ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <>
            <Ionicons name="send" size={20} color={COLORS.white} />
            <Text style={styles.sendButtonText}>{t('remittance.sendMoney')}</Text>
          </>
        )}
      </AnimatedPressable>

      <View style={styles.bottomPadding} />

      <Modal
        visible={showConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Ionicons name="send" size={28} color={COLORS.primary} />
              <Text style={styles.modalTitle}>Confirm Transfer</Text>
            </View>

            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>You Send</Text>
              <Text style={styles.modalValue}>{fromCurrency} {amount}</Text>
            </View>
            <View style={styles.modalDivider} />
            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Recipient Gets</Text>
              <Text style={[styles.modalValue, { color: COLORS.primary }]}>{toCurrency} {convertedAmount}</Text>
            </View>
            <View style={styles.modalDivider} />
            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Recipient</Text>
              <Text style={styles.modalValue}>
                {selectedRecipientName ||
                  beneficiariesData?.beneficiaries?.find((b: any) => b.id === selectedBeneficiary)?.name ||
                  '—'}
              </Text>
            </View>
            <View style={styles.modalDivider} />
            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Method</Text>
              <Text style={styles.modalValue}>{payoutMethod?.replace('_', ' ')}</Text>
            </View>

            <View style={styles.modalNote}>
              <Ionicons name="shield-checkmark" size={14} color={COLORS.primary} />
              <Text style={styles.modalNoteText}>Funds processed by licensed partner institutions</Text>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowConfirmModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={executeSend}
              >
                <Ionicons name="send" size={16} color={COLORS.white} />
                <Text style={styles.modalConfirmText}>Confirm & Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
  },
  prefillBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#D1FAE5',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#6EE7B7',
  },
  prefillBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  prefillBannerText: {
    fontSize: 13,
    color: '#065F46',
    fontWeight: '500',
    flexShrink: 1,
  },
  prefillClearBtn: {
    paddingLeft: 12,
  },
  prefillClearText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#059669',
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
    flex: 1,
  },
  bestRatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    gap: 5,
  },
  bestRateDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  bestRateText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  rateTooltip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  rateTooltipText: {
    fontSize: 12,
    color: COLORS.gray,
    fontStyle: 'italic',
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
  trustMessages: {
    marginTop: 10,
    gap: 6,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  trustRowText: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorBannerText: {
    fontSize: 13,
    color: '#DC2626',
    fontWeight: '500',
  },
  errorBannerBody: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 420,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  modalLabel: {
    fontSize: 14,
    color: COLORS.gray,
    fontWeight: '500',
  },
  modalValue: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
    marginLeft: 12,
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
  },
  modalNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDF4',
    borderRadius: 8,
    padding: 10,
    marginTop: 16,
  },
  modalNoteText: {
    fontSize: 12,
    color: '#166534',
    flex: 1,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray,
  },
  modalConfirmBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.white,
  },
});

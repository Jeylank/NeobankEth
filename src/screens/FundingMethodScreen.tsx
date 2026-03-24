import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { AnimatedPressable } from '../components/AnimatedPressable';

const COLORS = {
  primary:       '#006633',
  primaryLight:  '#E6F4EC',
  card:          '#009999',
  bank:          '#2563EB',
  chapa:         '#F97316',
  telebirr:      '#7C3AED',
  white:         '#FFFFFF',
  background:    '#F5F7FA',
  text:          '#1F2937',
  textSecondary: '#6B7280',
  border:        '#E5E7EB',
  success:       '#10B981',
};

type Method = 'card' | 'bank_transfer' | 'chapa' | 'telebirr';

interface MethodConfig {
  key:         Method;
  i18nTitle:   string;
  i18nSub:     string;
  icon:        keyof typeof Ionicons.glyphMap;
  accentColor: string;
  badge?:      string;
}

const METHODS: MethodConfig[] = [
  {
    key:         'card',
    i18nTitle:   'funding.cardPayment',
    i18nSub:     'funding.cardPaymentSub',
    icon:        'card',
    accentColor: COLORS.card,
    badge:       'Visa / Mastercard',
  },
  {
    key:         'bank_transfer',
    i18nTitle:   'funding.bankTransfer',
    i18nSub:     'funding.bankTransferSub',
    icon:        'business',
    accentColor: COLORS.bank,
  },
  {
    key:         'chapa',
    i18nTitle:   'funding.chapa',
    i18nSub:     'funding.chapaSub',
    icon:        'cash',
    accentColor: COLORS.chapa,
    badge:       'Ethiopia',
  },
  {
    key:         'telebirr',
    i18nTitle:   'funding.telebirr',
    i18nSub:     'funding.telebirrSub',
    icon:        'phone-portrait',
    accentColor: COLORS.telebirr,
    badge:       'Ethiopia',
  },
];

const QUICK_AMOUNTS = [10, 25, 50, 100, 250, 500];
const CURRENCIES = ['EUR', 'USD', 'GBP'] as const;
type Currency = typeof CURRENCIES[number];

export default function FundingMethodScreen() {
  const { t }      = useTranslation();
  const navigation = useNavigation<any>();

  const [selected,  setSelected]  = useState<Method | null>(null);
  const [amount,    setAmount]    = useState('');
  const [currency,  setCurrency]  = useState<Currency>('EUR');

  const handleContinue = () => {
    if (!selected) return;

    const params = { amount: parseFloat(amount) || 0, currency };

    switch (selected) {
      case 'card':
        navigation.navigate('CardTopUp', params);
        break;
      case 'bank_transfer':
        navigation.navigate('BankTransferFunding', params);
        break;
      case 'chapa':
        navigation.navigate('ChapaPayment', params);
        break;
      case 'telebirr':
        navigation.navigate('TelebirrPayment', params);
        break;
    }
  };

  const isReady = selected !== null && amount.length > 0 && parseFloat(amount) > 0;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>{t('funding.title')}</Text>
          <Text style={styles.pageSub}>{t('funding.subtitle')}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('wallet.selectCurrency')}</Text>
          <View style={styles.currencyRow}>
            {CURRENCIES.map((cur) => (
              <TouchableOpacity
                key={cur}
                style={[styles.currencyChip, currency === cur && styles.currencyChipActive]}
                onPress={() => setCurrency(cur)}
              >
                <Text style={[styles.currencyChipText, currency === cur && styles.currencyChipTextActive]}>
                  {cur}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('funding.amount')}</Text>
          <View style={styles.amountInputRow}>
            <Text style={styles.currencySymbol}>{currency}</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
              placeholderTextColor={COLORS.textSecondary}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickAmountRow}>
            {QUICK_AMOUNTS.map((qa) => (
              <TouchableOpacity
                key={qa}
                style={[styles.quickChip, amount === String(qa) && styles.quickChipActive]}
                onPress={() => setAmount(String(qa))}
              >
                <Text style={[styles.quickChipText, amount === String(qa) && styles.quickChipTextActive]}>
                  {qa}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('funding.chooseMethod')}</Text>
          <View style={styles.methodGrid}>
            {METHODS.map((m) => {
              const isActive = selected === m.key;
              return (
                <AnimatedPressable
                  key={m.key}
                  onPress={() => setSelected(m.key)}
                  style={[
                    styles.methodCard,
                    isActive && { borderColor: m.accentColor, borderWidth: 2 },
                  ]}
                >
                  <View style={[styles.methodIconCircle, { backgroundColor: m.accentColor + '18' }]}>
                    <Ionicons name={m.icon} size={28} color={m.accentColor} />
                  </View>

                  {m.badge && (
                    <View style={[styles.methodBadge, { backgroundColor: m.accentColor + '18' }]}>
                      <Text style={[styles.methodBadgeText, { color: m.accentColor }]}>{m.badge}</Text>
                    </View>
                  )}

                  <Text style={[styles.methodTitle, isActive && { color: m.accentColor }]}>
                    {t(m.i18nTitle)}
                  </Text>
                  <Text style={styles.methodSub}>{t(m.i18nSub)}</Text>

                  {isActive && (
                    <View style={[styles.methodCheckmark, { backgroundColor: m.accentColor }]}>
                      <Ionicons name="checkmark" size={14} color={COLORS.white} />
                    </View>
                  )}
                </AnimatedPressable>
              );
            })}
          </View>
        </View>

        <View style={styles.trustRow}>
          <Ionicons name="shield-checkmark" size={16} color={COLORS.success} />
          <Text style={styles.trustText}>{t('funding.trust')}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, !isReady && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={!isReady}
        >
          <Text style={styles.continueBtnText}>{t('funding.continue')}</Text>
          <Ionicons name="arrow-forward" size={20} color={COLORS.white} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scroll: {
    padding: 20,
    paddingBottom: 0,
  },
  pageHeader: {
    marginBottom: 24,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  pageSub: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  currencyRow: {
    flexDirection: 'row',
    gap: 10,
  },
  currencyChip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  currencyChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  currencyChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  currencyChipTextActive: {
    color: COLORS.white,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  currencySymbol: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primary,
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    paddingVertical: 12,
  },
  quickAmountRow: {
    marginTop: 10,
  },
  quickChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
  },
  quickChipActive: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.primary,
  },
  quickChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  quickChipTextActive: {
    color: COLORS.primary,
  },
  methodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  methodCard: {
    width: '47%',
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    position: 'relative',
  },
  methodIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  methodBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  methodBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  methodTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  methodSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
  methodCheckmark: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 20,
  },
  trustText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  footer: {
    padding: 20,
    paddingTop: 12,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
  },
  continueBtnDisabled: {
    opacity: 0.45,
  },
  continueBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.white,
  },
});

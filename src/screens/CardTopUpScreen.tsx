/**
 * CardTopUpScreen.tsx
 * ────────────────────
 * Wallet top-up via debit/credit card.
 * - Card preview panel reflects the currency / amount
 * - On web: real Stripe Elements form (StripePaymentForm.web.tsx)
 * - On native: informational stub (StripePaymentForm.tsx)
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import StripePaymentForm from '../components/StripePaymentForm';

const COLORS = {
  primary:       '#006633',
  primaryLight:  '#E6F4EC',
  card:          '#009999',
  white:         '#FFFFFF',
  background:    '#F5F7FA',
  text:          '#1F2937',
  textSecondary: '#6B7280',
  border:        '#E5E7EB',
  success:       '#10B981',
};

export default function CardTopUpScreen() {
  const { t }      = useTranslation();
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();

  const initAmount   = route.params?.amount ? String(route.params.amount) : '';
  const initCurrency = route.params?.currency ?? 'EUR';

  const [amount,   setAmount]   = useState(initAmount);
  const [currency]              = useState(initCurrency);

  const parsedAmount = parseFloat(amount) || 0;

  const handleSuccess = () => {
    navigation.navigate('Wallet');
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Card preview ──────────────────────────────────── */}
        <View style={styles.cardPreview}>
          <View style={styles.cardFace}>
            <View style={styles.cardTopRow}>
              <Ionicons
                name="wifi"
                size={22}
                color="rgba(255,255,255,0.7)"
                style={{ transform: [{ rotate: '90deg' }] }}
              />
              <Text style={styles.cardBrand}>VISA</Text>
            </View>
            <Text style={styles.cardNumberPreview}>
              •••• •••• •••• ••••
            </Text>
            <View style={styles.cardBottomRow}>
              <View>
                <Text style={styles.cardLabelSmall}>CURRENCY</Text>
                <Text style={styles.cardValueSmall}>{currency}</Text>
              </View>
              <View>
                <Text style={styles.cardLabelSmall}>AMOUNT</Text>
                <Text style={styles.cardValueSmall}>
                  {parsedAmount > 0 ? parsedAmount.toFixed(2) : '—'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Amount field ──────────────────────────────────── */}
        <View style={styles.amountSection}>
          <Text style={styles.formLabel}>Amount ({currency})</Text>
          <TextInput
            style={styles.inputPlain}
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            keyboardType="decimal-pad"
            placeholderTextColor={COLORS.textSecondary}
          />
        </View>

        {/* ── Stripe card form (web) / stub (native) ───────── */}
        {parsedAmount > 0 ? (
          <StripePaymentForm
            amount={parsedAmount}
            currency={currency}
            onSuccess={handleSuccess}
          />
        ) : (
          <View style={styles.enterAmountHint}>
            <Ionicons name="information-circle-outline" size={18} color={COLORS.textSecondary} />
            <Text style={styles.enterAmountText}>Enter an amount above to continue.</Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: COLORS.background,
  },
  scroll: {
    padding:       20,
    paddingBottom: 40,
  },
  cardPreview: {
    marginBottom: 24,
    alignItems:   'center',
  },
  cardFace: {
    width:           '100%',
    maxWidth:        340,
    height:          190,
    borderRadius:    20,
    backgroundColor: COLORS.card,
    padding:         24,
    justifyContent:  'space-between',
    shadowColor:     COLORS.card,
    shadowOffset:    { width: 0, height: 8 },
    shadowOpacity:   0.35,
    shadowRadius:    16,
    elevation:       10,
  },
  cardTopRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  cardBrand: {
    fontSize:    18,
    fontWeight:  '800',
    color:       COLORS.white,
    letterSpacing: 2,
  },
  cardNumberPreview: {
    fontSize:     18,
    fontWeight:   '700',
    color:        COLORS.white,
    letterSpacing: 3,
    textAlign:    'center',
  },
  cardBottomRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
  },
  cardLabelSmall: {
    fontSize:     9,
    color:        'rgba(255,255,255,0.65)',
    fontWeight:   '600',
    letterSpacing: 1,
  },
  cardValueSmall: {
    fontSize:   13,
    color:      COLORS.white,
    fontWeight: '600',
    marginTop:  2,
  },
  amountSection: {
    marginBottom: 4,
  },
  formLabel: {
    fontSize:     13,
    fontWeight:   '600',
    color:        COLORS.textSecondary,
    marginBottom: 6,
  },
  inputPlain: {
    backgroundColor:   COLORS.white,
    borderRadius:      12,
    borderWidth:       1.5,
    borderColor:       COLORS.border,
    paddingHorizontal: 14,
    paddingVertical:   14,
    fontSize:          16,
    color:             COLORS.text,
  },
  enterAmountHint: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            6,
    marginTop:      24,
  },
  enterAmountText: {
    fontSize: 14,
    color:    COLORS.textSecondary,
  },
});

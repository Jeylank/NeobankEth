import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

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

  const [cardNumber, setCardNumber]     = useState('');
  const [expiry,     setExpiry]         = useState('');
  const [cvv,        setCvv]            = useState('');
  const [cardHolder, setCardHolder]     = useState('');
  const [amount,     setAmount]         = useState(initAmount);
  const [currency]                      = useState(initCurrency);
  const [processing, setProcessing]     = useState(false);

  const formatCardNumber = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 16);
    return cleaned.replace(/(.{4})/g, '$1 ').trim();
  };

  const formatExpiry = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 4);
    if (cleaned.length >= 3) {
      return `${cleaned.slice(0, 2)}/${cleaned.slice(2)}`;
    }
    return cleaned;
  };

  const handlePay = async () => {
    if (!cardNumber || !expiry || !cvv || !cardHolder || !amount) {
      Alert.alert('Missing Info', 'Please fill in all fields');
      return;
    }
    if (parseFloat(amount) <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount');
      return;
    }

    setProcessing(true);
    try {
      await new Promise((r) => setTimeout(r, 1500));
      Alert.alert(
        'Payment Initiated',
        `${currency} ${parseFloat(amount).toFixed(2)} — Card payments will be available once Stripe integration is configured.`,
        [{ text: 'OK', onPress: () => navigation.navigate('Wallet') }]
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        <View style={styles.cardPreview}>
          <View style={styles.cardFace}>
            <View style={styles.cardTopRow}>
              <Ionicons name="wifi" size={22} color="rgba(255,255,255,0.7)" style={{ transform: [{ rotate: '90deg' }] }} />
              <Text style={styles.cardBrand}>VISA</Text>
            </View>
            <Text style={styles.cardNumberPreview}>
              {cardNumber || '•••• •••• •••• ••••'}
            </Text>
            <View style={styles.cardBottomRow}>
              <View>
                <Text style={styles.cardLabelSmall}>CARD HOLDER</Text>
                <Text style={styles.cardValueSmall}>{cardHolder || 'YOUR NAME'}</Text>
              </View>
              <View>
                <Text style={styles.cardLabelSmall}>EXPIRES</Text>
                <Text style={styles.cardValueSmall}>{expiry || 'MM/YY'}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.form}>
          <Text style={styles.formLabel}>Card Number</Text>
          <View style={styles.inputRow}>
            <Ionicons name="card-outline" size={20} color={COLORS.textSecondary} />
            <TextInput
              style={styles.input}
              value={cardNumber}
              onChangeText={(t) => setCardNumber(formatCardNumber(t))}
              placeholder="1234 5678 9012 3456"
              keyboardType="number-pad"
              placeholderTextColor={COLORS.textSecondary}
              maxLength={19}
            />
          </View>

          <View style={styles.twoCol}>
            <View style={styles.halfField}>
              <Text style={styles.formLabel}>Expiry</Text>
              <TextInput
                style={styles.inputPlain}
                value={expiry}
                onChangeText={(t) => setExpiry(formatExpiry(t))}
                placeholder="MM/YY"
                keyboardType="number-pad"
                placeholderTextColor={COLORS.textSecondary}
                maxLength={5}
              />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.formLabel}>CVV</Text>
              <TextInput
                style={styles.inputPlain}
                value={cvv}
                onChangeText={setCvv}
                placeholder="123"
                keyboardType="number-pad"
                placeholderTextColor={COLORS.textSecondary}
                secureTextEntry
                maxLength={4}
              />
            </View>
          </View>

          <Text style={styles.formLabel}>Card Holder Name</Text>
          <TextInput
            style={styles.inputPlain}
            value={cardHolder}
            onChangeText={setCardHolder}
            placeholder="As printed on card"
            autoCapitalize="words"
            placeholderTextColor={COLORS.textSecondary}
          />

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

        <View style={styles.securityRow}>
          <Ionicons name="lock-closed" size={14} color={COLORS.success} />
          <Text style={styles.securityText}>256-bit SSL encrypted · PCI DSS compliant</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.payBtn, processing && styles.payBtnDisabled]}
          onPress={handlePay}
          disabled={processing}
        >
          <Ionicons name="card" size={20} color={COLORS.white} />
          <Text style={styles.payBtnText}>
            {processing ? 'Processing...' : `Pay ${currency} ${amount || '0.00'}`}
          </Text>
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
  },
  cardPreview: {
    marginBottom: 28,
    alignItems: 'center',
  },
  cardFace: {
    width: '100%',
    maxWidth: 340,
    height: 190,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    padding: 24,
    justifyContent: 'space-between',
    shadowColor: COLORS.card,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardBrand: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: 2,
  },
  cardNumberPreview: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.white,
    letterSpacing: 3,
    textAlign: 'center',
  },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardLabelSmall: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.65)',
    fontWeight: '600',
    letterSpacing: 1,
  },
  cardValueSmall: {
    fontSize: 13,
    color: COLORS.white,
    fontWeight: '600',
    marginTop: 2,
  },
  form: {
    gap: 4,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginTop: 14,
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    gap: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    letterSpacing: 2,
  },
  inputPlain: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
  },
  twoCol: {
    flexDirection: 'row',
    gap: 12,
  },
  halfField: {
    flex: 1,
  },
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
    marginBottom: 8,
  },
  securityText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  footer: {
    padding: 20,
    paddingTop: 12,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
  },
  payBtnDisabled: {
    opacity: 0.6,
  },
  payBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.white,
  },
});

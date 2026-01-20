import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { paymentsApi } from '../services/api';

const COLORS = {
  primary: '#006633',
  telebirr: '#E35205',
  gold: '#FFD700',
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  success: '#10B981',
  error: '#EF4444',
};

const QUICK_AMOUNTS = [50, 100, 200, 500, 1000, 2000];

export default function TelebirrPaymentScreen() {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');

  const payMutation = useMutation({
    mutationFn: (data: { amount: number; phone: string }) =>
      paymentsApi.initializeTelebirr(data),
    onSuccess: async (response) => {
      if (response.paymentUrl) {
        const canOpen = await Linking.canOpenURL(response.paymentUrl);
        if (canOpen) {
          await Linking.openURL(response.paymentUrl);
        } else {
          Alert.alert(
            'Payment Initiated',
            'Please complete your payment in the Telebirr app'
          );
        }
      } else {
        Alert.alert('Success', 'Payment request sent. Check your Telebirr app.');
      }
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || 'Payment initialization failed');
    },
  });

  const handlePayment = () => {
    if (!amount || !phone) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 10) {
      Alert.alert('Error', 'Minimum amount is 10 ETB');
      return;
    }
    if (!phone.match(/^(\+251|0)?9\d{8}$/)) {
      Alert.alert('Error', 'Please enter a valid Ethiopian phone number');
      return;
    }
    payMutation.mutate({
      amount: amountNum,
      phone,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <View style={styles.telebirrLogo}>
            <Ionicons name="phone-portrait" size={32} color={COLORS.white} />
          </View>
          <Text style={styles.title}>Telebirr Payment</Text>
          <Text style={styles.subtitle}>Add funds using Telebirr mobile money</Text>
        </View>

        <View style={styles.content}>
          <View style={styles.quickAmounts}>
            <Text style={styles.sectionTitle}>Quick Select</Text>
            <View style={styles.amountGrid}>
              {QUICK_AMOUNTS.map((quickAmount) => (
                <TouchableOpacity
                  key={quickAmount}
                  style={[
                    styles.amountChip,
                    amount === quickAmount.toString() && styles.amountChipSelected,
                  ]}
                  onPress={() => setAmount(quickAmount.toString())}
                >
                  <Text
                    style={[
                      styles.amountChipText,
                      amount === quickAmount.toString() && styles.amountChipTextSelected,
                    ]}
                  >
                    {quickAmount.toLocaleString()} ETB
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Amount (ETB)</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                placeholder="Enter amount"
                keyboardType="decimal-pad"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Telebirr Phone Number</Text>
              <View style={styles.phoneInputContainer}>
                <View style={styles.phonePrefix}>
                  <Text style={styles.phonePrefixText}>+251</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="9XXXXXXXX"
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>
            </View>
          </View>

          <View style={styles.instructions}>
            <Text style={styles.instructionsTitle}>How it works</Text>
            <View style={styles.instructionStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>1</Text>
              </View>
              <Text style={styles.stepText}>Enter your Telebirr phone number</Text>
            </View>
            <View style={styles.instructionStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>2</Text>
              </View>
              <Text style={styles.stepText}>You'll receive a payment request</Text>
            </View>
            <View style={styles.instructionStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>3</Text>
              </View>
              <Text style={styles.stepText}>Approve the payment in your Telebirr app</Text>
            </View>
          </View>

          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Amount</Text>
              <Text style={styles.summaryValue}>
                {amount ? `${parseFloat(amount).toLocaleString()} ETB` : '0 ETB'}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Service Fee</Text>
              <Text style={styles.summaryValue}>0 ETB</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.summaryRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>
                {amount ? `${parseFloat(amount).toLocaleString()} ETB` : '0 ETB'}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.payButton, payMutation.isPending && styles.payButtonDisabled]}
            onPress={handlePayment}
            disabled={payMutation.isPending}
          >
            {payMutation.isPending ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="phone-portrait" size={20} color={COLORS.white} />
                <Text style={styles.payButtonText}>Pay with Telebirr</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.securityNote}>
            <Ionicons name="shield-checkmark" size={16} color={COLORS.textSecondary} />
            <Text style={styles.securityText}>
              Secure payment powered by Ethio Telecom
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 24,
    backgroundColor: COLORS.telebirr,
    alignItems: 'center',
  },
  telebirrLogo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.white,
    opacity: 0.8,
    marginTop: 4,
  },
  content: {
    padding: 20,
  },
  quickAmounts: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  amountGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  amountChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  amountChipSelected: {
    backgroundColor: COLORS.telebirr,
    borderColor: COLORS.telebirr,
  },
  amountChipText: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  amountChipTextSelected: {
    color: COLORS.white,
  },
  form: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  phoneInputContainer: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  phonePrefix: {
    backgroundColor: COLORS.background,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  phonePrefixText: {
    fontSize: 16,
    color: COLORS.text,
  },
  phoneInput: {
    flex: 1,
    padding: 14,
    fontSize: 16,
    backgroundColor: COLORS.white,
  },
  instructions: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  instructionStep: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.telebirr,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepNumberText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: 'bold',
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
  },
  summary: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    color: COLORS.text,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 12,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.telebirr,
  },
  payButton: {
    backgroundColor: COLORS.telebirr,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  payButtonDisabled: {
    opacity: 0.6,
  },
  payButtonText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '600',
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
  },
  securityText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
});

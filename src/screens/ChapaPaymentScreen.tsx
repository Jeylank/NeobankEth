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
  chapa: '#7C3AED',
  gold: '#FFD700',
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  success: '#10B981',
  error: '#EF4444',
};

const QUICK_AMOUNTS = [100, 500, 1000, 2500, 5000, 10000];

export default function ChapaPaymentScreen() {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  const payMutation = useMutation({
    mutationFn: (data: {
      amount: number;
      email: string;
      firstName: string;
      lastName: string;
      phone: string;
    }) => paymentsApi.initializeChapa(data),
    onSuccess: async (response) => {
      if (response.checkoutUrl) {
        const canOpen = await Linking.canOpenURL(response.checkoutUrl);
        if (canOpen) {
          await Linking.openURL(response.checkoutUrl);
        } else {
          Alert.alert('Error', 'Cannot open payment page');
        }
      }
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || 'Payment initialization failed');
    },
  });

  const handlePayment = () => {
    if (!amount || !email || !firstName || !lastName) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 10) {
      Alert.alert('Error', 'Minimum amount is 10 ETB');
      return;
    }
    payMutation.mutate({
      amount: amountNum,
      email,
      firstName,
      lastName,
      phone,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <View style={styles.chapaLogo}>
            <Ionicons name="card" size={32} color={COLORS.white} />
          </View>
          <Text style={styles.title}>Chapa Payment</Text>
          <Text style={styles.subtitle}>Add funds using Chapa payment gateway</Text>
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
              <Text style={styles.inputLabel}>Amount (ETB) *</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                placeholder="Enter amount"
                keyboardType="decimal-pad"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Email *</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="your@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.row}>
              <View style={[styles.inputContainer, { flex: 1 }]}>
                <Text style={styles.inputLabel}>First Name *</Text>
                <TextInput
                  style={styles.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First name"
                />
              </View>
              <View style={[styles.inputContainer, { flex: 1, marginLeft: 12 }]}>
                <Text style={styles.inputLabel}>Last Name *</Text>
                <TextInput
                  style={styles.input}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last name"
                />
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Phone (Optional)</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="+251..."
                keyboardType="phone-pad"
              />
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
              <Text style={styles.summaryLabel}>Processing Fee</Text>
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
                <Ionicons name="shield-checkmark" size={20} color={COLORS.white} />
                <Text style={styles.payButtonText}>Pay with Chapa</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.securityNote}>
            <Ionicons name="lock-closed" size={16} color={COLORS.textSecondary} />
            <Text style={styles.securityText}>
              Your payment is secured by Chapa's encryption
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
    backgroundColor: COLORS.chapa,
    alignItems: 'center',
  },
  chapaLogo: {
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
    backgroundColor: COLORS.chapa,
    borderColor: COLORS.chapa,
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
  row: {
    flexDirection: 'row',
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
    color: COLORS.chapa,
  },
  payButton: {
    backgroundColor: COLORS.chapa,
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

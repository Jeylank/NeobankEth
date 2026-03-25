/**
 * StripePaymentForm.tsx  (native stub)
 * ─────────────────────────────────────
 * On iOS/Android, card payments require @stripe/stripe-react-native.
 * This stub renders a clear message while keeping the app functional.
 * The .web.tsx version handles the real implementation on web.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface StripePaymentFormProps {
  amount:    number;
  currency:  string;
  onSuccess: () => void;
}

export default function StripePaymentForm({ amount, currency }: StripePaymentFormProps) {
  return (
    <View style={styles.container}>
      <Ionicons name="card-outline" size={40} color="#6B7280" />
      <Text style={styles.title}>Card Top-Up</Text>
      <Text style={styles.body}>
        Card payments ({currency} {amount.toFixed(2)}) are available on the web version of this app.
        {'\n\n'}Open Habeshare in your mobile browser to add funds by card.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems:     'center',
    paddingVertical: 32,
    gap:             12,
    paddingHorizontal: 16,
  },
  title: {
    fontSize:   18,
    fontWeight: '600',
    color:      '#1F2937',
  },
  body: {
    fontSize:  14,
    color:     '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
});

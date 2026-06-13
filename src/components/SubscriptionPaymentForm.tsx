/**
 * SubscriptionPaymentForm.tsx  (native stub)
 * ────────────────────────────────────────────
 * On iOS/Android, Stripe subscription setup requires @stripe/stripe-react-native.
 * This stub shows a clear message while keeping the app functional.
 * The .web.tsx version handles the real implementation on web.
 */

import React from 'react';
import { View, Text, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface SubscriptionPaymentFormProps {
  priceId:   string;
  planName:  string;
  price:     string;
  onSuccess: () => void;
}

export default function SubscriptionPaymentForm({ planName, price }: SubscriptionPaymentFormProps) {
  return (
    <View style={styles.container}>
      <Ionicons name="globe-outline" size={40} color="#006633" />
      <Text style={styles.title}>Subscribe via Web</Text>
      <Text style={styles.body}>
        To subscribe to {planName} ({price}/month), open Sumsuma in your mobile browser and sign in.
        {'\n\n'}
        Subscriptions are managed securely through Stripe on the web version of the app.
      </Text>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => Linking.openURL('https://sumsuma.com/subscription')}
      >
        <Ionicons name="open-outline" size={18} color="#FFFFFF" />
        <Text style={styles.btnText}>Open in Browser</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems:       'center',
    paddingVertical:  32,
    paddingHorizontal: 16,
    gap:              12,
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
  btn: {
    flexDirection:    'row',
    alignItems:       'center',
    backgroundColor:  '#006633',
    borderRadius:     12,
    paddingVertical:  12,
    paddingHorizontal: 24,
    gap:              8,
    marginTop:        8,
  },
  btnText: {
    fontSize:   15,
    fontWeight: '600',
    color:      '#FFFFFF',
  },
});

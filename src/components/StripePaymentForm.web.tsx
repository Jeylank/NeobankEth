/**
 * StripePaymentForm.web.tsx
 * ─────────────────────────
 * Web-only Stripe Elements card form.
 * Renders a secure hosted CardElement for collecting card details.
 * Imported by CardTopUpScreen; Expo Metro resolves .web.tsx on web builds.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { firebaseAuth } from '../services/firebase';

const COLORS = {
  primary:       '#006633',
  card:          '#009999',
  white:         '#FFFFFF',
  background:    '#F5F7FA',
  text:          '#1F2937',
  textSecondary: '#6B7280',
  border:        '#E5E7EB',
  success:       '#10B981',
  error:         '#EF4444',
};

// ─── API base URL helper ───────────────────────────────────────────────────────
// The Express server now serves both the API (/api/*) and the static Expo web
// app from a single port, so we use origin-relative paths everywhere.

function getApiBaseUrl(): string {
  return '';
}

// ─── Inner form (inside <Elements>) ───────────────────────────────────────────

interface InnerFormProps {
  amount:    number;
  currency:  string;
  onSuccess: () => void;
}

function StripeInnerForm({ amount, currency, onSuccess }: InnerFormProps) {
  const stripe   = useStripe();
  const elements = useElements();

  const [processing, setProcessing] = useState(false);
  const [cardError,  setCardError]  = useState<string | null>(null);

  const handlePay = async () => {
    if (!stripe || !elements) {
      Alert.alert('Error', 'Stripe is not loaded yet. Please wait a moment and try again.');
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      Alert.alert('Error', 'Card form not ready. Please refresh and try again.');
      return;
    }

    setProcessing(true);
    setCardError(null);

    try {
      // 1. Get Firebase ID token
      const idToken = await firebaseAuth.getIdToken();
      if (!idToken) {
        throw new Error('You must be signed in to add funds.');
      }

      // 2. Create PaymentIntent on server
      const apiBase = getApiBaseUrl();
      const intentRes = await fetch(`${apiBase}/api/payments/create-intent`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ amount, currency }),
      });

      if (!intentRes.ok) {
        let errorMsg = `Payment service error (${intentRes.status})`;
        try {
          const data = await intentRes.json();
          errorMsg = data.error ?? data.message ?? errorMsg;
        } catch {
          // Response was not JSON (e.g. proxy error page when server is down)
        }
        throw new Error(errorMsg);
      }

      const body = await intentRes.json();
      const clientSecret: string = body.clientSecret;

      // 3. Confirm card payment with Stripe.js (card details never touch our servers)
      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        { payment_method: { card: cardElement } },
      );

      if (stripeError) {
        setCardError(stripeError.message ?? 'Payment failed. Please try again.');
        return;
      }

      if (paymentIntent?.status === 'succeeded') {
        Alert.alert(
          'Payment Successful',
          `${currency} ${amount.toFixed(2)} has been added to your wallet. It may take a few seconds to appear.`,
          [{ text: 'OK', onPress: onSuccess }],
        );
      } else {
        setCardError(`Payment status: ${paymentIntent?.status}. Please try again.`);
      }
    } catch (err: any) {
      setCardError(err.message ?? 'An unexpected error occurred.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <View>
      {/* Stripe hosted card element */}
      <Text style={styles.label}>Card Details</Text>
      <View style={styles.cardElementWrapper}>
        <CardElement
          options={{
            style: {
              base: {
                fontSize:       '16px',
                color:          COLORS.text,
                fontFamily:     'system-ui, sans-serif',
                '::placeholder': { color: COLORS.textSecondary },
              },
              invalid: { color: COLORS.error },
            },
            hidePostalCode: true,
          }}
        />
      </View>

      {/* Inline error */}
      {cardError && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle-outline" size={16} color={COLORS.error} />
          <Text style={styles.errorText}>{cardError}</Text>
        </View>
      )}

      {/* Security note */}
      <View style={styles.securityRow}>
        <Ionicons name="lock-closed" size={13} color={COLORS.success} />
        <Text style={styles.securityText}>256-bit SSL · PCI DSS compliant · Powered by Stripe</Text>
      </View>

      {/* Pay button */}
      <TouchableOpacity
        style={[styles.payBtn, processing && styles.payBtnDisabled]}
        onPress={handlePay}
        disabled={processing || !stripe}
      >
        {processing ? (
          <ActivityIndicator size="small" color={COLORS.white} />
        ) : (
          <Ionicons name="card" size={20} color={COLORS.white} />
        )}
        <Text style={styles.payBtnText}>
          {processing ? 'Processing…' : `Pay ${currency} ${amount.toFixed(2)}`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Outer component — loads Stripe and wraps with <Elements> ─────────────────

interface StripePaymentFormProps {
  amount:    number;
  currency:  string;
  onSuccess: () => void;
}

export default function StripePaymentForm({ amount, currency, onSuccess }: StripePaymentFormProps) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [loadError,     setLoadError]     = useState<string | null>(null);

  useEffect(() => {
    // Fetch publishable key from our server, then initialise Stripe
    const apiBase = getApiBaseUrl();
    fetch(`${apiBase}/api/payments/publishable-key`)
      .then((r) => r.json())
      .then(({ publishableKey }) => {
        if (!publishableKey) throw new Error('No publishable key returned.');
        setStripePromise(loadStripe(publishableKey));
      })
      .catch((err) => {
        console.error('[StripePaymentForm] Failed to load publishable key:', err);
        setLoadError('Payment service is temporarily unavailable. Please try again later.');
      });
  }, []);

  if (loadError) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="warning-outline" size={24} color={COLORS.error} />
        <Text style={styles.errorText}>{loadError}</Text>
      </View>
    );
  }

  if (!stripePromise) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading secure payment…</Text>
      </View>
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <StripeInnerForm amount={amount} currency={currency} onSuccess={onSuccess} />
    </Elements>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  label: {
    fontSize:     13,
    fontWeight:   '600',
    color:        COLORS.textSecondary,
    marginTop:    16,
    marginBottom: 6,
  },
  cardElementWrapper: {
    backgroundColor:  COLORS.white,
    borderRadius:     12,
    borderWidth:      1.5,
    borderColor:      COLORS.border,
    paddingHorizontal: 14,
    paddingVertical:  16,
  },
  errorContainer: {
    alignItems:  'center',
    gap:         8,
    paddingTop:  16,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    marginTop:     10,
    backgroundColor: '#FEF2F2',
    padding:       10,
    borderRadius:  8,
  },
  errorText: {
    fontSize:  13,
    color:     COLORS.error,
    flexShrink: 1,
  },
  securityRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            6,
    marginTop:      16,
    marginBottom:   8,
  },
  securityText: {
    fontSize: 11,
    color:    COLORS.textSecondary,
  },
  loadingContainer: {
    alignItems:  'center',
    gap:         10,
    paddingTop:  24,
  },
  loadingText: {
    fontSize: 14,
    color:    COLORS.textSecondary,
  },
  payBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    backgroundColor: COLORS.card,
    borderRadius:   14,
    paddingVertical: 16,
    gap:             8,
    marginTop:       8,
  },
  payBtnDisabled: { opacity: 0.6 },
  payBtnText: {
    fontSize:   17,
    fontWeight: '700',
    color:      COLORS.white,
  },
});

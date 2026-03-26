/**
 * StripePaymentForm.web.tsx
 * ─────────────────────────
 * Web-only Stripe Elements card form.
 * Renders a secure hosted CardElement for collecting card details.
 * Imported by CardTopUpScreen; Expo Metro resolves .web.tsx on web builds.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { firebaseAuth } from '../services/firebase';
import { createNotification } from '../services/firestoreNotifications';

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
  const [succeeded,  setSucceeded]  = useState(false);
  const [cardError,  setCardError]  = useState<string | null>(null);

  // Auto-navigate to wallet after showing success for 2 seconds
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (succeeded) {
      timerRef.current = setTimeout(() => {
        onSuccess();
      }, 2200);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [succeeded, onSuccess]);

  const handlePay = async () => {
    if (!stripe || !elements) return;

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;

    setProcessing(true);
    setCardError(null);

    try {
      // 1. Get Firebase ID token
      const idToken = await firebaseAuth.getIdToken();
      if (!idToken) throw new Error('You must be signed in to add funds.');

      // 2. Create PaymentIntent on server
      const intentRes = await fetch(`${getApiBaseUrl()}/api/payments/create-intent`, {
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
        } catch { /* ignore */ }
        throw new Error(errorMsg);
      }

      const { clientSecret } = await intentRes.json();

      // 3. Confirm card payment with Stripe.js
      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        { payment_method: { card: cardElement } },
      );

      if (stripeError) {
        setCardError(stripeError.message ?? 'Payment failed. Please try again.');
        return;
      }

      if (paymentIntent?.status === 'succeeded') {
        setSucceeded(true);
        // Write notification immediately from the client as a backup to the server webhook
        const uid = firebaseAuth.currentUser?.uid;
        if (uid) {
          const symbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
          const symbol = symbols[currency] ?? currency;
          createNotification({
            userId:  uid,
            type:    'transaction',
            title:   'Funds Added',
            message: `${symbol}${amount.toFixed(2)} ${currency} has been added to your wallet.`,
            data:    { amount, currency, transactionType: 'topup' },
          }).catch(() => {/* non-critical */});
        }
      } else {
        setCardError(`Payment status: ${paymentIntent?.status ?? 'unknown'}. Please try again.`);
      }
    } catch (err: any) {
      setCardError(err.message ?? 'An unexpected error occurred.');
    } finally {
      setProcessing(false);
    }
  };

  // ── Success state ──────────────────────────────────────────────────────────
  if (succeeded) {
    return (
      <View style={styles.successBox}>
        <View style={styles.successIconCircle}>
          <Ionicons name="checkmark" size={36} color={COLORS.white} />
        </View>
        <Text style={styles.successTitle}>Payment Successful!</Text>
        <Text style={styles.successSubtitle}>
          {currency} {amount.toFixed(2)} is being added to your wallet.
        </Text>
        <Text style={styles.successHint}>Redirecting to your wallet…</Text>
        <TouchableOpacity style={styles.successBtn} onPress={onSuccess}>
          <Text style={styles.successBtnText}>Go to Wallet Now</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Card form ──────────────────────────────────────────────────────────────
  return (
    <View>
      <Text style={styles.label}>Card Details</Text>
      <View style={styles.cardElementWrapper}>
        <CardElement
          options={{
            style: {
              base: {
                fontSize:        '16px',
                color:           COLORS.text,
                fontFamily:      'system-ui, sans-serif',
                '::placeholder': { color: COLORS.textSecondary },
              },
              invalid: { color: COLORS.error },
            },
            hidePostalCode: true,
          }}
        />
      </View>

      {cardError && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle-outline" size={16} color={COLORS.error} />
          <Text style={styles.errorText}>{cardError}</Text>
        </View>
      )}

      <View style={styles.securityRow}>
        <Ionicons name="lock-closed" size={13} color={COLORS.success} />
        <Text style={styles.securityText}>256-bit SSL · PCI DSS compliant · Powered by Stripe</Text>
      </View>

      <TouchableOpacity
        style={[styles.payBtn, (processing || !stripe) && styles.payBtnDisabled]}
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
    fetch(`${getApiBaseUrl()}/api/payments/publishable-key`)
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
    backgroundColor:   COLORS.white,
    borderRadius:      12,
    borderWidth:       1.5,
    borderColor:       COLORS.border,
    paddingHorizontal: 14,
    paddingVertical:   16,
  },
  errorContainer: {
    alignItems: 'center',
    gap:        8,
    paddingTop: 16,
  },
  errorRow: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             6,
    marginTop:       10,
    backgroundColor: '#FEF2F2',
    padding:         10,
    borderRadius:    8,
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
    alignItems: 'center',
    gap:        10,
    paddingTop: 24,
  },
  loadingText: {
    fontSize: 14,
    color:    COLORS.textSecondary,
  },
  payBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: COLORS.card,
    borderRadius:    14,
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
  // ── Success styles ──────────────────────────────────────────────────────────
  successBox: {
    alignItems:      'center',
    backgroundColor: COLORS.white,
    borderRadius:    20,
    padding:         32,
    marginTop:       24,
    gap:             12,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.08,
    shadowRadius:    12,
    elevation:       4,
  },
  successIconCircle: {
    width:           72,
    height:          72,
    borderRadius:    36,
    backgroundColor: COLORS.success,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    4,
  },
  successTitle: {
    fontSize:   22,
    fontWeight: '800',
    color:      COLORS.text,
  },
  successSubtitle: {
    fontSize:  15,
    color:     COLORS.textSecondary,
    textAlign: 'center',
  },
  successHint: {
    fontSize:  13,
    color:     COLORS.textSecondary,
    fontStyle: 'italic',
  },
  successBtn: {
    backgroundColor: COLORS.primary,
    borderRadius:    12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop:       8,
  },
  successBtnText: {
    fontSize:   15,
    fontWeight: '700',
    color:      COLORS.white,
  },
});

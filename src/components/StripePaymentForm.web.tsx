/**
 * StripePaymentForm.web.tsx
 * ─────────────────────────
 * Web-only Stripe payment form using the modern PaymentElement.
 *
 * Uses deferred intent creation (mode-based Elements) so the UI renders
 * immediately without a server round-trip. The PaymentIntent is created on
 * the server only when the user clicks "Pay", right before confirmation.
 *
 * Flow
 * ────
 *   1. Fetch publishable key → initialise Stripe.js
 *   2. Mount <Elements mode="payment" amount currency> — no round-trip yet
 *   3. User clicks "Pay":
 *        a. elements.submit()          — validates card fields
 *        b. POST /api/payments/create-intent → clientSecret
 *        c. stripe.confirmPayment()    — confirms with redirect: 'if_required'
 *   4. On success → onSuccess() callback
 *
 * redirect: 'if_required' means:
 *   • No 3DS needed → resolves immediately with paymentIntent.status = 'succeeded'
 *   • 3DS required  → redirects to bank, then back to return_url
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
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

// ─── Inner form (must live inside <Elements>) ──────────────────────────────────

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

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (succeeded) {
      timerRef.current = setTimeout(() => onSuccess(), 2200);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [succeeded, onSuccess]);

  const handlePay = async () => {
    if (!stripe || !elements) return;

    setProcessing(true);
    setCardError(null);

    try {
      // Step 1 — validate card fields without network call.
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setCardError(submitError.message ?? 'Please check your card details.');
        return;
      }

      // Step 2 — get Firebase token.
      const idToken = await firebaseAuth.getIdToken();
      if (!idToken) throw new Error('You must be signed in to add funds.');

      // Step 3 — create a PaymentIntent on the server.
      const intentRes = await fetch('/api/payments/create-intent', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ amount, currency }),
      });

      if (!intentRes.ok) {
        let msg = `Payment service error (${intentRes.status})`;
        try { const d = await intentRes.json(); msg = d.error ?? d.message ?? msg; } catch {}
        throw new Error(msg);
      }

      const { clientSecret } = await intentRes.json();

      // Step 4 — confirm payment. redirect: 'if_required' handles both
      // instant confirmations (most cards) and 3DS redirects.
      const returnUrl = `${window.location.origin}/wallet`;
      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: { return_url: returnUrl },
        redirect: 'if_required',
      });

      if (confirmError) {
        setCardError(confirmError.message ?? 'Payment failed. Please try again.');
        return;
      }

      if (paymentIntent?.status === 'succeeded') {
        setSucceeded(true);
        const uid = firebaseAuth.currentUser?.uid;
        if (uid) {
          const symbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
          createNotification({
            userId:  uid,
            type:    'transaction',
            title:   'Funds Added',
            message: `${symbols[currency] ?? currency}${amount.toFixed(2)} ${currency} has been added to your wallet.`,
            data:    { amount, currency, transactionType: 'topup' },
          }).catch(() => {});
        }
      } else {
        setCardError(`Unexpected payment status: ${paymentIntent?.status ?? 'unknown'}. Please try again.`);
      }
    } catch (err: any) {
      setCardError(err.message ?? 'An unexpected error occurred.');
    } finally {
      setProcessing(false);
    }
  };

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

  return (
    <View>
      <Text style={styles.label}>Card Details</Text>

      {/* PaymentElement renders card number, expiry, CVC, and billing fields. */}
      <View style={styles.paymentElementWrapper}>
        <PaymentElement
          options={{
            layout: 'tabs',
            fields: { billingDetails: { address: 'never' } },
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
        {processing
          ? <ActivityIndicator size="small" color={COLORS.white} />
          : <Ionicons name="card" size={20} color={COLORS.white} />
        }
        <Text style={styles.payBtnText}>
          {processing ? 'Processing…' : `Pay ${currency} ${amount.toFixed(2)}`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Outer component — loads Stripe and wraps with <Elements> ─────────────────
// Uses mode-based (deferred) Elements so no PaymentIntent is created on mount.

interface StripePaymentFormProps {
  amount:    number;
  currency:  string;
  onSuccess: () => void;
}

export default function StripePaymentForm({ amount, currency, onSuccess }: StripePaymentFormProps) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [loadError,     setLoadError]     = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/payments/publishable-key')
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

  // mode-based Elements: renders the PaymentElement immediately without a
  // pre-created PaymentIntent. The intent is created on "Pay" click.
  const elementsOptions = {
    mode:     'payment' as const,
    amount:   Math.round(amount * 100), // Stripe expects smallest currency unit
    currency: currency.toLowerCase(),
    appearance: {
      theme: 'stripe' as const,
      variables: {
        colorPrimary:       COLORS.primary,
        colorBackground:    COLORS.white,
        colorText:          COLORS.text,
        colorDanger:        COLORS.error,
        fontFamily:         'system-ui, sans-serif',
        borderRadius:       '8px',
      },
    },
  };

  return (
    <Elements stripe={stripePromise} options={elementsOptions}>
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
  paymentElementWrapper: {
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
    fontSize:   13,
    color:      COLORS.error,
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
    backgroundColor:  COLORS.primary,
    borderRadius:     12,
    paddingVertical:  14,
    paddingHorizontal: 32,
    marginTop:        8,
  },
  successBtnText: {
    fontSize:   15,
    fontWeight: '700',
    color:      COLORS.white,
  },
});

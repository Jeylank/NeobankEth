/**
 * SubscriptionPaymentForm.web.tsx
 * ────────────────────────────────
 * Web-only Stripe subscription setup form.
 *
 * Flow
 * ────
 *   1. POST /api/payments/setup-intent  → SetupIntent clientSecret
 *   2. Mount <Elements> with clientSecret
 *   3. User enters card → clicks "Start Subscription"
 *   4. elements.submit() → stripe.confirmSetup({ redirect: 'if_required' })
 *   5. POST /api/payments/subscribe with { priceId, paymentMethodId }
 *   6. onSuccess() callback
 */

import React, { useEffect, useState } from 'react';
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

const COLORS = {
  primary:       '#006633',
  white:         '#FFFFFF',
  text:          '#1F2937',
  textSecondary: '#6B7280',
  border:        '#E5E7EB',
  success:       '#10B981',
  error:         '#EF4444',
};

// ─── Inner form ───────────────────────────────────────────────────────────────

interface InnerFormProps {
  priceId:  string;
  planName: string;
  price:    string;
  onSuccess: () => void;
}

function SubscriptionInnerForm({ priceId, planName, price, onSuccess }: InnerFormProps) {
  const stripe   = useStripe();
  const elements = useElements();

  const [processing, setProcessing] = useState(false);
  const [succeeded,  setSucceeded]  = useState(false);
  const [formError,  setFormError]  = useState<string | null>(null);

  const handleSubscribe = async () => {
    if (!stripe || !elements) return;

    setProcessing(true);
    setFormError(null);

    try {
      // Step 1 — validate card fields
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setFormError(submitError.message ?? 'Please check your card details.');
        return;
      }

      // Step 2 — confirm the SetupIntent to save the card
      const returnUrl = `${window.location.origin}/subscription`;
      const { error: setupError, setupIntent } = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: 'if_required',
      });

      if (setupError) {
        setFormError(setupError.message ?? 'Card setup failed. Please try again.');
        return;
      }

      const paymentMethodId =
        typeof setupIntent?.payment_method === 'string'
          ? setupIntent.payment_method
          : (setupIntent?.payment_method as any)?.id;

      if (!paymentMethodId) {
        setFormError('Could not save payment method. Please try again.');
        return;
      }

      // Step 3 — get Firebase token and create subscription
      const idToken = await firebaseAuth.getIdToken();
      if (!idToken) throw new Error('You must be signed in to subscribe.');

      const subRes = await fetch('/api/payments/subscribe', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ priceId, paymentMethodId }),
      });

      if (!subRes.ok) {
        let msg = `Subscription error (${subRes.status})`;
        try { const d = await subRes.json(); msg = d.error ?? d.message ?? msg; } catch {}
        throw new Error(msg);
      }

      const result = await subRes.json();

      // If the first invoice needs confirmation (incomplete sub), confirm it.
      if (result.clientSecret) {
        const { error: confirmError } = await stripe.confirmCardPayment(result.clientSecret);
        if (confirmError) {
          setFormError(confirmError.message ?? 'Payment failed. Please try again.');
          return;
        }
      }

      setSucceeded(true);
      setTimeout(() => onSuccess(), 2000);
    } catch (err: any) {
      setFormError(err.message ?? 'An unexpected error occurred.');
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
        <Text style={styles.successTitle}>Welcome to {planName}!</Text>
        <Text style={styles.successSubtitle}>Your subscription is now active.</Text>
      </View>
    );
  }

  return (
    <View style={styles.formContainer}>
      <Text style={styles.formTitle}>Enter payment details</Text>
      <Text style={styles.formSubtitle}>
        You will be billed {price}/month. Cancel any time.
      </Text>

      <View style={styles.paymentElementWrapper}>
        <PaymentElement
          options={{
            layout: 'tabs',
            fields: { billingDetails: { address: 'never' } },
          }}
        />
      </View>

      {formError && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle-outline" size={16} color={COLORS.error} />
          <Text style={styles.errorText}>{formError}</Text>
        </View>
      )}

      <View style={styles.securityRow}>
        <Ionicons name="lock-closed" size={13} color={COLORS.success} />
        <Text style={styles.securityText}>Secured by Stripe · Cancel any time · No hidden fees</Text>
      </View>

      <TouchableOpacity
        style={[styles.subscribeBtn, (processing || !stripe) && styles.subscribeBtnDisabled]}
        onPress={handleSubscribe}
        disabled={processing || !stripe}
      >
        {processing
          ? <ActivityIndicator size="small" color={COLORS.white} />
          : <Ionicons name="star" size={18} color={COLORS.white} />
        }
        <Text style={styles.subscribeBtnText}>
          {processing ? 'Processing…' : `Start ${planName} — ${price}/mo`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Outer component ──────────────────────────────────────────────────────────

interface SubscriptionPaymentFormProps {
  priceId:  string;
  planName: string;
  price:    string;
  onSuccess: () => void;
}

export default function SubscriptionPaymentForm({
  priceId,
  planName,
  price,
  onSuccess,
}: SubscriptionPaymentFormProps) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret,  setClientSecret]  = useState<string | null>(null);
  const [loadError,     setLoadError]     = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const idToken = await firebaseAuth.getIdToken();
        if (!idToken) throw new Error('Not authenticated.');

        const [keyRes, intentRes] = await Promise.all([
          fetch('/api/payments/publishable-key').then((r) => r.json()),
          fetch('/api/payments/setup-intent', {
            method:  'POST',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({}),
          }).then((r) => r.json()),
        ]);

        if (!keyRes.publishableKey) throw new Error('No publishable key.');
        if (!intentRes.clientSecret) throw new Error('Could not create setup intent.');

        setStripePromise(loadStripe(keyRes.publishableKey));
        setClientSecret(intentRes.clientSecret);
      } catch (err: any) {
        console.error('[SubscriptionPaymentForm] Init error:', err);
        setLoadError('Payment service unavailable. Please try again later.');
      }
    }
    init();
  }, []);

  if (loadError) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="warning-outline" size={24} color={COLORS.error} />
        <Text style={styles.errorText}>{loadError}</Text>
      </View>
    );
  }

  if (!stripePromise || !clientSecret) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading secure payment…</Text>
      </View>
    );
  }

  const elementsOptions = {
    clientSecret,
    appearance: {
      theme: 'stripe' as const,
      variables: {
        colorPrimary:    COLORS.primary,
        colorBackground: COLORS.white,
        colorText:       COLORS.text,
        colorDanger:     COLORS.error,
        fontFamily:      'system-ui, sans-serif',
        borderRadius:    '8px',
      },
    },
  };

  return (
    <Elements stripe={stripePromise} options={elementsOptions}>
      <SubscriptionInnerForm
        priceId={priceId}
        planName={planName}
        price={price}
        onSuccess={onSuccess}
      />
    </Elements>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  formContainer: {
    marginTop: 8,
  },
  formTitle: {
    fontSize:     16,
    fontWeight:   '700',
    color:        COLORS.text,
    marginBottom: 4,
  },
  formSubtitle: {
    fontSize:     13,
    color:        COLORS.textSecondary,
    marginBottom: 16,
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
  subscribeBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: COLORS.primary,
    borderRadius:    14,
    paddingVertical: 16,
    gap:             8,
    marginTop:       8,
  },
  subscribeBtnDisabled: { opacity: 0.6 },
  subscribeBtnText: {
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
});

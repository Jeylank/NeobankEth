/**
 * SubscriptionScreen.tsx
 * ────────────────────────
 * Displays the Sumsuma Premium subscription plans and manages
 * the user's current subscription.
 *
 * On web:   Full Stripe payment form (via SubscriptionPaymentForm.web.tsx)
 * On native: Shows plan info + "open in browser" prompt
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { firebaseAuth } from '../services/firebase';
import SubscriptionPaymentForm from '../components/SubscriptionPaymentForm';

// ─── Config ───────────────────────────────────────────────────────────────────
// Set EXPO_PUBLIC_STRIPE_PREMIUM_PRICE_ID in your environment.
// In production this should be a Stripe Price ID like price_xxxxxx.
const PREMIUM_PRICE_ID   = process.env.EXPO_PUBLIC_STRIPE_PREMIUM_PRICE_ID ?? '';
const PREMIUM_PRICE      = '€9.99';
const PREMIUM_PRICE_NUM  = '9.99';

const COLORS = {
  primary:       '#006633',
  primaryLight:  '#E6F4EC',
  gold:          '#F59E0B',
  goldLight:     '#FEF3C7',
  white:         '#FFFFFF',
  background:    '#F5F7FA',
  text:          '#1F2937',
  textSecondary: '#6B7280',
  border:        '#E5E7EB',
  success:       '#10B981',
  error:         '#EF4444',
  card:          '#009999',
};

// ─── Plan feature definitions ──────────────────────────────────────────────────

const FREE_FEATURES = [
  'Send up to €500/month',
  'Standard exchange rate',
  '3 active recipients',
  'Email support',
];

const PREMIUM_FEATURES = [
  'Send up to €5,000/month',
  'Best-rate FX with rate lock (up to 24h)',
  'Unlimited recipients',
  'Priority support (24/7)',
  'Recurring support automation',
  'Family Circle (group funding)',
  'Detailed transfer analytics',
];

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchSubscription() {
  const idToken = await firebaseAuth.getIdToken();
  if (!idToken) throw new Error('Not authenticated.');
  const res = await fetch('/api/payments/subscription', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) throw new Error('Failed to load subscription status.');
  return res.json() as Promise<{
    status:             string;
    subscriptionId?:    string;
    priceId?:           string;
    currentPeriodEnd?:  string;
    cancelAtPeriodEnd?: boolean;
  }>;
}

async function cancelSubscription() {
  const idToken = await firebaseAuth.getIdToken();
  if (!idToken) throw new Error('Not authenticated.');
  const res = await fetch('/api/payments/unsubscribe', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? 'Failed to cancel subscription.');
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SubscriptionScreen() {
  const navigation   = useNavigation<any>();
  const queryClient  = useQueryClient();
  const [showForm,   setShowForm]   = useState(false);

  const { data: sub, isLoading, error, refetch } = useQuery({
    queryKey: ['subscription'],
    queryFn:  fetchSubscription,
    retry:    1,
  });

  const cancelMutation = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      Alert.alert(
        'Subscription Cancelled',
        'Your Premium access continues until the end of the current billing period.',
      );
    },
    onError: (err: any) => {
      Alert.alert('Error', err.message ?? 'Failed to cancel. Please try again.');
    },
  });

  const handleCancel = () => {
    Alert.alert(
      'Cancel Premium?',
      'You will keep Premium access until the end of your current billing period.',
      [
        { text: 'Keep Premium', style: 'cancel' },
        {
          text: 'Cancel Subscription',
          style: 'destructive',
          onPress: () => cancelMutation.mutate(),
        },
      ],
    );
  };

  const handleSuccess = useCallback(() => {
    setShowForm(false);
    refetch();
  }, [refetch]);

  const isPremium     = sub?.status === 'active' || sub?.status === 'trialing';
  const isPastDue     = sub?.status === 'past_due';
  const isCancelling  = sub?.cancelAtPeriodEnd === true;

  const periodEndStr = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading subscription…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* ── Current status banner ─────────────────────────────── */}
        {(isPremium || isPastDue) && (
          <View style={[styles.statusBanner, isPastDue && styles.statusBannerWarning]}>
            <Ionicons
              name={isPastDue ? 'warning-outline' : 'star'}
              size={20}
              color={isPastDue ? COLORS.gold : COLORS.gold}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusBannerTitle}>
                {isPastDue ? 'Payment Past Due' : isCancelling ? 'Premium (Cancelling)' : 'Sumsuma Premium'}
              </Text>
              {periodEndStr && (
                <Text style={styles.statusBannerSub}>
                  {isCancelling
                    ? `Access until ${periodEndStr}`
                    : `Renews ${periodEndStr}`}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* ── Plan cards ────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Choose Your Plan</Text>

        {/* Free plan */}
        <View style={[styles.planCard, !isPremium && styles.planCardActive]}>
          <View style={styles.planHeader}>
            <View>
              <Text style={styles.planName}>Free</Text>
              <Text style={styles.planPrice}>€0 / month</Text>
            </View>
            {!isPremium && (
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>Current</Text>
              </View>
            )}
          </View>
          {FREE_FEATURES.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.textSecondary} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        {/* Premium plan */}
        <View style={[styles.planCard, styles.planCardPremium, isPremium && styles.planCardActive]}>
          <View style={styles.planHeader}>
            <View>
              <Text style={[styles.planName, { color: COLORS.primary }]}>Premium</Text>
              <Text style={styles.planPrice}>{PREMIUM_PRICE} / month</Text>
            </View>
            {isPremium ? (
              <View style={[styles.currentBadge, styles.premiumBadge]}>
                <Ionicons name="star" size={12} color={COLORS.white} />
                <Text style={[styles.currentBadgeText, { color: COLORS.white }]}>Active</Text>
              </View>
            ) : (
              <View style={styles.recommendedBadge}>
                <Text style={styles.recommendedBadgeText}>Recommended</Text>
              </View>
            )}
          </View>
          {PREMIUM_FEATURES.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />
              <Text style={[styles.featureText, { color: COLORS.text }]}>{f}</Text>
            </View>
          ))}
        </View>

        {/* ── Action area ───────────────────────────────────────── */}
        {isPremium ? (
          <View style={styles.actionSection}>
            {!isCancelling && (
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={handleCancel}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending
                  ? <ActivityIndicator size="small" color={COLORS.error} />
                  : <Text style={styles.cancelBtnText}>Cancel Subscription</Text>
                }
              </TouchableOpacity>
            )}
            {isCancelling && (
              <Text style={styles.cancellingNote}>
                Your Premium features remain active until {periodEndStr}.
              </Text>
            )}
          </View>
        ) : showForm ? (
          <View style={styles.formSection}>
            <SubscriptionPaymentForm
              priceId={PREMIUM_PRICE_ID}
              planName="Premium"
              price={PREMIUM_PRICE}
              onSuccess={handleSuccess}
            />
            <TouchableOpacity style={styles.backBtn} onPress={() => setShowForm(false)}>
              <Text style={styles.backBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.actionSection}>
            {!PREMIUM_PRICE_ID ? (
              <View style={styles.infoBox}>
                <Ionicons name="information-circle-outline" size={18} color={COLORS.textSecondary} />
                <Text style={styles.infoText}>
                  Premium subscriptions are coming soon. Stay tuned!
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.upgradeBtn}
                onPress={() => setShowForm(true)}
              >
                <Ionicons name="star" size={20} color={COLORS.white} />
                <Text style={styles.upgradeBtnText}>Upgrade to Premium — {PREMIUM_PRICE}/mo</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.trialNote}>
              No commitment · Cancel any time · Billed monthly
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Could not load subscription status.</Text>
            <TouchableOpacity onPress={() => refetch()}>
              <Text style={styles.retryText}>Tap to retry</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: COLORS.background,
  },
  scroll: {
    padding:       20,
    paddingBottom: 48,
  },
  loadingContainer: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            12,
  },
  loadingText: {
    fontSize: 14,
    color:    COLORS.textSecondary,
  },
  statusBanner: {
    flexDirection:    'row',
    alignItems:       'center',
    backgroundColor:  COLORS.goldLight,
    borderRadius:     14,
    padding:          14,
    marginBottom:     20,
    gap:              12,
    borderWidth:      1,
    borderColor:      '#FCD34D',
  },
  statusBannerWarning: {
    backgroundColor: '#FEF2F2',
    borderColor:     '#FECACA',
  },
  statusBannerTitle: {
    fontSize:   15,
    fontWeight: '700',
    color:      COLORS.text,
  },
  statusBannerSub: {
    fontSize:  12,
    color:     COLORS.textSecondary,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize:     18,
    fontWeight:   '700',
    color:        COLORS.text,
    marginBottom: 14,
  },
  planCard: {
    backgroundColor: COLORS.white,
    borderRadius:    16,
    padding:         20,
    marginBottom:    16,
    borderWidth:     1.5,
    borderColor:     COLORS.border,
    gap:             10,
  },
  planCardPremium: {
    borderColor: COLORS.primaryLight,
  },
  planCardActive: {
    borderColor:      COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  planHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   4,
  },
  planName: {
    fontSize:   18,
    fontWeight: '700',
    color:      COLORS.text,
  },
  planPrice: {
    fontSize:  14,
    color:     COLORS.textSecondary,
    marginTop: 2,
  },
  currentBadge: {
    backgroundColor:  COLORS.border,
    borderRadius:     20,
    paddingVertical:  4,
    paddingHorizontal: 10,
  },
  currentBadgeText: {
    fontSize:   12,
    fontWeight: '600',
    color:      COLORS.textSecondary,
  },
  premiumBadge: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              4,
    backgroundColor:  COLORS.primary,
  },
  recommendedBadge: {
    backgroundColor:  COLORS.goldLight,
    borderRadius:     20,
    paddingVertical:  4,
    paddingHorizontal: 10,
    borderWidth:      1,
    borderColor:      '#FCD34D',
  },
  recommendedBadgeText: {
    fontSize:   12,
    fontWeight: '600',
    color:      COLORS.gold,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  featureText: {
    fontSize: 14,
    color:    COLORS.textSecondary,
    flex:     1,
  },
  actionSection: {
    marginTop: 8,
    gap:       12,
  },
  upgradeBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: COLORS.primary,
    borderRadius:    16,
    paddingVertical: 18,
    gap:             8,
  },
  upgradeBtnText: {
    fontSize:   16,
    fontWeight: '700',
    color:      COLORS.white,
  },
  trialNote: {
    fontSize:  12,
    color:     COLORS.textSecondary,
    textAlign: 'center',
  },
  cancelBtn: {
    borderWidth:     1.5,
    borderColor:     COLORS.error,
    borderRadius:    14,
    paddingVertical: 14,
    alignItems:      'center',
  },
  cancelBtnText: {
    fontSize:   15,
    fontWeight: '600',
    color:      COLORS.error,
  },
  cancellingNote: {
    fontSize:  13,
    color:     COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  formSection: {
    marginTop: 8,
    gap:       12,
  },
  backBtn: {
    alignItems:      'center',
    paddingVertical: 12,
  },
  backBtnText: {
    fontSize:  14,
    color:     COLORS.textSecondary,
  },
  infoBox: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             8,
    backgroundColor: '#F3F4F6',
    borderRadius:    12,
    padding:         14,
  },
  infoText: {
    fontSize:  14,
    color:     COLORS.textSecondary,
    flex:      1,
    lineHeight: 20,
  },
  errorBox: {
    alignItems: 'center',
    marginTop:  16,
    gap:        6,
  },
  errorText: {
    fontSize: 14,
    color:    COLORS.error,
  },
  retryText: {
    fontSize:  13,
    color:     COLORS.primary,
    textDecoration: 'underline' as any,
  },
});

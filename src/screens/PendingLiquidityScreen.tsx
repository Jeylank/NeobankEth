/**
 * PendingLiquidityScreen.tsx
 * ───────────────────────────
 * Shown when a transfer enters PENDING_LIQUIDITY — all payout providers are at
 * capacity for the required ETB amount. The user's funds have been returned and
 * the transaction is preserved for retry.
 *
 * Navigation expects route params:
 *   transactionId  — the PENDING_LIQUIDITY tx doc id
 *   resumeAfter?   — suggested retry delay in minutes (default 30)
 *   sourceCcy?     — source currency, e.g. "EUR"
 *   amount?        — source amount (for display)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  ActivityIndicator, Alert, AppState, AppStateStatus,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AnimatedPressable from '../components/AnimatedPressable';

// ─── Navigation types ────────────────────────────────────────────────────────

type PendingLiquidityRouteParams = {
  transactionId: string;
  resumeAfter?:  number;   // minutes to suggest before retrying
  sourceCcy?:    string;
  amount?:       number;
};

type PendingLiquidityRouteProp = RouteProp<
  { PendingLiquidity: PendingLiquidityRouteParams },
  'PendingLiquidity'
>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SIM_BASE = '/api/v1';

async function callResume(
  transactionId: string,
  action: 'retry' | 'cancel',
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${SIM_BASE}/remittance/resume`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ transactionId, action }),
  });
  const data = await res.json();
  return { ok: res.status < 300, status: res.status, data };
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PendingLiquidityScreen() {
  const { t }        = useTranslation();
  const route        = useRoute<PendingLiquidityRouteProp>();
  const navigation   = useNavigation();
  const {
    transactionId,
    resumeAfter = 30,
    sourceCcy,
    amount,
  } = route.params;

  const cooldownSecs = resumeAfter * 60;
  const [countdown, setCountdown]  = useState(cooldownSecs);
  const [retryReady, setRetryReady] = useState(false);
  const [loading, setLoading]       = useState(false);
  const intervalRef                 = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown timer
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setRetryReady(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Re-enable retry button when user returns to app after suggested wait
  const appState = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        if (countdown <= 0) setRetryReady(true);
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [countdown]);

  const handleRetry = useCallback(async () => {
    setLoading(true);
    try {
      const { ok, status, data } = await callResume(transactionId, 'retry');

      if (ok && status === 201) {
        navigation.reset({
          index: 0,
          routes: [
            { name: 'Main' as never },
            {
              name:   'TransferSuccess' as never,
              params: { transactionId: (data.transactionId as string) ?? transactionId, status: 'COMPLETED' } as never,
            },
          ],
        });
        return;
      }

      if (status === 202) {
        // Still in PENDING_LIQUIDITY — providers not ready yet
        const newResumeAfter = (data.resumeAfter as number) ?? resumeAfter;
        Alert.alert(
          t('pendingLiquidity.stillPendingTitle'),
          t('pendingLiquidity.stillPendingMessage', { minutes: newResumeAfter }),
        );
        setCountdown(newResumeAfter * 60);
        setRetryReady(false);
        return;
      }

      Alert.alert(
        t('pendingLiquidity.retryErrorTitle'),
        (data.message as string) ?? t('pendingLiquidity.retryErrorGeneric'),
      );
    } catch {
      Alert.alert(t('pendingLiquidity.retryErrorTitle'), t('common.networkError'));
    } finally {
      setLoading(false);
    }
  }, [transactionId, resumeAfter, navigation, t]);

  const handleCancel = useCallback(() => {
    Alert.alert(
      t('pendingLiquidity.cancelTitle'),
      t('pendingLiquidity.cancelConfirm'),
      [
        { text: t('common.back'), style: 'cancel' },
        {
          text:  t('common.cancel'),
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await callResume(transactionId, 'cancel');
            } finally {
              setLoading(false);
              navigation.goBack();
            }
          },
        },
      ],
    );
  }, [transactionId, navigation, t]);

  return (
    <ScrollView contentContainerStyle={styles.container} bounces={false}>
      <View style={styles.iconWrapper}>
        <Text style={styles.icon}>🕐</Text>
      </View>

      <Text style={styles.title}>{t('pendingLiquidity.title')}</Text>
      <Text style={styles.subtitle}>{t('pendingLiquidity.subtitle')}</Text>

      <View style={styles.card}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>{t('pendingLiquidity.txId')}</Text>
          <Text style={styles.detailValue} numberOfLines={1} ellipsizeMode="middle">
            {transactionId}
          </Text>
        </View>
        {sourceCcy && amount != null && (
          <>
            <View style={styles.divider} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('pendingLiquidity.amount')}</Text>
              <Text style={styles.detailValue}>{`${amount.toFixed(2)} ${sourceCcy}`}</Text>
            </View>
          </>
        )}
        <View style={styles.divider} />
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>{t('pendingLiquidity.refundStatus')}</Text>
          <Text style={[styles.detailValue, { color: '#006633' }]}>{t('pendingLiquidity.refundComplete')}</Text>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>{t('pendingLiquidity.whatHappened')}</Text>
        <Text style={styles.infoText}>{t('pendingLiquidity.explanation')}</Text>
      </View>

      {!retryReady && (
        <View style={styles.countdownCard}>
          <Text style={styles.countdownLabel}>{t('pendingLiquidity.retryIn')}</Text>
          <Text style={styles.countdownTimer}>{formatCountdown(countdown)}</Text>
          <Text style={styles.countdownSub}>{t('pendingLiquidity.countdownNote')}</Text>
        </View>
      )}

      <View style={styles.actions}>
        {loading ? (
          <ActivityIndicator size="large" color="#006633" style={{ marginVertical: 24 }} />
        ) : (
          <>
            <AnimatedPressable
              style={[styles.retryBtn, !retryReady && styles.retryBtnDisabled]}
              onPress={retryReady ? handleRetry : undefined}
            >
              <Text style={styles.retryBtnText}>
                {retryReady ? t('pendingLiquidity.retryBtn') : t('pendingLiquidity.retryBtnWaiting')}
              </Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.cancelBtn} onPress={handleCancel}>
              <Text style={styles.cancelBtnText}>{t('pendingLiquidity.cancelBtn')}</Text>
            </AnimatedPressable>
          </>
        )}
      </View>

      <Text style={styles.disclaimer}>{t('pendingLiquidity.disclaimer')}</Text>
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#F8F9FA',
    padding: 20,
    paddingBottom: 40,
  },
  iconWrapper: {
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 12,
  },
  icon: {
    fontSize: 48,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  detailLabel: {
    fontSize: 14,
    color: '#6B7280',
    flex: 1,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    maxWidth: '55%',
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
  },
  infoCard: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D4ED8',
    marginBottom: 6,
  },
  infoText: {
    fontSize: 13,
    color: '#1E40AF',
    lineHeight: 19,
  },
  countdownCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  countdownLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 8,
  },
  countdownTimer: {
    fontSize: 40,
    fontWeight: '700',
    color: '#006633',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  countdownSub: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 6,
    textAlign: 'center',
  },
  actions: {
    gap: 12,
    marginTop: 8,
  },
  retryBtn: {
    backgroundColor: '#006633',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  retryBtnDisabled: {
    backgroundColor: '#D1FAE5',
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cancelBtnText: {
    color: '#6B7280',
    fontSize: 16,
    fontWeight: '600',
  },
  disclaimer: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 17,
  },
});

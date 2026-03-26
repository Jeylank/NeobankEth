/**
 * RequoteScreen.tsx
 * ──────────────────
 * Shown when a remittance submission triggers PENDING_REQUOTE — i.e. the FX
 * rate moved more than 0.5 % while the user's locked quote was in its last
 * 15 seconds. The user can either confirm the new rate or cancel the transfer.
 *
 * Navigation expects route params:
 *   transactionId  — the PENDING_REQUOTE tx doc id
 *   originalRate   — rate the user originally locked
 *   freshRate      — updated live rate
 *   deltaPercent   — human-readable change, e.g. "0.72%"
 *   sourceCcy      — e.g. "EUR"
 *   amount         — source amount as a number
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import AnimatedPressable from '../components/AnimatedPressable';

// ─── Navigation types (inline to avoid circular import) ─────────────────────

type RequoteRouteParams = {
  transactionId: string;
  originalRate:  number;
  freshRate:     number;
  deltaPercent:  string;
  sourceCcy:     string;
  amount:        number;
};

type RequoteRouteProp = RouteProp<{ Requote: RequoteRouteParams }, 'Requote'>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SIM_BASE = '/api/v1';

async function callResume(
  transactionId: string,
  action: 'confirm_rate' | 'cancel',
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(`${SIM_BASE}/remittance/resume`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ transactionId, action }),
  });
  const data = await res.json();
  return { ok: res.ok || res.status === 200 || res.status === 201, data };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RequoteScreen() {
  const { t }        = useTranslation();
  const route        = useRoute<RequoteRouteProp>();
  const navigation   = useNavigation();
  const {
    transactionId, originalRate, freshRate,
    deltaPercent, sourceCcy, amount,
  } = route.params;

  const [loading, setLoading] = useState(false);

  const destinationOriginal = (amount * originalRate).toFixed(2);
  const destinationFresh    = (amount * freshRate).toFixed(2);
  const rateWorsened        = freshRate < originalRate;

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    try {
      const { ok, data } = await callResume(transactionId, 'confirm_rate');
      if (ok) {
        navigation.reset({
          index: 0,
          routes: [
            { name: 'Main' as never },
            {
              name:   'TransferSuccess' as never,
              params: {
                transactionId: (data.transactionId as string) ?? transactionId,
                status:        'COMPLETED',
              } as never,
            },
          ],
        });
      } else {
        Alert.alert(
          t('requote.errorTitle'),
          (data.message as string) ?? t('requote.errorGeneric'),
        );
      }
    } catch {
      Alert.alert(t('requote.errorTitle'), t('requote.errorNetwork'));
    } finally {
      setLoading(false);
    }
  }, [transactionId, navigation, t]);

  const handleCancel = useCallback(async () => {
    Alert.alert(
      t('requote.cancelTitle'),
      t('requote.cancelConfirm'),
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
        <Text style={styles.icon}>⚠️</Text>
      </View>

      <Text style={styles.title}>{t('requote.title')}</Text>
      <Text style={styles.subtitle}>{t('requote.subtitle', { deltaPercent })}</Text>

      <View style={styles.card}>
        <Row
          label={t('requote.originalRate')}
          value={`1 ${sourceCcy} = ${originalRate.toFixed(4)} ETB`}
          muted
        />
        <View style={styles.divider} />
        <Row
          label={t('requote.newRate')}
          value={`1 ${sourceCcy} = ${freshRate.toFixed(4)} ETB`}
          accent={rateWorsened ? '#DC2626' : '#006633'}
        />
        <View style={styles.divider} />
        <Row
          label={t('requote.rateChange')}
          value={`${rateWorsened ? '▼' : '▲'} ${deltaPercent}`}
          accent={rateWorsened ? '#DC2626' : '#006633'}
        />
      </View>

      <View style={styles.card}>
        <Row
          label={t('requote.youSend')}
          value={`${amount.toFixed(2)} ${sourceCcy}`}
        />
        <View style={styles.divider} />
        <Row
          label={t('requote.originalReceive')}
          value={`${destinationOriginal} ETB`}
          muted
        />
        <View style={styles.divider} />
        <Row
          label={t('requote.newReceive')}
          value={`${destinationFresh} ETB`}
          accent={rateWorsened ? '#DC2626' : '#006633'}
        />
      </View>

      {rateWorsened && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>{t('requote.warningWorsened')}</Text>
        </View>
      )}

      <View style={styles.actions}>
        {loading ? (
          <ActivityIndicator size="large" color="#006633" style={{ marginVertical: 24 }} />
        ) : (
          <>
            <AnimatedPressable style={styles.confirmBtn} onPress={handleConfirm}>
              <Text style={styles.confirmBtnText}>{t('requote.confirmBtn')}</Text>
            </AnimatedPressable>
            <AnimatedPressable style={styles.cancelBtn} onPress={handleCancel}>
              <Text style={styles.cancelBtnText}>{t('requote.cancelBtn')}</Text>
            </AnimatedPressable>
          </>
        )}
      </View>

      <Text style={styles.disclaimer}>{t('requote.disclaimer')}</Text>
    </ScrollView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Row({
  label, value, muted, accent,
}: { label: string; value: string; muted?: boolean; accent?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, muted && styles.muted, accent ? { color: accent } : null]}>
        {value}
      </Text>
    </View>
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  rowLabel: {
    fontSize: 14,
    color: '#6B7280',
    flex: 1,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
  },
  muted: {
    color: '#9CA3AF',
    textDecorationLine: 'line-through',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
  },
  warningBanner: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  warningText: {
    fontSize: 13,
    color: '#DC2626',
    lineHeight: 18,
  },
  actions: {
    gap: 12,
    marginTop: 8,
  },
  confirmBtn: {
    backgroundColor: '#006633',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmBtnText: {
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

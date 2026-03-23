import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { DeliveryEstimate, DeliveryCategory } from '../services/deliveryEstimator';

const CATEGORY_COLORS: Record<DeliveryCategory, string> = {
  Instant: '#10B981',
  Fast: '#3B82F6',
  Standard: '#F59E0B',
};

const CATEGORY_I18N_KEYS: Record<DeliveryCategory, string> = {
  Instant: 'delivery.instant',
  Fast: 'delivery.fast',
  Standard: 'delivery.standard',
};

interface DeliveryTimeBadgeProps {
  estimate: DeliveryEstimate;
}

export default function DeliveryTimeBadge({ estimate }: DeliveryTimeBadgeProps) {
  const { t } = useTranslation();
  const color = CATEGORY_COLORS[estimate.label];
  const displayLabel = t(CATEGORY_I18N_KEYS[estimate.label], estimate.label);

  const timeRange =
    estimate.minMinutes === 0
      ? `< ${estimate.maxMinutes} min`
      : estimate.minMinutes === estimate.maxMinutes
      ? `~${estimate.minMinutes} min`
      : `${estimate.minMinutes}–${estimate.maxMinutes} min`;

  return (
    <View style={[styles.badge, { backgroundColor: color + '15', borderColor: color + '40' }]}>
      <Ionicons name={estimate.icon as any} size={14} color={color} />
      <Text style={[styles.label, { color }]}>{displayLabel}</Text>
      <Text style={[styles.time, { color: color + 'CC' }]}>{timeRange}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
  },
  time: {
    fontSize: 11,
    fontWeight: '500',
  },
});

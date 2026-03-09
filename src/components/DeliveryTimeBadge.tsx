import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const COLORS = {
  primary: '#006633',
  white: '#FFFFFF',
  green: '#10B981',
};

interface DeliveryTimeBadgeProps {
  label: string;
  minutes: number;
  icon?: string;
}

export default function DeliveryTimeBadge({ label, minutes, icon = 'time-outline' }: DeliveryTimeBadgeProps) {
  const badgeColor = minutes <= 1 ? COLORS.primary : minutes <= 10 ? COLORS.green : '#F59E0B';

  return (
    <View style={[styles.badge, { backgroundColor: badgeColor + '15', borderColor: badgeColor + '30' }]}>
      <Ionicons name={icon as any} size={14} color={badgeColor} />
      <Text style={[styles.text, { color: badgeColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});

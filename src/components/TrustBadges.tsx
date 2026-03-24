import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const PRIMARY = '#006633';

const BADGES = [
  { icon: 'shield-checkmark' as const, label: 'Secure' },
  { icon: 'flash'            as const, label: 'Fast'   },
  { icon: 'eye'              as const, label: 'Transparent' },
];

interface TrustBadgesProps {
  variant?: 'row' | 'compact';
}

export default function TrustBadges({ variant = 'row' }: TrustBadgesProps) {
  if (variant === 'compact') {
    return (
      <View style={s.compactRow}>
        {BADGES.map((b) => (
          <View key={b.label} style={s.compactBadge}>
            <Ionicons name={b.icon} size={12} color={PRIMARY} />
            <Text style={s.compactText}>✔ {b.label}</Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={s.row}>
      {BADGES.map((b) => (
        <View key={b.label} style={s.badge}>
          <View style={s.iconWrap}>
            <Ionicons name={b.icon} size={18} color={PRIMARY} />
          </View>
          <Text style={s.label}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 14,
    paddingHorizontal: 8,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    marginBottom: 4,
  },
  badge: {
    alignItems: 'center',
    gap: 6,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#D1FAE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#064E3B',
  },
  compactRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
    paddingVertical: 8,
  },
  compactBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  compactText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
});

import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import AnimatedPressable from './AnimatedPressable';

const PRIMARY = '#006633';
const GOLD    = '#F59E0B';
const WHITE   = '#FFFFFF';
const GRAY    = '#6B7280';
const BG      = '#F3F4F6';
const TEXT    = '#1F2937';
const GREEN   = '#10B981';

interface BankOfferCardProps {
  bank: string;
  rate: number;
  fee: number;
  receiveAmount: number;
  deliveryTime: string;
  currency?: string;
  sendAmount?: number;
  sendCurrency?: string;
  selected?: boolean;
  bestRate?: boolean;
  mostPopular?: boolean;
  fastest?: boolean;
  onSelect: () => void;
}

export default function BankOfferCard({
  bank,
  rate,
  fee,
  receiveAmount,
  deliveryTime,
  currency = 'ETB',
  sendCurrency = 'EUR',
  selected = false,
  bestRate = false,
  mostPopular = false,
  fastest = false,
  onSelect,
}: BankOfferCardProps) {
  const { t } = useTranslation();

  const borderAnim = useRef(new Animated.Value(selected ? 1 : 0)).current;
  const glowAnim   = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(borderAnim, { toValue: selected ? 1 : 0, useNativeDriver: false, speed: 20 }),
      Animated.timing(glowAnim,   { toValue: selected ? 1 : 0, duration: 250, useNativeDriver: false }),
    ]).start();
  }, [selected]);

  const borderColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [bestRate ? GOLD : '#E5E7EB', PRIMARY],
  });
  const bgColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#FFFFFF', '#F0FFF4'],
  });

  const CURR_SYM: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
  const sym = CURR_SYM[sendCurrency] ?? '';

  return (
    <AnimatedPressable onPress={onSelect} hapticStyle="medium">
      <Animated.View style={[s.card, { borderColor, backgroundColor: bgColor }]}>

        {/* Top badges row */}
        {(bestRate || mostPopular || fastest) && (
          <View style={s.badgesRow}>
            {bestRate && (
              <View style={[s.badge, s.badgeGold]}>
                <Ionicons name="star" size={11} color="#92400E" />
                <Text style={[s.badgeText, { color: '#92400E' }]}>{t('fxMarketplace.bestRate')}</Text>
              </View>
            )}
            {mostPopular && (
              <View style={[s.badge, s.badgeBlue]}>
                <Ionicons name="trending-up" size={11} color="#1D4ED8" />
                <Text style={[s.badgeText, { color: '#1D4ED8' }]}>Most Popular</Text>
              </View>
            )}
            {fastest && (
              <View style={[s.badge, s.badgeGreen]}>
                <Ionicons name="flash" size={11} color="#065F46" />
                <Text style={[s.badgeText, { color: '#065F46' }]}>Fastest</Text>
              </View>
            )}
          </View>
        )}

        {/* Bank header */}
        <View style={s.header}>
          <View style={s.bankInfo}>
            <View style={[s.bankIcon, selected && s.bankIconSelected]}>
              <Ionicons name="business" size={20} color={selected ? WHITE : PRIMARY} />
            </View>
            <View>
              <Text style={s.bankName}>{bank}</Text>
              {bestRate && (
                <Text style={s.bestRateLabel}>Best available rate</Text>
              )}
            </View>
          </View>
          {selected && (
            <Animated.View style={{ opacity: borderAnim }}>
              <View style={s.checkCircle}>
                <Ionicons name="checkmark" size={16} color={WHITE} />
              </View>
            </Animated.View>
          )}
        </View>

        {/* Rate highlight for best rate */}
        {bestRate && (
          <View style={s.rateHighlight}>
            <View style={s.greenDot} />
            <Text style={s.rateHighlightText}>Best available · No hidden charges</Text>
          </View>
        )}

        {/* Details grid */}
        <View style={s.grid}>
          <View style={s.gridItem}>
            <Text style={s.gridLabel}>{t('fxMarketplace.rate')}</Text>
            <Text style={s.gridValue}>{rate.toFixed(2)}</Text>
          </View>
          <View style={s.gridItem}>
            <Text style={s.gridLabel}>{t('fxMarketplace.receive')}</Text>
            <Text style={[s.gridValue, { color: PRIMARY, fontSize: 16 }]}>
              {receiveAmount.toLocaleString()} {currency}
            </Text>
          </View>
          <View style={s.gridItem}>
            <Text style={s.gridLabel}>{t('fxMarketplace.fee')}</Text>
            <Text style={s.gridValue}>{sym}{fee.toFixed(2)}</Text>
          </View>
          <View style={s.gridItem}>
            <Text style={s.gridLabel}>{t('fxMarketplace.delivery')}</Text>
            <View style={s.deliveryRow}>
              <Ionicons name="time-outline" size={13} color={GREEN} />
              <Text style={[s.gridValue, { color: GREEN }]}>{deliveryTime}</Text>
            </View>
          </View>
        </View>

        {/* Select button */}
        <AnimatedPressable
          style={[s.selectBtn, selected && s.selectBtnActive]}
          onPress={onSelect}
          hapticStyle={selected ? 'none' : 'medium'}
          scaleDown={0.98}
        >
          <Text style={[s.selectBtnText, selected && s.selectBtnTextActive]}>
            {selected ? t('fxMarketplace.selected') : t('fxMarketplace.select')}
          </Text>
          {selected && <Ionicons name="checkmark" size={16} color={WHITE} />}
        </AnimatedPressable>
      </Animated.View>
    </AnimatedPressable>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  badgesRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 4,
  },
  badgeGold: {
    backgroundColor: '#FEF3C7',
  },
  badgeBlue: {
    backgroundColor: '#DBEAFE',
  },
  badgeGreen: {
    backgroundColor: '#D1FAE5',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  bankInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bankIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PRIMARY + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bankIconSelected: {
    backgroundColor: PRIMARY,
  },
  bankName: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT,
  },
  bestRateLabel: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '600',
    marginTop: 1,
  },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateHighlight: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  greenDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  rateHighlightText: {
    fontSize: 12,
    color: '#065F46',
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  gridItem: {
    width: '50%',
    marginBottom: 10,
  },
  gridLabel: {
    fontSize: 11,
    color: GRAY,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: '500',
  },
  gridValue: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
  },
  deliveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  selectBtn: {
    backgroundColor: BG,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  selectBtnActive: {
    backgroundColor: PRIMARY,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  selectBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT,
  },
  selectBtnTextActive: {
    color: WHITE,
  },
});

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import AnimatedPressable from '../components/AnimatedPressable';

const PRIMARY  = '#006633';
const WHITE    = '#FFFFFF';
const TEXT     = '#111827';
const SUBTEXT  = '#6B7280';
const BG       = '#F3F4F6';

export default function TransferSuccessScreen() {
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();

  const {
    recipientName  = 'Your recipient',
    sentAmount     = 0,
    sentCurrency   = 'EUR',
    receiveAmount  = 0,
    receiveCurrency = 'ETB',
    deliveryTime   = '1–2 business days',
    txId           = 'demo-tx',
  } = route.params ?? {};

  const scaleAnim   = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const slideAnim   = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}

    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 80,
        friction: 6,
      }),
      Animated.parallel([
        Animated.timing(opacityAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(slideAnim,   { toValue: 0,  duration: 350, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const CURR_SYM: Record<string, string> = {
    EUR: '€', USD: '$', GBP: '£', ETB: 'Br ', SAR: 'SR ', AED: 'AED ',
  };
  const fmtSend = `${CURR_SYM[sentCurrency] ?? ''}${Number(sentAmount).toLocaleString()}`;
  const fmtRcv  = `${CURR_SYM[receiveCurrency] ?? ''}${Number(receiveAmount).toLocaleString()}`;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.body}>

        {/* Animated check circle */}
        <Animated.View style={[s.checkWrap, { transform: [{ scale: scaleAnim }] }]}>
          <View style={s.checkCircle}>
            <Ionicons name="checkmark" size={56} color={WHITE} />
          </View>
          <View style={s.checkRing} />
        </Animated.View>

        {/* Message */}
        <Animated.View style={{ opacity: opacityAnim, transform: [{ translateY: slideAnim }] }}>
          <Text style={s.headline}>Money on the way!</Text>
          <Text style={s.subHeadline}>
            Sending to{' '}
            <Text style={s.recipientName}>{recipientName}</Text>
          </Text>
        </Animated.View>

        {/* Transfer details card */}
        <Animated.View style={[s.detailCard, { opacity: opacityAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={s.detailRow}>
            <Text style={s.detailLabel}>You Sent</Text>
            <Text style={s.detailValue}>{fmtSend}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.detailRow}>
            <Text style={s.detailLabel}>They Receive</Text>
            <Text style={[s.detailValue, { color: PRIMARY }]}>{fmtRcv}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.detailRow}>
            <Text style={s.detailLabel}>Delivery Estimate</Text>
            <View style={s.deliveryRow}>
              <Ionicons name="time-outline" size={14} color="#10B981" />
              <Text style={[s.detailValue, { color: '#059669' }]}>{deliveryTime}</Text>
            </View>
          </View>
        </Animated.View>

        {/* Trust note */}
        <Animated.View style={[s.trustNote, { opacity: opacityAnim }]}>
          <Ionicons name="shield-checkmark" size={16} color={PRIMARY} />
          <Text style={s.trustNoteText}>
            Secure transfer powered by licensed financial partners
          </Text>
        </Animated.View>
      </View>

      {/* CTA buttons */}
      <Animated.View style={[s.actions, { opacity: opacityAnim }]}>
        <AnimatedPressable
          style={s.trackBtn}
          hapticStyle="light"
          onPress={() => navigation.navigate('TransferTracking', { txId })}
        >
          <Ionicons name="locate" size={18} color={PRIMARY} />
          <Text style={s.trackBtnText}>Track Transfer</Text>
        </AnimatedPressable>

        <AnimatedPressable
          style={s.sendAgainBtn}
          hapticStyle="medium"
          onPress={() => navigation.navigate('Remittance')}
        >
          <Ionicons name="send" size={18} color={WHITE} />
          <Text style={s.sendAgainBtnText}>Send Again</Text>
        </AnimatedPressable>

        <AnimatedPressable
          style={s.doneBtn}
          hapticStyle="none"
          onPress={() => navigation.navigate('Dashboard')}
        >
          <Text style={s.doneBtnText}>Done</Text>
        </AnimatedPressable>
      </Animated.View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 20,
  },
  checkWrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
  },
  checkRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: PRIMARY + '30',
  },
  headline: {
    fontSize: 28,
    fontWeight: '800',
    color: TEXT,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subHeadline: {
    fontSize: 16,
    color: SUBTEXT,
    textAlign: 'center',
    marginTop: 6,
  },
  recipientName: {
    color: PRIMARY,
    fontWeight: '700',
  },
  detailCard: {
    backgroundColor: WHITE,
    borderRadius: 20,
    padding: 20,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  detailLabel: {
    fontSize: 14,
    color: SUBTEXT,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT,
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
  },
  deliveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trustNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
  },
  trustNoteText: {
    flex: 1,
    fontSize: 12,
    color: SUBTEXT,
    lineHeight: 17,
  },
  actions: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 10,
  },
  trackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: PRIMARY,
    paddingVertical: 15,
    borderRadius: 14,
    gap: 8,
    backgroundColor: WHITE,
  },
  trackBtnText: {
    color: PRIMARY,
    fontSize: 16,
    fontWeight: '700',
  },
  sendAgainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    paddingVertical: 15,
    borderRadius: 14,
    gap: 8,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  sendAgainBtnText: {
    color: WHITE,
    fontSize: 16,
    fontWeight: '700',
  },
  doneBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  doneBtnText: {
    color: SUBTEXT,
    fontSize: 15,
    fontWeight: '600',
  },
});

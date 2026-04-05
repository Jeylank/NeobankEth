import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRoute, useNavigation } from '@react-navigation/native';
import {
  db,
  collection,
  query,
  where,
  onSnapshot,
} from '../services/firebase';
import { SkeletonCard } from '../components/SkeletonLoader';

const PRIMARY   = '#006633';
const WHITE     = '#FFFFFF';
const BG        = '#F3F4F6';
const TEXT      = '#1F2937';
const SUBTEXT   = '#6B7280';
const BORDER    = '#E5E7EB';
const SUCCESS   = '#10B981';
const WARN      = '#F59E0B';

interface TimelineStep {
  key: string;
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  status: 'completed' | 'active' | 'pending';
  timestamp?: Date;
  details?: string;
}

interface StatusUpdate {
  txId: string;
  status: string;
  provider: string;
  updatedAt: any;
  details?: string;
}

const STEP_ORDER = ['initiated', 'fx_conversion', 'processing', 'sent_to_provider', 'delivered'];

const STEP_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  initiated:         'play-circle',
  fx_conversion:     'swap-horizontal',
  processing:        'sync',
  sent_to_provider:  'paper-plane',
  delivered:         'checkmark-circle',
};

const STEP_LABEL_KEYS: Record<string, string> = {
  initiated:        'tracking.initiated',
  fx_conversion:    'tracking.fxConversion',
  processing:       'tracking.processing',
  sent_to_provider: 'tracking.sentToProvider',
  delivered:        'tracking.delivered',
};

const STEP_DESCS: Record<string, string> = {
  initiated:        'Transfer request received and verified',
  fx_conversion:    'Currency converted at the best available rate',
  processing:       'Payment is being processed by our partner',
  sent_to_provider: 'Sent to your recipient\'s financial institution',
  delivered:        'Funds delivered successfully',
};

function getMockUpdates(txId: string): StatusUpdate[] {
  const now = Date.now();
  return [
    { txId, status: 'initiated',    provider: 'Sumsuma', updatedAt: { toDate: () => new Date(now - 4 * 60000) }, details: 'Transfer request received' },
    { txId, status: 'fx_conversion',provider: 'Sumsuma', updatedAt: { toDate: () => new Date(now - 3 * 60000) }, details: 'Currency converted at market rate' },
    { txId, status: 'processing',   provider: 'Sumsuma', updatedAt: { toDate: () => new Date(now - 2 * 60000) }, details: 'Payment being processed' },
  ];
}

function buildTimeline(updates: StatusUpdate[], t: (key: string) => string): TimelineStep[] {
  const completedStatuses = new Set(updates.map((u) => u.status));
  const updateMap = new Map<string, StatusUpdate>();
  updates.forEach((u) => updateMap.set(u.status, u));

  let lastCompleted = -1;
  for (let i = 0; i < STEP_ORDER.length; i++) {
    if (completedStatuses.has(STEP_ORDER[i])) lastCompleted = i;
  }

  return STEP_ORDER.map((key, i) => {
    const update = updateMap.get(key);
    const status: 'completed' | 'active' | 'pending' =
      i < lastCompleted ? 'completed' : i === lastCompleted ? 'active' : 'pending';
    return {
      key,
      labelKey: STEP_LABEL_KEYS[key],
      icon: STEP_ICONS[key],
      status,
      timestamp: update?.updatedAt?.toDate?.() ?? undefined,
      details: update?.details,
    };
  });
}

export default function TransferTrackingScreen() {
  const { t }       = useTranslation();
  const route       = useRoute<any>();
  const navigation  = useNavigation<any>();
  const txId: string = route.params?.txId ?? 'demo-tx';

  const [steps, setSteps]       = useState<TimelineStep[]>([]);
  const [loading, setLoading]   = useState(true);
  const [provider, setProvider] = useState('');

  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeAnims    = useRef(STEP_ORDER.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    // Query without orderBy to avoid needing a composite Firestore index.
    // Sort client-side instead.
    const q = query(
      collection(db, 'transfer_status_updates'),
      where('txId', '==', txId),
    );

    const applyUpdates = (updates: StatusUpdate[]) => {
      // Sort client-side by updatedAt ascending
      const sorted = [...updates].sort((a, b) => {
        const aMs = a.updatedAt?.toDate?.()?.getTime() ?? 0;
        const bMs = b.updatedAt?.toDate?.()?.getTime() ?? 0;
        return aMs - bMs;
      });
      // Fall back to mock data when no real updates exist yet
      const source = sorted.length > 0 ? sorted : getMockUpdates(txId);
      const built = buildTimeline(source, t);
      setSteps(built);
      if (source.length > 0) setProvider(source[0].provider);
      setLoading(false);
      animateIn(built);
    };

    const unsub = onSnapshot(
      q,
      (snap) => applyUpdates(snap.docs.map((d) => d.data() as StatusUpdate)),
      (_err) => {
        // Firestore error (e.g. missing index or collection) — show mock data
        applyUpdates([]);
      },
    );

    return () => unsub();
  }, [txId]);

  const animateIn = (builtSteps: TimelineStep[]) => {
    const completedCount = builtSteps.filter((s) => s.status !== 'pending').length;
    const progress = completedCount / STEP_ORDER.length;

    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 800,
      useNativeDriver: false,
    }).start();

    builtSteps.forEach((_, i) => {
      Animated.timing(fadeAnims[i], {
        toValue: 1,
        duration: 350,
        delay: i * 100,
        useNativeDriver: true,
      }).start();
    });
  };

  const formatTime = (date?: Date) => {
    if (!date) return '';
    return (
      date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) +
      ' · ' +
      date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
    );
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const completedCount = steps.filter((s) => s.status !== 'pending').length;
  const isDelivered    = steps.find((s) => s.key === 'delivered')?.status === 'active';

  return (
    <SafeAreaView style={s.container}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={WHITE} />
        </TouchableOpacity>
        <View style={s.headerContent}>
          <Ionicons name="locate" size={22} color={WHITE} />
          <Text style={s.headerTitle}>{t('tracking.liveTracking')}</Text>
          <Text style={s.headerSub}>Real-time transfer status</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>

        {loading ? (
          <View style={{ gap: 12 }}>
            <SkeletonCard />
            <SkeletonCard />
          </View>
        ) : (
          <>
            {/* Overall progress bar */}
            <View style={s.progressCard}>
              <View style={s.progressHeader}>
                <Text style={s.progressLabel}>Transfer Progress</Text>
                <Text style={s.progressPct}>
                  {Math.round((completedCount / STEP_ORDER.length) * 100)}%
                </Text>
              </View>
              <View style={s.progressBarBg}>
                <Animated.View style={[s.progressBarFill, { width: progressWidth }]} />
              </View>
              <Text style={s.progressSub}>
                {completedCount} of {STEP_ORDER.length} steps completed
              </Text>
            </View>

            {/* TX Info card */}
            <View style={s.infoCard}>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Transaction ID</Text>
                <Text style={s.infoValue} selectable>#{txId}</Text>
              </View>
              {provider ? (
                <View style={[s.infoRow, { borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 10 }]}>
                  <Text style={s.infoLabel}>Processed via</Text>
                  <Text style={s.infoValue}>{provider}</Text>
                </View>
              ) : null}
              {isDelivered && (
                <View style={s.deliveredBanner}>
                  <Ionicons name="checkmark-circle" size={18} color={SUCCESS} />
                  <Text style={s.deliveredText}>Delivered successfully!</Text>
                </View>
              )}
            </View>

            {/* Timeline */}
            <View style={s.timelineCard}>
              <Text style={s.timelineTitle}>{t('tracking.statusUpdate')}</Text>
              {steps.map((step, idx) => {
                const isLast  = idx === steps.length - 1;
                const dotColor =
                  step.status === 'completed' ? SUCCESS :
                  step.status === 'active'    ? PRIMARY :
                  BORDER;

                return (
                  <Animated.View
                    key={step.key}
                    style={[s.stepRow, { opacity: fadeAnims[idx] }]}
                  >
                    {/* Dot + line */}
                    <View style={s.dotCol}>
                      <View style={[
                        s.dot,
                        step.status === 'pending' && s.dotPending,
                        { backgroundColor: step.status === 'pending' ? WHITE : dotColor },
                        step.status === 'active' && s.dotActive,
                      ]}>
                        {step.status === 'completed' ? (
                          <Ionicons name="checkmark" size={13} color={WHITE} />
                        ) : step.status === 'active' ? (
                          <Ionicons name={step.icon} size={13} color={WHITE} />
                        ) : (
                          <Ionicons name={step.icon} size={13} color={SUBTEXT} />
                        )}
                      </View>
                      {!isLast && (
                        <View style={[
                          s.line,
                          { backgroundColor: step.status === 'completed' ? SUCCESS : BORDER },
                        ]} />
                      )}
                    </View>

                    {/* Content */}
                    <View style={s.stepContent}>
                      <Text style={[
                        s.stepLabel,
                        step.status !== 'pending' && s.stepLabelActive,
                      ]}>
                        {t(step.labelKey)}
                      </Text>
                      {step.status !== 'pending' && (
                        <Text style={s.stepDesc}>{STEP_DESCS[step.key]}</Text>
                      )}
                      {step.timestamp && (
                        <Text style={s.stepTime}>{formatTime(step.timestamp)}</Text>
                      )}
                      {step.status === 'active' && (
                        <View style={s.activePill}>
                          <View style={s.activeDot} />
                          <Text style={s.activeText}>In Progress</Text>
                        </View>
                      )}
                    </View>
                  </Animated.View>
                );
              })}
            </View>

            {/* Trust note */}
            <View style={s.trustNote}>
              <Ionicons name="shield-checkmark" size={16} color={PRIMARY} />
              <Text style={s.trustNoteText}>
                Trusted by Ethiopian diaspora worldwide · Powered by licensed financial partners
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 16,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerContent: {
    alignItems: 'center',
    gap: 3,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: WHITE,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 14, paddingBottom: 32 },

  /* Progress card */
  progressCard: {
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 18,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
  },
  progressPct: {
    fontSize: 20,
    fontWeight: '800',
    color: PRIMARY,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: BG,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: 8,
    backgroundColor: PRIMARY,
    borderRadius: 4,
  },
  progressSub: {
    fontSize: 12,
    color: SUBTEXT,
  },

  /* Info card */
  infoCard: {
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 18,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoLabel: {
    fontSize: 13,
    color: SUBTEXT,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '700',
    color: TEXT,
  },
  deliveredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    marginTop: 6,
  },
  deliveredText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#065F46',
  },

  /* Timeline card */
  timelineCard: {
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 18,
  },
  timelineTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT,
    marginBottom: 20,
  },
  stepRow: {
    flexDirection: 'row',
    minHeight: 64,
  },
  dotCol: {
    alignItems: 'center',
    width: 30,
  },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotPending: {
    borderWidth: 2,
    borderColor: BORDER,
  },
  dotActive: {
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  line: {
    flex: 1,
    width: 2,
    marginVertical: 4,
  },
  stepContent: {
    flex: 1,
    marginLeft: 14,
    paddingBottom: 24,
  },
  stepLabel: {
    fontSize: 15,
    color: SUBTEXT,
    fontWeight: '500',
  },
  stepLabelActive: {
    color: TEXT,
    fontWeight: '700',
  },
  stepDesc: {
    fontSize: 12,
    color: SUBTEXT,
    marginTop: 3,
    lineHeight: 17,
  },
  stepTime: {
    fontSize: 11,
    color: SUBTEXT,
    marginTop: 4,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: PRIMARY + '12',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: 'flex-start',
    gap: 6,
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: PRIMARY,
  },
  activeText: {
    fontSize: 11,
    color: PRIMARY,
    fontWeight: '700',
  },

  /* Trust note */
  trustNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  trustNoteText: {
    flex: 1,
    fontSize: 12,
    color: '#065F46',
    lineHeight: 17,
    fontWeight: '500',
  },
});

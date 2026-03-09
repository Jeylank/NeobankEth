import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRoute } from '@react-navigation/native';
import {
  db,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from '../services/firebase';

const COLORS = {
  primary: '#006633',
  gold: '#FFD700',
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
};

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
  initiated: 'play-circle',
  fx_conversion: 'swap-horizontal',
  processing: 'sync',
  sent_to_provider: 'paper-plane',
  delivered: 'checkmark-circle',
};

const STEP_LABEL_KEYS: Record<string, string> = {
  initiated: 'tracking.initiated',
  fx_conversion: 'tracking.fxConversion',
  processing: 'tracking.processing',
  sent_to_provider: 'tracking.sentToProvider',
  delivered: 'tracking.delivered',
};

function getMockUpdates(txId: string): StatusUpdate[] {
  const now = Date.now();
  return [
    {
      txId,
      status: 'initiated',
      provider: 'Habeshare',
      updatedAt: { toDate: () => new Date(now - 4 * 60000) },
      details: 'Transfer request received',
    },
    {
      txId,
      status: 'fx_conversion',
      provider: 'Habeshare',
      updatedAt: { toDate: () => new Date(now - 3 * 60000) },
      details: 'Currency converted at market rate',
    },
    {
      txId,
      status: 'processing',
      provider: 'Habeshare',
      updatedAt: { toDate: () => new Date(now - 2 * 60000) },
      details: 'Payment being processed',
    },
  ];
}

function buildTimeline(updates: StatusUpdate[], t: (key: string) => string): TimelineStep[] {
  const completedStatuses = new Set(updates.map((u) => u.status));
  const updateMap = new Map<string, StatusUpdate>();
  updates.forEach((u) => {
    updateMap.set(u.status, u);
  });

  let foundActive = false;
  const steps: TimelineStep[] = [];

  for (let i = STEP_ORDER.length - 1; i >= 0; i--) {
    const key = STEP_ORDER[i];
    if (completedStatuses.has(key)) {
      foundActive = true;
    }
  }

  let lastCompleted = -1;
  for (let i = 0; i < STEP_ORDER.length; i++) {
    if (completedStatuses.has(STEP_ORDER[i])) {
      lastCompleted = i;
    }
  }

  for (let i = 0; i < STEP_ORDER.length; i++) {
    const key = STEP_ORDER[i];
    const update = updateMap.get(key);
    let status: 'completed' | 'active' | 'pending';

    if (i < lastCompleted) {
      status = 'completed';
    } else if (i === lastCompleted) {
      status = 'active';
    } else {
      status = 'pending';
    }

    steps.push({
      key,
      labelKey: STEP_LABEL_KEYS[key],
      icon: STEP_ICONS[key],
      status,
      timestamp: update?.updatedAt?.toDate?.() ?? undefined,
      details: update?.details,
    });
  }

  return steps;
}

export default function TransferTrackingScreen() {
  const { t } = useTranslation();
  const route = useRoute<any>();
  const txId: string = route.params?.txId ?? 'demo-tx';

  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState('');

  useEffect(() => {
    if (__DEV__) {
      const mockUpdates = getMockUpdates(txId);
      setSteps(buildTimeline(mockUpdates, t));
      if (mockUpdates.length > 0) {
        setProvider(mockUpdates[0].provider);
      }
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'transfer_status_updates'),
      where('txId', '==', txId),
      orderBy('updatedAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const updates: StatusUpdate[] = snapshot.docs.map((doc) => doc.data() as StatusUpdate);
      setSteps(buildTimeline(updates, t));
      if (updates.length > 0) {
        setProvider(updates[0].provider);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [txId]);

  const formatTime = (date?: Date) => {
    if (!date) return '';
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }) + ' · ' + date.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
    });
  };

  const getStepColor = (status: 'completed' | 'active' | 'pending') => {
    switch (status) {
      case 'completed':
        return COLORS.success;
      case 'active':
        return COLORS.primary;
      case 'pending':
        return COLORS.border;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="locate" size={24} color={COLORS.white} />
        <Text style={styles.title}>{t('tracking.liveTracking')}</Text>
        <Text style={styles.subtitle}>{t('tracking.transferTimeline')}</Text>
      </View>

      <ScrollView style={styles.scrollView}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <>
            <View style={styles.txInfoCard}>
              <View style={styles.txInfoRow}>
                <Text style={styles.txInfoLabel}>{t('tracking.transactionId') || 'Transaction ID'}</Text>
                <Text style={styles.txInfoValue}>#{txId}</Text>
              </View>
              {provider ? (
                <View style={styles.txInfoRow}>
                  <Text style={styles.txInfoLabel}>{t('tracking.provider') || 'Provider'}</Text>
                  <Text style={styles.txInfoValue}>{provider}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.timelineCard}>
              <Text style={styles.timelineTitle}>{t('tracking.statusUpdate')}</Text>
              {steps.map((step, index) => {
                const color = getStepColor(step.status);
                const isLast = index === steps.length - 1;
                return (
                  <View key={step.key} style={styles.timelineStep}>
                    <View style={styles.timelineDotContainer}>
                      <View
                        style={[
                          styles.timelineDot,
                          { backgroundColor: step.status === 'pending' ? COLORS.white : color },
                          step.status === 'pending' && styles.timelineDotPending,
                        ]}
                      >
                        {step.status === 'completed' ? (
                          <Ionicons name="checkmark" size={14} color={COLORS.white} />
                        ) : step.status === 'active' ? (
                          <Ionicons name={step.icon} size={14} color={COLORS.white} />
                        ) : (
                          <Ionicons name={step.icon} size={14} color={COLORS.textSecondary} />
                        )}
                      </View>
                      {!isLast && (
                        <View
                          style={[
                            styles.timelineLine,
                            {
                              backgroundColor:
                                step.status === 'completed' ? COLORS.success : COLORS.border,
                            },
                          ]}
                        />
                      )}
                    </View>
                    <View style={styles.timelineContent}>
                      <Text
                        style={[
                          styles.timelineLabel,
                          step.status !== 'pending' && styles.timelineLabelActive,
                        ]}
                      >
                        {t(step.labelKey)}
                      </Text>
                      {step.timestamp && (
                        <Text style={styles.timelineTime}>{formatTime(step.timestamp)}</Text>
                      )}
                      {step.details && step.status !== 'pending' && (
                        <Text style={styles.timelineDetails}>{step.details}</Text>
                      )}
                      {step.status === 'active' && (
                        <View style={styles.activeBadge}>
                          <View style={styles.activeDot} />
                          <Text style={styles.activeText}>{t('tracking.inProgress') || 'In Progress'}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    padding: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    gap: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.white,
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.white,
    opacity: 0.8,
  },
  scrollView: {
    flex: 1,
    padding: 20,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  txInfoCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  txInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  txInfoLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  txInfoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  timelineCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
  },
  timelineTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 20,
  },
  timelineStep: {
    flexDirection: 'row',
    minHeight: 60,
  },
  timelineDotContainer: {
    alignItems: 'center',
    width: 28,
  },
  timelineDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotPending: {
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    marginVertical: 4,
  },
  timelineContent: {
    flex: 1,
    marginLeft: 14,
    paddingBottom: 24,
  },
  timelineLabel: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  timelineLabelActive: {
    color: COLORS.text,
    fontWeight: '600',
  },
  timelineTime: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  timelineDetails: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
    fontStyle: 'italic',
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    gap: 6,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  activeText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
});

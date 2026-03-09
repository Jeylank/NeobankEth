import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS } from '../theme/colors';

interface RateLockTimerProps {
  lockId?: string;
  expiresAt?: string;
  onExpired?: () => void;
  onLock?: () => Promise<{ lockId: string; expiresAt: string } | void>;
}

export const RateLockTimer: React.FC<RateLockTimerProps> = ({
  lockId,
  expiresAt,
  onExpired,
  onLock,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [isLocked, setIsLocked] = useState<boolean>(!!lockId && !!expiresAt);
  const [isExpired, setIsExpired] = useState<boolean>(false);
  const [isLocking, setIsLocking] = useState<boolean>(false);
  const [currentLockId, setCurrentLockId] = useState<string | undefined>(lockId);
  const [currentExpiresAt, setCurrentExpiresAt] = useState<string | undefined>(expiresAt);
  const progressAnim = useRef(new Animated.Value(1)).current;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const calculateRemaining = useCallback((expiry: string): number => {
    const remaining = Math.max(0, Math.floor((new Date(expiry).getTime() - Date.now()) / 1000));
    return remaining;
  }, []);

  useEffect(() => {
    if (lockId && expiresAt) {
      setCurrentLockId(lockId);
      setCurrentExpiresAt(expiresAt);
      setIsLocked(true);
      setIsExpired(false);
      const remaining = calculateRemaining(expiresAt);
      setSecondsRemaining(remaining);
      progressAnim.setValue(remaining / 60);
    }
  }, [lockId, expiresAt]);

  useEffect(() => {
    if (!isLocked || !currentExpiresAt) return;

    intervalRef.current = setInterval(() => {
      const remaining = calculateRemaining(currentExpiresAt);
      setSecondsRemaining(remaining);
      progressAnim.setValue(remaining / 60);

      if (remaining <= 0) {
        setIsExpired(true);
        setIsLocked(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        onExpired?.();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isLocked, currentExpiresAt, onExpired, calculateRemaining]);

  const handleLock = async () => {
    if (!onLock) return;
    setIsLocking(true);
    try {
      const result = await onLock();
      if (result) {
        setCurrentLockId(result.lockId);
        setCurrentExpiresAt(result.expiresAt);
        setIsLocked(true);
        setIsExpired(false);
        const remaining = calculateRemaining(result.expiresAt);
        setSecondsRemaining(remaining);
        progressAnim.setValue(remaining / 60);
      }
    } catch (e) {
      console.error('Failed to lock rate:', e);
    } finally {
      setIsLocking(false);
    }
  };

  const handleRefresh = () => {
    setIsExpired(false);
    setIsLocked(false);
    setCurrentLockId(undefined);
    setCurrentExpiresAt(undefined);
    setSecondsRemaining(0);
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const progressColor = secondsRemaining <= 10 ? colors.error : colors.primary;

  if (isExpired) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.error }]}>
        <View style={styles.expiredRow}>
          <Ionicons name="alert-circle" size={20} color={colors.error} />
          <Text style={[styles.expiredText, { color: colors.error }]}>
            {t('rateLock.rateExpired', 'Rate Expired')}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.refreshButton, { backgroundColor: colors.primary }]}
          onPress={handleRefresh}
        >
          <Ionicons name="refresh" size={16} color="#FFFFFF" />
          <Text style={styles.refreshButtonText}>
            {t('rateLock.refreshRate', 'Refresh Rate')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!isLocked) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.lockButton, { backgroundColor: colors.primary }]}
          onPress={handleLock}
          disabled={isLocking}
        >
          <Ionicons name="lock-closed" size={16} color="#FFFFFF" />
          <Text style={styles.lockButtonText}>
            {isLocking
              ? t('rateLock.lockingRate', 'Locking Rate...')
              : t('rateLock.lockRate', 'Lock Rate')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
      <View style={styles.lockedRow}>
        <Ionicons name="lock-closed" size={18} color={colors.primary} />
        <Text style={[styles.lockedText, { color: colors.text }]}>
          {t('rateLock.rateLocked', 'Rate Locked')}
        </Text>
      </View>

      <View style={[styles.progressBarBg, { backgroundColor: colors.border }]}>
        <Animated.View
          style={[
            styles.progressBarFill,
            { width: progressWidth, backgroundColor: progressColor },
          ]}
        />
      </View>

      <Text style={[styles.timerText, { color: secondsRemaining <= 10 ? colors.error : colors.textSecondary }]}>
        {t('rateLock.rateLockedFor', 'Rate locked for')}{' '}
        <Text style={styles.timerBold}>{secondsRemaining}</Text>{' '}
        {t('rateLock.secondsRemaining', 'seconds remaining')}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginVertical: SPACING.sm,
  },
  lockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    gap: SPACING.sm,
  },
  lockButtonText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  lockedText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  timerText: {
    fontSize: FONT_SIZES.sm,
    textAlign: 'center',
  },
  timerBold: {
    fontWeight: '700',
  },
  expiredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  expiredText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    gap: SPACING.xs,
  },
  refreshButtonText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
});

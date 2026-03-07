import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { biometricService } from '../services/biometric';
import {
  SessionManager,
  isBiometricConfirmEnabled,
  setBiometricConfirmEnabled,
} from '../utils/security';

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
  blue: '#3B82F6',
};

const TIMEOUT_OPTIONS = [1, 5, 15, 30];

export default function SecuritySettingsScreen() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);

  const [sessionTimeoutEnabled, setSessionTimeoutEnabled] = useState(true);
  const [timeoutMinutes, setTimeoutMinutes] = useState(5);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricConfirm, setBiometricConfirm] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const timeout = await SessionManager.getTimeoutMinutes();
      setTimeoutMinutes(timeout);
      setSessionTimeoutEnabled(timeout > 0);

      const bioAvailable = await biometricService.isAvailable();
      setBiometricAvailable(bioAvailable);
      if (bioAvailable) {
        const bioEnabled = await biometricService.isEnabled();
        setBiometricEnabled(bioEnabled);
      }

      const confirmEnabled = await isBiometricConfirmEnabled();
      setBiometricConfirm(confirmEnabled);
    } catch (err) {
      console.error('Failed to load security settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleTimeoutToggle = async (value: boolean) => {
    setSessionTimeoutEnabled(value);
    if (!value) {
      await SessionManager.setTimeoutMinutes(0);
    } else {
      await SessionManager.setTimeoutMinutes(5);
      setTimeoutMinutes(5);
    }
  };

  const handleTimeoutChange = async (minutes: number) => {
    setTimeoutMinutes(minutes);
    await SessionManager.setTimeoutMinutes(minutes);
  };

  const handleBiometricConfirmToggle = async (value: boolean) => {
    setBiometricConfirm(value);
    await setBiometricConfirmEnabled(value);
  };

  const handleChangePassword = () => {
    Alert.alert(
      t('security.changePassword'),
      t('security.changePasswordDesc')
    );
  };

  const handleTwoFactorToggle = (value: boolean) => {
    if (value) {
      Alert.alert(
        t('security.twoFactor'),
        t('security.twoFactorComingSoon')
      );
    }
    setTwoFactorEnabled(false);
  };

  const recentSessions = [
    { device: t('security.currentDevice'), time: new Date().toLocaleString(), current: true },
    { device: 'Chrome - Windows', time: new Date(Date.now() - 86400000).toLocaleString(), current: false },
    { device: 'Safari - iPhone', time: new Date(Date.now() - 172800000).toLocaleString(), current: false },
  ];

  const securityTips = [
    { icon: 'lock-closed-outline' as const, key: 'tip1' },
    { icon: 'finger-print-outline' as const, key: 'tip2' },
    { icon: 'wifi-outline' as const, key: 'tip3' },
    { icon: 'refresh-outline' as const, key: 'tip4' },
  ];

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('security.sessionTimeout')}</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Ionicons name="timer-outline" size={22} color={COLORS.textSecondary} />
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>{t('security.autoLogout')}</Text>
                <Text style={styles.settingDesc}>{t('security.autoLogoutDesc')}</Text>
              </View>
            </View>
            <Switch
              value={sessionTimeoutEnabled}
              onValueChange={handleTimeoutToggle}
              trackColor={{ false: '#E5E7EB', true: '#BBF7D0' }}
              thumbColor={sessionTimeoutEnabled ? COLORS.primary : '#9CA3AF'}
            />
          </View>

          {sessionTimeoutEnabled && (
            <View style={styles.timeoutPicker}>
              <Text style={styles.pickerLabel}>{t('security.timeoutDuration')}</Text>
              <View style={styles.timeoutOptions}>
                {TIMEOUT_OPTIONS.map((minutes) => (
                  <TouchableOpacity
                    key={minutes}
                    style={[
                      styles.timeoutOption,
                      timeoutMinutes === minutes && styles.timeoutOptionActive,
                    ]}
                    onPress={() => handleTimeoutChange(minutes)}
                  >
                    <Text
                      style={[
                        styles.timeoutOptionText,
                        timeoutMinutes === minutes && styles.timeoutOptionTextActive,
                      ]}
                    >
                      {minutes} {t('security.min')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('security.authentication')}</Text>
        <View style={styles.card}>
          {biometricAvailable && (
            <View style={[styles.settingRow, styles.settingRowBorder]}>
              <View style={styles.settingInfo}>
                <Ionicons name="finger-print-outline" size={22} color={COLORS.textSecondary} />
                <View style={styles.settingText}>
                  <Text style={styles.settingLabel}>{t('security.biometricAuth')}</Text>
                  <Text style={styles.settingDesc}>
                    {biometricEnabled ? t('security.enabled') : t('security.disabled')}
                  </Text>
                </View>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: biometricEnabled ? '#BBF7D0' : '#FEE2E2' }]}>
                <Text style={[styles.statusText, { color: biometricEnabled ? COLORS.success : COLORS.error }]}>
                  {biometricEnabled ? t('security.on') : t('security.off')}
                </Text>
              </View>
            </View>
          )}

          {biometricAvailable && (
            <View style={[styles.settingRow, styles.settingRowBorder]}>
              <View style={styles.settingInfo}>
                <Ionicons name="shield-checkmark-outline" size={22} color={COLORS.textSecondary} />
                <View style={styles.settingText}>
                  <Text style={styles.settingLabel}>{t('security.confirmSensitive')}</Text>
                  <Text style={styles.settingDesc}>{t('security.confirmSensitiveDesc')}</Text>
                </View>
              </View>
              <Switch
                value={biometricConfirm}
                onValueChange={handleBiometricConfirmToggle}
                trackColor={{ false: '#E5E7EB', true: '#BBF7D0' }}
                thumbColor={biometricConfirm ? COLORS.primary : '#9CA3AF'}
              />
            </View>
          )}

          <TouchableOpacity style={[styles.settingRow, styles.settingRowBorder]} onPress={handleChangePassword}>
            <View style={styles.settingInfo}>
              <Ionicons name="key-outline" size={22} color={COLORS.textSecondary} />
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>{t('security.changePassword')}</Text>
                <Text style={styles.settingDesc}>{t('security.changePasswordDesc')}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Ionicons name="phone-portrait-outline" size={22} color={COLORS.textSecondary} />
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>{t('security.twoFactor')}</Text>
                <Text style={styles.settingDesc}>{t('security.twoFactorDesc')}</Text>
              </View>
            </View>
            <Switch
              value={twoFactorEnabled}
              onValueChange={handleTwoFactorToggle}
              trackColor={{ false: '#E5E7EB', true: '#BBF7D0' }}
              thumbColor={twoFactorEnabled ? COLORS.primary : '#9CA3AF'}
            />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('security.loginActivity')}</Text>
        <View style={styles.card}>
          {recentSessions.map((session, index) => (
            <View
              key={index}
              style={[
                styles.sessionRow,
                index < recentSessions.length - 1 && styles.settingRowBorder,
              ]}
            >
              <View style={styles.sessionInfo}>
                <Ionicons
                  name={session.current ? 'phone-portrait' : 'desktop-outline'}
                  size={20}
                  color={session.current ? COLORS.primary : COLORS.textSecondary}
                />
                <View style={styles.sessionText}>
                  <Text style={styles.sessionDevice}>
                    {session.device}
                    {session.current && (
                      <Text style={styles.currentBadge}> ({t('security.current')})</Text>
                    )}
                  </Text>
                  <Text style={styles.sessionTime}>{session.time}</Text>
                </View>
              </View>
              {session.current && (
                <View style={[styles.statusBadge, { backgroundColor: '#BBF7D0' }]}>
                  <Text style={[styles.statusText, { color: COLORS.success }]}>
                    {t('security.active')}
                  </Text>
                </View>
              )}
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('security.securityTips')}</Text>
        <View style={styles.card}>
          {securityTips.map((tip, index) => (
            <View
              key={index}
              style={[
                styles.tipRow,
                index < securityTips.length - 1 && styles.settingRowBorder,
              ]}
            >
              <View style={styles.tipIcon}>
                <Ionicons name={tip.icon} size={20} color={COLORS.primary} />
              </View>
              <Text style={styles.tipText}>{t(`security.${tip.key}`)}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  settingRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  settingText: {
    marginLeft: 12,
    flex: 1,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
  },
  settingDesc: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  timeoutPicker: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  pickerLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  timeoutOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  timeoutOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    alignItems: 'center',
  },
  timeoutOptionActive: {
    backgroundColor: COLORS.primary,
  },
  timeoutOptionText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  timeoutOptionTextActive: {
    color: COLORS.white,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  sessionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sessionText: {
    marginLeft: 12,
  },
  sessionDevice: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  currentBadge: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  sessionTime: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  tipIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  tipText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
    lineHeight: 20,
  },
  bottomPadding: {
    height: 40,
  },
});

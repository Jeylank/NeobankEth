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
  Modal,
  TextInput,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { biometricService } from '../services/biometric';
import { twoFactorService } from '../services/twoFactorService';
import { useAuth } from '../hooks/useAuth';
import {
  SessionManager,
  isBiometricConfirmEnabled,
  setBiometricConfirmEnabled,
} from '../utils/security';
import { firebaseAuth } from '../services/firebase';

const COLORS = {
  primary:       '#006633',
  gold:          '#FFD700',
  white:         '#FFFFFF',
  background:    '#F5F5F5',
  text:          '#1F2937',
  textSecondary: '#6B7280',
  border:        '#E5E7EB',
  success:       '#10B981',
  error:         '#EF4444',
  warning:       '#F59E0B',
  blue:          '#3B82F6',
  lightGreen:    '#ECFDF5',
};

const TIMEOUT_OPTIONS = [1, 5, 15, 30];

export default function SecuritySettingsScreen() {
  const { t }         = useTranslation();
  const navigation    = useNavigation<any>();
  const { user }      = useAuth();

  const [loading,                setLoading]                = useState(true);
  const [sessionTimeoutEnabled,  setSessionTimeoutEnabled]  = useState(true);
  const [timeoutMinutes,         setTimeoutMinutes]         = useState(5);
  const [biometricAvailable,     setBiometricAvailable]     = useState(false);
  const [biometricEnabled,       setBiometricEnabled]       = useState(false);
  const [biometricConfirm,       setBiometricConfirm]       = useState(false);
  const [twoFactorEnabled,       setTwoFactorEnabled]       = useState(false);
  const [togglingBiometric,      setTogglingBiometric]      = useState(false);

  const [showPasswordModal,  setShowPasswordModal]  = useState(false);
  const [passwordInput,      setPasswordInput]      = useState('');
  const [passwordError,      setPasswordError]      = useState('');
  const [savingPassword,     setSavingPassword]     = useState(false);
  const [showPassword,       setShowPassword]       = useState(false);

  const uid   = user?.uid   ?? '';
  const email = user?.email ?? '';

  const loadSettings = useCallback(async () => {
    try {
      const timeout     = await SessionManager.getTimeoutMinutes();
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

      if (uid) {
        const twoFAEnabled = await twoFactorService.isEnabled(uid);
        setTwoFactorEnabled(twoFAEnabled);
      }
    } catch (err) {
      console.error('Failed to load security settings:', err);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

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

  const handleBiometricToggle = async (value: boolean) => {
    if (!biometricAvailable) return;

    if (!value) {
      Alert.alert(
        'Disable Biometric Login',
        'Are you sure you want to disable fingerprint / Face ID login?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: async () => {
              setTogglingBiometric(true);
              try {
                await biometricService.disable();
                setBiometricEnabled(false);
              } finally {
                setTogglingBiometric(false);
              }
            },
          },
        ]
      );
      return;
    }

    setPasswordInput('');
    setPasswordError('');
    setShowPasswordModal(true);
  };

  const handleEnableBiometric = async () => {
    if (!passwordInput.trim()) {
      setPasswordError('Please enter your password.');
      return;
    }
    setSavingPassword(true);
    setPasswordError('');
    try {
      await firebaseAuth.signIn(email, passwordInput);
      const biometricAuth = await biometricService.authenticate(
        'Confirm to enable biometric login'
      );
      if (!biometricAuth) {
        setPasswordError('Biometric authentication cancelled.');
        return;
      }
      await biometricService.enable({ email, password: passwordInput });
      setBiometricEnabled(true);
      setShowPasswordModal(false);
      Alert.alert('Biometric Enabled', 'You can now sign in with your fingerprint or Face ID.');
    } catch (e: any) {
      setPasswordError(e.message || 'Incorrect password. Please try again.');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleChangePassword = () => {
    Alert.alert(t('security.changePassword'), t('security.changePasswordDesc'));
  };

  const recentSessions = [
    { device: t('security.currentDevice'), time: new Date().toLocaleString(), current: true },
    { device: 'Chrome - Windows', time: new Date(Date.now() - 86400000).toLocaleString(), current: false },
    { device: 'Safari - iPhone',  time: new Date(Date.now() - 172800000).toLocaleString(), current: false },
  ];

  const securityTips = [
    { icon: 'lock-closed-outline'  as const, key: 'tip1' },
    { icon: 'finger-print-outline' as const, key: 'tip2' },
    { icon: 'wifi-outline'         as const, key: 'tip3' },
    { icon: 'refresh-outline'      as const, key: 'tip4' },
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
    <>
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
                      <Text style={[
                        styles.timeoutOptionText,
                        timeoutMinutes === minutes && styles.timeoutOptionTextActive,
                      ]}>
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
                    <Text style={styles.settingLabel}>Biometric Login</Text>
                    <Text style={styles.settingDesc}>
                      {biometricEnabled ? 'Sign in with fingerprint or Face ID' : 'Enable fingerprint / Face ID login'}
                    </Text>
                  </View>
                </View>
                {togglingBiometric
                  ? <ActivityIndicator size="small" color={COLORS.primary} />
                  : (
                    <Switch
                      value={biometricEnabled}
                      onValueChange={handleBiometricToggle}
                      trackColor={{ false: '#E5E7EB', true: '#BBF7D0' }}
                      thumbColor={biometricEnabled ? COLORS.primary : '#9CA3AF'}
                    />
                  )
                }
              </View>
            )}

            {biometricAvailable && biometricEnabled && (
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

            <TouchableOpacity
              style={[styles.settingRow, styles.settingRowBorder]}
              onPress={handleChangePassword}
            >
              <View style={styles.settingInfo}>
                <Ionicons name="key-outline" size={22} color={COLORS.textSecondary} />
                <View style={styles.settingText}>
                  <Text style={styles.settingLabel}>{t('security.changePassword')}</Text>
                  <Text style={styles.settingDesc}>{t('security.changePasswordDesc')}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingRow}
              onPress={() => navigation.navigate('TwoFactorSetup' as never)}
            >
              <View style={styles.settingInfo}>
                <Ionicons name="phone-portrait-outline" size={22} color={COLORS.textSecondary} />
                <View style={styles.settingText}>
                  <Text style={styles.settingLabel}>{t('security.twoFactor')}</Text>
                  <Text style={styles.settingDesc}>
                    {twoFactorEnabled ? 'Enabled — tap to manage' : 'Not enabled — tap to set up'}
                  </Text>
                </View>
              </View>
              <View style={styles.row}>
                <View style={[styles.statusBadge, { backgroundColor: twoFactorEnabled ? '#BBF7D0' : '#FEE2E2' }]}>
                  <Text style={[styles.statusText, { color: twoFactorEnabled ? COLORS.success : COLORS.error }]}>
                    {twoFactorEnabled ? 'ON' : 'OFF'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} style={{ marginLeft: 8 }} />
              </View>
            </TouchableOpacity>
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

      <Modal visible={showPasswordModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconRow}>
              <View style={styles.modalIcon}>
                <Ionicons name="finger-print" size={32} color={COLORS.primary} />
              </View>
            </View>
            <Text style={styles.modalTitle}>Enable Biometric Login</Text>
            <Text style={styles.modalSub}>
              Enter your account password to confirm and store it securely for biometric sign-in.
            </Text>

            <View style={styles.inputRow}>
              <TextInput
                style={styles.passwordInput}
                value={passwordInput}
                onChangeText={(v) => { setPasswordInput(v); setPasswordError(''); }}
                placeholder="Enter your password"
                placeholderTextColor={COLORS.textSecondary}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowPassword((p) => !p)}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={COLORS.textSecondary}
                />
              </TouchableOpacity>
            </View>

            {!!passwordError && (
              <Text style={styles.passwordError}>{passwordError}</Text>
            )}

            <TouchableOpacity
              style={[styles.modalBtn, savingPassword && styles.modalBtnDisabled]}
              onPress={handleEnableBiometric}
              disabled={savingPassword}
            >
              {savingPassword
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={styles.modalBtnText}>Confirm &amp; Enable</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => { setShowPasswordModal(false); setPasswordInput(''); setPasswordError(''); }}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  section:          { marginTop: 20, paddingHorizontal: 16 },
  sectionTitle: {
    fontSize: 14, fontWeight: '600', color: COLORS.textSecondary,
    marginBottom: 8, marginLeft: 4,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  card: { backgroundColor: COLORS.white, borderRadius: 12, overflow: 'hidden' },
  row:  { flexDirection: 'row', alignItems: 'center' },

  settingRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', padding: 16,
  },
  settingRowBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  settingInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  settingText: { marginLeft: 12, flex: 1 },
  settingLabel:{ fontSize: 15, fontWeight: '500', color: COLORS.text },
  settingDesc: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

  timeoutPicker: { paddingHorizontal: 16, paddingBottom: 16 },
  pickerLabel:   { fontSize: 13, color: COLORS.textSecondary, marginBottom: 8 },
  timeoutOptions:{ flexDirection: 'row', gap: 8 },
  timeoutOption: {
    flex: 1, paddingVertical: 10, borderRadius: 8,
    backgroundColor: COLORS.background, alignItems: 'center',
  },
  timeoutOptionActive:     { backgroundColor: COLORS.primary },
  timeoutOptionText:       { fontSize: 14, fontWeight: '500', color: COLORS.textSecondary },
  timeoutOptionTextActive: { color: COLORS.white },

  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText:  { fontSize: 12, fontWeight: '600' },

  sessionRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', padding: 16,
  },
  sessionInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  sessionText: { marginLeft: 12 },
  sessionDevice: { fontSize: 14, fontWeight: '500', color: COLORS.text },
  currentBadge:  { fontSize: 12, color: COLORS.primary, fontWeight: '600' },
  sessionTime:   { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

  tipRow:  { flexDirection: 'row', alignItems: 'center', padding: 14 },
  tipIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.lightGreen,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  tipText:      { fontSize: 14, color: COLORS.text, flex: 1, lineHeight: 20 },
  bottomPadding:{ height: 40 },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard:    { backgroundColor: COLORS.white, borderRadius: 24, padding: 24, margin: 16 },
  modalIconRow: { alignItems: 'center', marginBottom: 16 },
  modalIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#E6F4EC', alignItems: 'center', justifyContent: 'center',
  },
  modalTitle:  { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: 8, textAlign: 'center' },
  modalSub:    { fontSize: 14, color: COLORS.textSecondary, lineHeight: 20, marginBottom: 20, textAlign: 'center' },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 12,
    marginBottom: 6, paddingRight: 12,
  },
  passwordInput: {
    flex: 1, fontSize: 15, color: COLORS.text, padding: 14,
  },
  eyeBtn:       { padding: 4 },
  passwordError:{ fontSize: 13, color: COLORS.error, marginBottom: 14, textAlign: 'center' },

  modalBtn: {
    backgroundColor: COLORS.primary, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginBottom: 12,
  },
  modalBtnDisabled: { opacity: 0.6 },
  modalBtnText:     { fontSize: 16, fontWeight: '700', color: COLORS.white },
  modalCancel:      { alignItems: 'center', paddingVertical: 8 },
  modalCancelText:  { fontSize: 15, color: COLORS.textSecondary, fontWeight: '600' },
});

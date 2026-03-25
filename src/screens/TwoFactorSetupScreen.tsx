import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { twoFactorService, TwoFactorSettings } from '../services/twoFactorService';
import { firebaseAuth } from '../services/firebase';

const C = {
  primary:  '#006633',
  light:    '#E6F4EC',
  white:    '#FFFFFF',
  bg:       '#F5F7FA',
  text:     '#1F2937',
  sub:      '#6B7280',
  border:   '#E5E7EB',
  error:    '#EF4444',
  success:  '#10B981',
  warning:  '#F59E0B',
  warnBg:   '#FFFBEB',
  warnBorder:'#FDE68A',
};

export default function TwoFactorSetupScreen() {
  const { user } = useAuth();
  const uid   = user?.uid ?? '';
  const email = user?.email ?? '';

  const [settings,   setSettings]   = useState<TwoFactorSettings>({ enabled: false });
  const [loading,    setLoading]    = useState(true);
  const [toggling,   setToggling]   = useState(false);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmCode,      setConfirmCode]      = useState('');
  const [generatedCode,    setGeneratedCode]    = useState('');
  const [verifying,        setVerifying]        = useState(false);
  const [verifyError,      setVerifyError]      = useState('');

  useEffect(() => {
    if (!uid) return;
    loadSettings();
  }, [uid]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const s = await twoFactorService.getSettings(uid);
      setSettings(s);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (value: boolean) => {
    if (value) {
      startEnableFlow();
    } else {
      Alert.alert(
        'Disable 2FA',
        'Are you sure you want to disable two-factor authentication? Your account will be less secure.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: async () => {
              setToggling(true);
              try {
                await twoFactorService.disable(uid);
                setSettings({ enabled: false });
              } finally {
                setToggling(false);
              }
            },
          },
        ]
      );
    }
  };

  const startEnableFlow = async () => {
    setToggling(true);
    try {
      const code = await twoFactorService.generateAndStoreOTP(uid);
      setGeneratedCode(code);
      setConfirmCode('');
      setVerifyError('');
      setShowConfirmModal(true);
    } finally {
      setToggling(false);
    }
  };

  const handleVerifyAndEnable = async () => {
    if (confirmCode.length !== 6) {
      setVerifyError('Please enter the 6-digit code.');
      return;
    }
    setVerifying(true);
    setVerifyError('');
    try {
      const result = await twoFactorService.verifyOTP(uid, confirmCode);
      if (result.success) {
        await twoFactorService.enable(uid, email);
        setSettings({ enabled: true, email, enabledAt: new Date() });
        setShowConfirmModal(false);
        Alert.alert('2FA Enabled', 'Two-factor authentication is now active. You\'ll be asked for a code each time you sign in.');
      } else {
        setVerifyError(result.error ?? 'Incorrect code.');
      }
    } finally {
      setVerifying(false);
    }
  };

  const enabledAt = settings.enabledAt
    ? settings.enabledAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={['bottom']}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>

        <View style={s.hero}>
          <View style={[s.heroCircle, settings.enabled && s.heroCircleActive]}>
            <Ionicons
              name={settings.enabled ? 'shield-checkmark' : 'shield-outline'}
              size={40}
              color={settings.enabled ? C.primary : C.sub}
            />
          </View>
          <Text style={s.heroTitle}>Two-Factor Authentication</Text>
          <Text style={s.heroSub}>
            {settings.enabled
              ? 'Your account has an extra layer of security.'
              : 'Add an extra layer of security to your account.'}
          </Text>
        </View>

        <View style={s.card}>
          <View style={s.toggleRow}>
            <View style={s.toggleInfo}>
              <Ionicons name="phone-portrait-outline" size={22} color={C.sub} />
              <View style={s.toggleText}>
                <Text style={s.toggleLabel}>Two-Factor Authentication</Text>
                <Text style={s.toggleDesc}>
                  {settings.enabled
                    ? `Enabled · ${settings.email ?? email}`
                    : 'Disabled — enable for extra security'}
                </Text>
              </View>
            </View>
            {toggling
              ? <ActivityIndicator size="small" color={C.primary} />
              : (
                <Switch
                  value={settings.enabled}
                  onValueChange={handleToggle}
                  trackColor={{ false: '#E5E7EB', true: '#BBF7D0' }}
                  thumbColor={settings.enabled ? C.primary : '#9CA3AF'}
                />
              )
            }
          </View>

          {settings.enabled && enabledAt && (
            <View style={s.enabledRow}>
              <Ionicons name="calendar-outline" size={15} color={C.sub} />
              <Text style={s.enabledText}>Enabled on {enabledAt}</Text>
            </View>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>How it works</Text>
          {[
            { icon: 'log-in-outline',      text: 'You sign in with your email and password as usual.' },
            { icon: 'mail-outline',        text: 'A 6-digit code is sent to your registered email.' },
            { icon: 'keypad-outline',      text: 'You enter the code to complete sign-in.' },
            { icon: 'shield-checkmark-outline', text: 'Even if someone has your password, they can\'t access your account.' },
          ].map((step, i) => (
            <View key={i} style={[s.stepRow, i < 3 && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
              <View style={s.stepNum}>
                <Text style={s.stepNumText}>{i + 1}</Text>
              </View>
              <View style={s.stepIcon}>
                <Ionicons name={step.icon as any} size={18} color={C.primary} />
              </View>
              <Text style={s.stepText}>{step.text}</Text>
            </View>
          ))}
        </View>

        <View style={s.infoCard}>
          <Ionicons name="information-circle" size={18} color={C.warning} />
          <Text style={s.infoText}>
            Make sure your email address is up to date. That's where verification codes will be sent.
          </Text>
        </View>
      </ScrollView>

      <Modal visible={showConfirmModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Verify to Enable 2FA</Text>
            <Text style={s.modalSub}>
              Enter the 6-digit code below to confirm you want to enable 2FA.
            </Text>

            <View style={s.devCard}>
              <View style={s.devHeader}>
                <Ionicons name="code-slash" size={13} color="#92400E" />
                <Text style={s.devHeaderText}>DEVELOPMENT MODE · Your code:</Text>
              </View>
              <Text style={s.devCode}>{generatedCode}</Text>
              <Text style={s.devNote}>
                In production this is emailed to you automatically.
              </Text>
            </View>

            <TextInput
              style={s.codeInput}
              value={confirmCode}
              onChangeText={(v) => { setConfirmCode(v.replace(/\D/g, '').slice(0, 6)); setVerifyError(''); }}
              placeholder="Enter 6-digit code"
              keyboardType="number-pad"
              maxLength={6}
              textAlign="center"
            />

            {!!verifyError && (
              <Text style={s.verifyError}>{verifyError}</Text>
            )}

            <TouchableOpacity
              style={[s.modalBtn, verifying && s.modalBtnDisabled]}
              onPress={handleVerifyAndEnable}
              disabled={verifying}
            >
              {verifying
                ? <ActivityIndicator color={C.white} />
                : <Text style={s.modalBtnText}>Confirm &amp; Enable</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              style={s.modalCancel}
              onPress={() => setShowConfirmModal(false)}
            >
              <Text style={s.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll:    { padding: 20 },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  hero:           { alignItems: 'center', marginBottom: 28 },
  heroCircle:     {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  heroCircleActive: { backgroundColor: C.light },
  heroTitle:        { fontSize: 20, fontWeight: '800', color: C.text, marginBottom: 6 },
  heroSub:          { fontSize: 14, color: C.sub, textAlign: 'center', lineHeight: 20 },

  card: {
    backgroundColor: C.white, borderRadius: 16, marginBottom: 16,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: C.sub, padding: 16, paddingBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16,
  },
  toggleInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  toggleText: { marginLeft: 12, flex: 1 },
  toggleLabel:{ fontSize: 15, fontWeight: '600', color: C.text },
  toggleDesc: { fontSize: 12, color: C.sub, marginTop: 2 },

  enabledRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingBottom: 14,
  },
  enabledText: { fontSize: 12, color: C.sub },

  stepRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  stepNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { fontSize: 11, fontWeight: '800', color: C.white },
  stepIcon: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.light, alignItems: 'center', justifyContent: 'center',
  },
  stepText: { flex: 1, fontSize: 14, color: C.text, lineHeight: 20 },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: C.warnBg, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.warnBorder, marginBottom: 20,
  },
  infoText: { flex: 1, fontSize: 13, color: '#92400E', lineHeight: 18 },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: C.white, borderRadius: 24,
    padding: 24, margin: 16,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: C.text, marginBottom: 6 },
  modalSub:   { fontSize: 14, color: C.sub, lineHeight: 20, marginBottom: 20 },

  devCard: {
    backgroundColor: '#FFFBEB', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.warnBorder, marginBottom: 16,
  },
  devHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  devHeaderText: { fontSize: 10, fontWeight: '800', color: '#92400E', letterSpacing: 1 },
  devCode:   { fontSize: 30, fontWeight: '900', color: '#92400E', letterSpacing: 6, marginBottom: 4 },
  devNote:   { fontSize: 11, color: '#B45309' },

  codeInput: {
    fontSize: 22, fontWeight: '700', color: C.text,
    borderWidth: 2, borderColor: C.primary, borderRadius: 12,
    paddingVertical: 14, marginBottom: 8,
    letterSpacing: 8,
  },
  verifyError: { fontSize: 13, color: C.error, marginBottom: 12, textAlign: 'center' },

  modalBtn: {
    backgroundColor: C.primary, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginBottom: 12,
  },
  modalBtnDisabled: { opacity: 0.6 },
  modalBtnText: { fontSize: 16, fontWeight: '700', color: C.white },
  modalCancel:  { alignItems: 'center' },
  modalCancelText: { fontSize: 15, color: C.sub, fontWeight: '600' },
});

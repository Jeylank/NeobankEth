import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';

const C = {
  primary:   '#006633',
  light:     '#E6F4EC',
  white:     '#FFFFFF',
  bg:        '#F5F7FA',
  text:      '#1F2937',
  sub:       '#6B7280',
  border:    '#E5E7EB',
  error:     '#EF4444',
  errBg:     '#FEF2F2',
  warnBg:    '#FFFBEB',
  warnBorder:'#FDE68A',
};

const CODE_LENGTH = 6;

export default function TwoFactorVerifyScreen() {
  const {
    pending2FACode,
    pending2FAEmail,
    verify2FACode,
    cancelTwoFactorLogin,
    resend2FACode,
  } = useAuth();

  const [digits,    setDigits]    = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [devCode,   setDevCode]   = useState(pending2FACode);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const inputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => { setDevCode(pending2FACode); }, [pending2FACode]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10,  duration: 60,  useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60,  useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6,   duration: 60,  useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,   duration: 60,  useNativeDriver: true }),
    ]).start();
  };

  const handleDigit = (value: string, index: number) => {
    const d = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = d;
    setDigits(next);
    setError('');
    if (d && index < CODE_LENGTH - 1) inputRefs.current[index + 1]?.focus();
    if (next.filter(Boolean).length === CODE_LENGTH) {
      submitCode(next.join(''));
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const submitCode = async (code?: string) => {
    const entered = code ?? digits.join('');
    if (entered.length !== CODE_LENGTH) { setError('Please enter all 6 digits.'); return; }
    setLoading(true);
    setError('');
    try {
      const result = await verify2FACode(entered);
      if (!result.success) {
        setError(result.error ?? 'Incorrect code. Please try again.');
        shake();
        setDigits(Array(CODE_LENGTH).fill(''));
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
      }
    } catch (e: any) {
      setError(e.message || 'Verification failed.');
      shake();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setResending(true);
    try {
      const code = await resend2FACode();
      setDevCode(code);
      setCountdown(60);
      setDigits(Array(CODE_LENGTH).fill(''));
      setError('');
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } finally {
      setResending(false);
    }
  };

  const maskedEmail = pending2FAEmail
    ? pending2FAEmail.replace(/(.{2})(.*)(?=@)/, (_: string, a: string, b: string) =>
        a + '*'.repeat(Math.min(b.length, 4)))
    : 'your email';

  return (
    <SafeAreaView style={s.container}>
      <View style={s.inner}>

        <View style={s.iconCircle}>
          <Ionicons name="shield-checkmark" size={40} color={C.primary} />
        </View>

        <Text style={s.title}>Two-Factor Verification</Text>
        <Text style={s.subtitle}>
          Enter the 6-digit code sent to{'\n'}
          <Text style={s.email}>{maskedEmail}</Text>
        </Text>

        <Animated.View style={[s.otpRow, { transform: [{ translateX: shakeAnim }] }]}>
          {digits.map((digit, i) => (
            <TextInput
              key={i}
              ref={(ref) => { inputRefs.current[i] = ref; }}
              style={[
                s.otpBox,
                !!digit   && s.otpBoxFilled,
                !!error   && s.otpBoxError,
              ]}
              value={digit}
              onChangeText={(v) => handleDigit(v, i)}
              onKeyPress={(e) => handleKeyPress(e, i)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              textAlign="center"
            />
          ))}
        </Animated.View>

        {!!error && (
          <View style={s.errorBanner}>
            <Ionicons name="alert-circle" size={16} color={C.error} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[s.verifyBtn, (loading || digits.join('').length !== CODE_LENGTH) && s.verifyBtnDisabled]}
          onPress={() => submitCode()}
          disabled={loading || digits.join('').length !== CODE_LENGTH}
        >
          {loading
            ? <ActivityIndicator color={C.white} />
            : <Text style={s.verifyBtnText}>Verify Code</Text>
          }
        </TouchableOpacity>

        <View style={s.resendRow}>
          <Text style={s.resendLabel}>Didn't receive a code?</Text>
          <TouchableOpacity onPress={handleResend} disabled={countdown > 0 || resending}>
            <Text style={[s.resendBtn, (countdown > 0 || resending) && s.resendBtnDisabled]}>
              {countdown > 0
                ? `Resend in ${countdown}s`
                : resending ? 'Sending...' : 'Resend'}
            </Text>
          </TouchableOpacity>
        </View>

        {!!devCode && (
          <View style={s.devCard}>
            <View style={s.devRow}>
              <Ionicons name="code-slash" size={13} color="#92400E" />
              <Text style={s.devLabel}>DEVELOPMENT · Your code:</Text>
            </View>
            <Text style={s.devCode}>{devCode}</Text>
            <Text style={s.devNote}>
              In production this will be delivered to your email. Integrate an email service before launch.
            </Text>
          </View>
        )}

        <TouchableOpacity onPress={cancelTwoFactorLogin} style={s.cancelBtn}>
          <Text style={s.cancelText}>← Back to Sign In</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  inner: {
    flex: 1, padding: 28,
    alignItems: 'center', justifyContent: 'center',
  },

  iconCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: C.light, alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  title:    { fontSize: 24, fontWeight: '800', color: C.text, marginBottom: 10, textAlign: 'center' },
  subtitle: { fontSize: 15, color: C.sub, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  email:    { fontWeight: '700', color: C.primary },

  otpRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  otpBox: {
    width: 46, height: 56, borderRadius: 12,
    borderWidth: 2, borderColor: C.border,
    fontSize: 22, fontWeight: '700', color: C.text,
    backgroundColor: C.white,
  },
  otpBoxFilled: { borderColor: C.primary },
  otpBoxError:  { borderColor: C.error },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.errBg, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 16, width: '100%',
  },
  errorText: { fontSize: 14, color: C.error, flex: 1 },

  verifyBtn: {
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', width: '100%', marginBottom: 20,
  },
  verifyBtnDisabled: { opacity: 0.5 },
  verifyBtnText:     { fontSize: 16, fontWeight: '700', color: C.white },

  resendRow:         { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 28 },
  resendLabel:       { fontSize: 14, color: C.sub },
  resendBtn:         { fontSize: 14, fontWeight: '700', color: C.primary },
  resendBtnDisabled: { color: C.sub },

  devCard: {
    backgroundColor: C.warnBg, borderRadius: 12, padding: 14, width: '100%',
    borderWidth: 1, borderColor: C.warnBorder, marginBottom: 24,
  },
  devRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  devLabel: { fontSize: 10, fontWeight: '800', color: '#92400E', letterSpacing: 1 },
  devCode:  { fontSize: 32, fontWeight: '900', color: '#92400E', letterSpacing: 6, marginBottom: 6 },
  devNote:  { fontSize: 11, color: '#B45309', lineHeight: 16 },

  cancelBtn:  { marginTop: 0 },
  cancelText: { fontSize: 14, color: C.sub, fontWeight: '500' },
});

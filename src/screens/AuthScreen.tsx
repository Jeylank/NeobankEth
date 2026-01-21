import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { biometricService } from '../services/biometric';
import { firebaseAuth, phoneUtils } from '../services/firebase';
import { sendPasswordResetEmail, getAuth } from 'firebase/auth';

type AuthMethod = 'email' | 'phone';
type PhoneStep = 'input' | 'verify';

export default function AuthScreen() {
  const { t } = useTranslation();
  const [isLogin, setIsLogin] = useState(true);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('email');
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('input');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricType, setBiometricType] = useState<string>('Biometric');
  const [countdown, setCountdown] = useState(0);
  
  const { signIn, signUp, signInWithPhone } = useAuth();

  useEffect(() => {
    checkBiometric();
  }, []);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const checkBiometric = async () => {
    const available = await biometricService.isAvailable();
    setBiometricAvailable(available);
    
    if (available) {
      const enabled = await biometricService.isEnabled();
      setBiometricEnabled(enabled);
      
      const types = await biometricService.getSupportedTypes();
      if (types.includes('Face ID')) {
        setBiometricType('Face ID');
      } else if (types.includes('Fingerprint')) {
        setBiometricType('Fingerprint');
      }
    }
  };

  const handleBiometricLogin = async () => {
    setIsSubmitting(true);
    try {
      const credentials = await biometricService.authenticateAndGetCredentials();
      if (credentials) {
        await signIn(credentials.email, credentials.password);
      } else {
        Alert.alert(t('auth.error'), t('auth.biometricFailed'));
      }
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('auth.biometricFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      Alert.alert(t('auth.emailRequired'), t('auth.enterEmailForReset'));
      return;
    }

    try {
      const auth = getAuth();
      await sendPasswordResetEmail(auth, email);
      Alert.alert(t('auth.passwordReset'), t('auth.resetLinkSent'));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('auth.resetFailed'));
    }
  };

  const handleEmailSubmit = async () => {
    if (!email || !password) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      Alert.alert(t('common.error'), t('auth.passwordsNoMatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      if (isLogin) {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('auth.authFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendCode = async () => {
    const validation = phoneUtils.validateEthiopianNumber(phoneNumber);
    if (!validation.valid) {
      Alert.alert(t('common.error'), validation.error || t('auth.invalidPhone'));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await firebaseAuth.sendPhoneVerification(phoneNumber);
      if (result.success) {
        setPhoneStep('verify');
        setCountdown(60);
        Alert.alert(t('common.success'), t('auth.codeSent'));
      } else {
        Alert.alert(t('common.error'), result.error || t('auth.sendCodeFailed'));
      }
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('auth.sendCodeFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyCode = async () => {
    if (verificationCode.length !== 6) {
      Alert.alert(t('common.error'), t('auth.enterValidCode'));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await firebaseAuth.verifyPhoneCode(verificationCode);
      if (result.success && result.user) {
        if (signInWithPhone) {
          await signInWithPhone(result.user);
        }
      } else {
        Alert.alert(t('common.error'), result.error || t('auth.verifyFailed'));
      }
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('auth.verifyFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendCode = async () => {
    if (countdown > 0) return;
    
    setIsSubmitting(true);
    try {
      const result = await firebaseAuth.resendPhoneCode(phoneNumber);
      if (result.success) {
        setCountdown(60);
        Alert.alert(t('common.success'), t('auth.codeResent'));
      } else {
        Alert.alert(t('common.error'), result.error || t('auth.resendFailed'));
      }
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('auth.resendFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatPhoneDisplay = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)} ${digits.slice(2)}`;
    if (digits.length <= 7) return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
    return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 9)}`;
  };

  const renderAuthMethodTabs = () => (
    <View style={styles.tabContainer}>
      <TouchableOpacity
        style={[styles.tab, authMethod === 'email' && styles.activeTab]}
        onPress={() => {
          setAuthMethod('email');
          setPhoneStep('input');
        }}
      >
        <Ionicons 
          name="mail-outline" 
          size={18} 
          color={authMethod === 'email' ? '#FFFFFF' : '#006633'} 
        />
        <Text style={[styles.tabText, authMethod === 'email' && styles.activeTabText]}>
          {t('auth.email')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, authMethod === 'phone' && styles.activeTab]}
        onPress={() => {
          setAuthMethod('phone');
          setPhoneStep('input');
        }}
      >
        <Ionicons 
          name="call-outline" 
          size={18} 
          color={authMethod === 'phone' ? '#FFFFFF' : '#006633'} 
        />
        <Text style={[styles.tabText, authMethod === 'phone' && styles.activeTabText]}>
          {t('auth.phone')}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderEmailForm = () => (
    <>
      <TextInput
        style={styles.input}
        placeholder={t('auth.emailPlaceholder')}
        placeholderTextColor="#9CA3AF"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />

      <TextInput
        style={styles.input}
        placeholder={t('auth.passwordPlaceholder')}
        placeholderTextColor="#9CA3AF"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
      />

      {!isLogin && (
        <TextInput
          style={styles.input}
          placeholder={t('auth.confirmPasswordPlaceholder')}
          placeholderTextColor="#9CA3AF"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
        />
      )}

      <TouchableOpacity
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={handleEmailSubmit}
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>
            {isLogin ? t('auth.signIn') : t('auth.createAccount')}
          </Text>
        )}
      </TouchableOpacity>

      {isLogin && (
        <TouchableOpacity
          style={styles.forgotPasswordButton}
          onPress={handleForgotPassword}
        >
          <Text style={styles.forgotPasswordText}>{t('auth.forgotPassword')}</Text>
        </TouchableOpacity>
      )}
    </>
  );

  const renderPhoneInput = () => (
    <>
      <View style={styles.phoneInputContainer}>
        <View style={styles.countryCode}>
          <Text style={styles.countryCodeText}>+251</Text>
          <View style={styles.flagIcon}>
            <View style={[styles.miniStripe, { backgroundColor: '#006633' }]} />
            <View style={[styles.miniStripe, { backgroundColor: '#FFD700' }]} />
            <View style={[styles.miniStripe, { backgroundColor: '#FF0000' }]} />
          </View>
        </View>
        <TextInput
          style={styles.phoneInput}
          placeholder={t('auth.phonePlaceholder')}
          placeholderTextColor="#9CA3AF"
          value={formatPhoneDisplay(phoneNumber)}
          onChangeText={(text) => setPhoneNumber(text.replace(/\D/g, '').slice(0, 9))}
          keyboardType="phone-pad"
          maxLength={12}
        />
      </View>
      
      <Text style={styles.phoneHint}>
        {t('auth.phoneHint')}
      </Text>

      <TouchableOpacity
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={handleSendCode}
        disabled={isSubmitting || phoneNumber.length < 9}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>{t('auth.sendCode')}</Text>
        )}
      </TouchableOpacity>
    </>
  );

  const renderVerificationForm = () => (
    <>
      <View style={styles.verificationInfo}>
        <Ionicons name="chatbubble-outline" size={40} color="#006633" />
        <Text style={styles.verificationTitle}>{t('auth.enterCode')}</Text>
        <Text style={styles.verificationSubtitle}>
          {t('auth.codeSentTo')} {phoneUtils.getDisplayFormat(phoneNumber)}
        </Text>
      </View>

      <TextInput
        style={[styles.input, styles.codeInput]}
        placeholder="000000"
        placeholderTextColor="#9CA3AF"
        value={verificationCode}
        onChangeText={(text) => setVerificationCode(text.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        textAlign="center"
      />

      <TouchableOpacity
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={handleVerifyCode}
        disabled={isSubmitting || verificationCode.length !== 6}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>{t('auth.verify')}</Text>
        )}
      </TouchableOpacity>

      <View style={styles.resendContainer}>
        <TouchableOpacity
          style={styles.backToPhoneButton}
          onPress={() => {
            setPhoneStep('input');
            setVerificationCode('');
          }}
        >
          <Ionicons name="arrow-back" size={16} color="#006633" />
          <Text style={styles.backToPhoneText}>{t('auth.changeNumber')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleResendCode}
          disabled={countdown > 0 || isSubmitting}
        >
          <Text style={[
            styles.resendText,
            (countdown > 0 || isSubmitting) && styles.resendTextDisabled
          ]}>
            {countdown > 0 
              ? `${t('auth.resendIn')} ${countdown}s` 
              : t('auth.resendCode')}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );

  const renderPhoneForm = () => {
    if (phoneStep === 'verify') {
      return renderVerificationForm();
    }
    return renderPhoneInput();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.logo}>NeoBanker</Text>
          <Text style={styles.subtitle}>{t('auth.tagline')}</Text>
          <View style={styles.flagStripe}>
            <View style={[styles.stripe, { backgroundColor: '#006633' }]} />
            <View style={[styles.stripe, { backgroundColor: '#FFD700' }]} />
            <View style={[styles.stripe, { backgroundColor: '#FF0000' }]} />
          </View>
        </View>

        <View style={styles.form}>
          <Text style={styles.title}>
            {isLogin ? t('auth.welcomeBack') : t('auth.createAccount')}
          </Text>

          {renderAuthMethodTabs()}

          {authMethod === 'email' ? renderEmailForm() : renderPhoneForm()}

          {isLogin && authMethod === 'email' && biometricAvailable && biometricEnabled && (
            <>
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>{t('auth.or')}</Text>
                <View style={styles.dividerLine} />
              </View>

              <TouchableOpacity
                style={[styles.biometricButton, isSubmitting && styles.buttonDisabled]}
                onPress={handleBiometricLogin}
                disabled={isSubmitting}
              >
                <Ionicons 
                  name={biometricType === 'Face ID' ? 'scan-outline' : 'finger-print-outline'} 
                  size={24} 
                  color="#006633" 
                />
                <Text style={styles.biometricButtonText}>
                  {t('auth.signInWith')} {biometricType}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {authMethod === 'email' && (
            <TouchableOpacity
              style={styles.switchButton}
              onPress={() => setIsLogin(!isLogin)}
            >
              <Text style={styles.switchText}>
                {isLogin ? t('auth.noAccount') : t('auth.haveAccount')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>{t('auth.secureFooter')}</Text>
        </View>

        <View id="recaptcha-container" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#006633',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 16,
    color: '#E5E7EB',
    marginTop: 8,
  },
  flagStripe: {
    flexDirection: 'row',
    marginTop: 16,
    width: 120,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  stripe: {
    flex: 1,
  },
  form: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 20,
    textAlign: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    marginBottom: 20,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  activeTab: {
    backgroundColor: '#006633',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#006633',
  },
  activeTabText: {
    color: '#FFFFFF',
  },
  input: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
    color: '#1F2937',
  },
  phoneInputContainer: {
    flexDirection: 'row',
    marginBottom: 8,
    gap: 8,
  },
  countryCode: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countryCodeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  flagIcon: {
    width: 20,
    height: 14,
    borderRadius: 2,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  miniStripe: {
    flex: 1,
  },
  phoneInput: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#1F2937',
  },
  phoneHint: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  button: {
    backgroundColor: '#006633',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#9CA3AF',
    fontSize: 14,
  },
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#006633',
  },
  biometricButtonText: {
    color: '#006633',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 12,
  },
  forgotPasswordButton: {
    marginTop: 12,
    alignItems: 'center',
  },
  forgotPasswordText: {
    color: '#006633',
    fontSize: 14,
  },
  switchButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  switchText: {
    color: '#006633',
    fontSize: 14,
  },
  footer: {
    marginTop: 40,
    alignItems: 'center',
  },
  footerText: {
    color: '#E5E7EB',
    fontSize: 14,
  },
  verificationInfo: {
    alignItems: 'center',
    marginBottom: 20,
  },
  verificationTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginTop: 12,
  },
  verificationSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'center',
  },
  codeInput: {
    fontSize: 24,
    letterSpacing: 8,
    fontWeight: '600',
  },
  resendContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  backToPhoneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backToPhoneText: {
    color: '#006633',
    fontSize: 14,
  },
  resendText: {
    color: '#006633',
    fontSize: 14,
    fontWeight: '500',
  },
  resendTextDisabled: {
    color: '#9CA3AF',
  },
});

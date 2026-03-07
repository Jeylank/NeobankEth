import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { moneyRequestsService } from '../services/firestoreMoneyRequests';
import type { RequestPurpose } from '../types';

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
};

const PURPOSE_VALUES: RequestPurpose[] = ['school_fees', 'electricity', 'medical', 'family_support', 'other'];
const PURPOSE_I18N: Record<RequestPurpose, string> = {
  school_fees: 'familyRequest.schoolFees',
  electricity: 'familyRequest.electricity',
  medical: 'familyRequest.medical',
  family_support: 'familyRequest.familySupport',
  other: 'familyRequest.other',
};

export default function RequestMoneyScreen({ navigation }: any) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [requesterName, setRequesterName] = useState('');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState<RequestPurpose>('family_support');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const receiverId = user?.uid ?? '';

  const handleSubmit = async () => {
    if (!requesterName.trim() || !amount.trim()) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }

    setSubmitting(true);
    try {
      await moneyRequestsService.createRequest({
        requesterId: receiverId,
        requesterName: requesterName.trim(),
        receiverId,
        amount: amountNum,
        currency: 'ETB',
        purpose,
        message: message.trim() || undefined,
      });
      Alert.alert(t('common.success'), t('familyRequest.requestSent'));
      navigation.goBack();
    } catch (err: any) {
      if (err?.message === 'OFFLINE') {
        Alert.alert(t('common.error'), t('familyRequest.offlineAction'));
      } else {
        Alert.alert(t('common.error'), t('common.error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <View style={styles.headerIconContainer}>
            <Ionicons name="hand-left-outline" size={40} color={COLORS.primary} />
          </View>
          <Text style={styles.title}>{t('familyRequest.createRequest')}</Text>
          <Text style={styles.subtitle}>{t('familyRequest.createSubtitle')}</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('familyRequest.requesterName')} *</Text>
            <TextInput
              style={styles.formInput}
              value={requesterName}
              onChangeText={setRequesterName}
              placeholder={t('familyRequest.requesterNamePlaceholder')}
              placeholderTextColor={COLORS.textSecondary}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('familyRequest.amount')} *</Text>
            <View style={styles.amountRow}>
              <TextInput
                style={[styles.formInput, styles.amountInput]}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={COLORS.textSecondary}
                keyboardType="numeric"
              />
              <View style={styles.currencyBadge}>
                <Text style={styles.currencyText}>ETB</Text>
              </View>
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('familyRequest.purpose')}</Text>
            <View style={styles.pickerRow}>
              {PURPOSE_VALUES.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.pickerOption,
                    purpose === p && styles.pickerOptionActive,
                  ]}
                  onPress={() => setPurpose(p)}
                >
                  <Text
                    style={[
                      styles.pickerOptionText,
                      purpose === p && styles.pickerOptionTextActive,
                    ]}
                  >
                    {t(PURPOSE_I18N[p])}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{t('familyRequest.message')}</Text>
            <TextInput
              style={[styles.formInput, styles.textArea]}
              value={message}
              onChangeText={setMessage}
              placeholder={t('familyRequest.messagePlaceholder')}
              placeholderTextColor={COLORS.textSecondary}
              multiline
              numberOfLines={3}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="paper-plane" size={20} color={COLORS.white} />
                <Text style={styles.submitButtonText}>{t('familyRequest.sendRequest')}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={20} color={COLORS.textSecondary} />
          <Text style={styles.infoText}>{t('familyRequest.infoNote')}</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  headerIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  form: {
    paddingHorizontal: 16,
  },
  formGroup: {
    marginBottom: 20,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  formInput: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.text,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  amountInput: {
    flex: 1,
  },
  currencyBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  currencyText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 16,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickerOption: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pickerOptionActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  pickerOptionText: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  pickerOptionTextActive: {
    color: COLORS.white,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.white,
    margin: 16,
    padding: 14,
    borderRadius: 12,
    gap: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
});

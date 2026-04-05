import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../hooks/useAuth';

const COLORS = {
  primary:       '#006633',
  primaryLight:  '#E6F4EC',
  bank:          '#2563EB',
  white:         '#FFFFFF',
  background:    '#F5F7FA',
  text:          '#1F2937',
  textSecondary: '#6B7280',
  border:        '#E5E7EB',
  success:       '#10B981',
  warning:       '#F59E0B',
  copiedBg:      '#D1FAE5',
};

export default function BankTransferFundingScreen() {
  const { t }            = useTranslation();
  const navigation       = useNavigation<any>();
  const route            = useRoute<any>();
  const { user }         = useAuth();

  const amount   = route.params?.amount;
  const currency = route.params?.currency ?? 'EUR';

  const userId    = user?.uid ?? 'YOUR-USER-ID';
  const shortId   = userId.slice(0, 8).toUpperCase();
  const reference = `TOPUP-${shortId}`;

  const BANK_DETAILS = [
    { key: 'bankName',  label: 'Bank Name',      value: 'Sumsuma Partner Bank',        icon: 'business'         },
    { key: 'accName',   label: 'Account Name',   value: 'Sumsuma Financial Services',  icon: 'person'           },
    { key: 'iban',      label: 'IBAN',            value: 'DE89 3704 0044 0532 0130 00',   icon: 'card'             },
    { key: 'swift',     label: 'BIC / SWIFT',     value: 'COBADEFFXXX',                   icon: 'globe'            },
    { key: 'ref',       label: 'Reference',       value: reference,                        icon: 'pricetag'         },
  ];

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = async (key: string, value: string) => {
    try {
      await Clipboard.setStringAsync(value);
    } catch {
      if (Platform.OS === 'web') {
        try { await navigator.clipboard.writeText(value); } catch { /* ignore */ }
      }
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.iconBanner}>
          <View style={styles.iconCircle}>
            <Ionicons name="business" size={40} color={COLORS.bank} />
          </View>
          <Text style={styles.bannerTitle}>{t('funding.bankTransfer')}</Text>
          <Text style={styles.bannerSub}>{t('funding.bankTransferInstructions')}</Text>
        </View>

        {amount > 0 && (
          <View style={styles.amountBanner}>
            <Text style={styles.amountBannerLabel}>{t('funding.amount')}</Text>
            <Text style={styles.amountBannerValue}>
              {currency} {Number(amount).toFixed(2)}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>{t('funding.bankDetails')}</Text>
            <View style={styles.tapHintRow}>
              <Ionicons name="copy-outline" size={13} color={COLORS.textSecondary} />
              <Text style={styles.tapHint}>Tap to copy</Text>
            </View>
          </View>

          {BANK_DETAILS.map((item) => {
            const isCopied = copiedKey === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.detailRow, isCopied && styles.detailRowCopied]}
                onPress={() => handleCopy(item.key, item.value)}
                activeOpacity={0.6}
              >
                <View style={[styles.detailIconCircle, isCopied && styles.detailIconCircleCopied]}>
                  <Ionicons
                    name={item.icon as any}
                    size={16}
                    color={isCopied ? COLORS.success : COLORS.bank}
                  />
                </View>
                <View style={styles.detailLeft}>
                  <Text style={styles.detailLabel}>{item.label}</Text>
                  <Text style={[styles.detailValue, isCopied && styles.detailValueCopied]}>
                    {item.value}
                  </Text>
                </View>
                <View style={[styles.copyBadge, isCopied && styles.copyBadgeCopied]}>
                  <Ionicons
                    name={isCopied ? 'checkmark' : 'copy-outline'}
                    size={15}
                    color={isCopied ? COLORS.success : COLORS.primary}
                  />
                  <Text style={[styles.copyBadgeText, isCopied && styles.copyBadgeTextCopied]}>
                    {isCopied ? 'Copied!' : 'Copy'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.referenceNote}>
          <Ionicons name="information-circle" size={18} color={COLORS.bank} />
          <Text style={styles.referenceNoteText}>
            Always include your reference code <Text style={styles.referenceHighlight}>{reference}</Text> so we can credit your account correctly.
          </Text>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="time-outline" size={20} color={COLORS.warning} />
          <View style={styles.infoText}>
            <Text style={styles.infoTitle}>{t('funding.processingTime')}</Text>
            <Text style={styles.infoSub}>{t('funding.bankProcessingNote')}</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.success} />
          <View style={styles.infoText}>
            <Text style={styles.infoTitle}>{t('funding.secure')}</Text>
            <Text style={styles.infoSub}>{t('funding.bankSecureNote')}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.supportBtn}
          onPress={() => navigation.navigate('Support')}
        >
          <Ionicons name="help-circle-outline" size={18} color={COLORS.primary} />
          <Text style={styles.supportBtnText}>{t('funding.needHelp')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scroll: {
    padding: 20,
  },
  iconBanner: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  bannerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  bannerSub: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  amountBanner: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#B9E5CC',
  },
  amountBannerLabel: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  amountBannerValue: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.primary,
    marginTop: 4,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  tapHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tapHint: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 4,
    gap: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  detailRowCopied: {
    backgroundColor: COLORS.copiedBg,
    borderColor: '#6EE7B7',
  },
  detailIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailIconCircleCopied: {
    backgroundColor: '#D1FAE5',
  },
  detailLeft: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 2,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  detailValueCopied: {
    color: COLORS.success,
  },
  copyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  copyBadgeCopied: {
    borderColor: '#6EE7B7',
    backgroundColor: '#D1FAE5',
  },
  copyBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  copyBadgeTextCopied: {
    color: COLORS.success,
  },
  referenceNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  referenceNoteText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 20,
  },
  referenceHighlight: {
    fontWeight: '700',
    color: COLORS.bank,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  infoText: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  infoSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  supportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
    marginBottom: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  supportBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
});

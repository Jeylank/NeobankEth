import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

const COLORS = {
  primary:       '#006633',
  primaryLight:  '#E6F4EC',
  bank:          '#2563EB',
  bankLight:     '#EFF6FF',
  white:         '#FFFFFF',
  background:    '#F5F7FA',
  text:          '#1F2937',
  textSecondary: '#6B7280',
  border:        '#E5E7EB',
  success:       '#10B981',
  warning:       '#F59E0B',
};

const BANK_DETAILS = [
  { label: 'Bank Name',      value: 'Habeshare Partner Bank' },
  { label: 'Account Name',   value: 'Habeshare Financial Services' },
  { label: 'IBAN',           value: 'DE89 3704 0044 0532 0130 00' },
  { label: 'BIC / SWIFT',    value: 'COBADEFFXXX' },
  { label: 'Reference',      value: 'TOPUP-{YOUR-USER-ID}' },
];

export default function BankTransferFundingScreen() {
  const { t }      = useTranslation();
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();

  const amount   = route.params?.amount;
  const currency = route.params?.currency ?? 'EUR';

  const handleCopy = (value: string) => {
    // Clipboard would be used on native; on web we just show the text
    console.log('Copy:', value);
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
          <Text style={styles.cardTitle}>{t('funding.bankDetails')}</Text>
          {BANK_DETAILS.map((item) => (
            <View key={item.label} style={styles.detailRow}>
              <View style={styles.detailLeft}>
                <Text style={styles.detailLabel}>{item.label}</Text>
                <Text style={styles.detailValue}>{item.value}</Text>
              </View>
              <TouchableOpacity onPress={() => handleCopy(item.value)} style={styles.copyBtn}>
                <Ionicons name="copy-outline" size={18} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          ))}
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
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 14,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  detailLeft: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  copyBtn: {
    padding: 6,
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
    marginTop: 8,
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

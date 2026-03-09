import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

const COLORS = {
  primary: '#006633',
  white: '#FFFFFF',
  gray: '#6B7280',
  lightGray: '#F3F4F6',
  text: '#1F2937',
  green: '#10B981',
  border: '#E5E7EB',
};

interface FeeBreakdownCardProps {
  sendAmount: number;
  sendCurrency: string;
  receiveAmount: number;
  receiveCurrency: string;
  fxRate: number;
  platformFee: number;
  bankFee: number;
}

const getCurrencySymbol = (currency: string): string => {
  switch (currency) {
    case 'EUR': return '€';
    case 'USD': return '$';
    case 'GBP': return '£';
    default: return currency + ' ';
  }
};

export default function FeeBreakdownCard({
  sendAmount,
  sendCurrency,
  receiveAmount,
  receiveCurrency,
  fxRate,
  platformFee,
  bankFee,
}: FeeBreakdownCardProps) {
  const { t } = useTranslation();
  const sendSymbol = getCurrencySymbol(sendCurrency);
  const totalFees = platformFee + bankFee;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="receipt-outline" size={20} color={COLORS.primary} />
        <Text style={styles.headerText}>{t('fee.breakdown')}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.label}>{t('fee.youSend')}</Text>
        <Text style={styles.value}>{sendSymbol}{sendAmount.toFixed(2)}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>{t('fee.fxRate')}</Text>
        <Text style={styles.value}>1 {sendCurrency} = {fxRate.toFixed(2)} {receiveCurrency}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>{t('fee.platformFee')}</Text>
        <Text style={styles.value}>{sendSymbol}{platformFee.toFixed(2)}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>{t('fee.processingFee')}</Text>
        <Text style={styles.value}>{sendSymbol}{bankFee.toFixed(2)}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.totalLabel}>{t('fee.totalFees')}</Text>
        <Text style={styles.totalValue}>{sendSymbol}{totalFees.toFixed(2)}</Text>
      </View>

      <View style={styles.receiveRow}>
        <Text style={styles.receiveLabel}>{t('fee.receiverGets')}</Text>
        <Text style={styles.receiveValue}>{receiveAmount.toLocaleString()} {receiveCurrency}</Text>
      </View>

      <View style={styles.disclaimerRow}>
        <Ionicons name="information-circle-outline" size={14} color={COLORS.gray} />
        <Text style={styles.disclaimerText}>{t('fee.feeDisclaimer')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  headerText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  label: {
    fontSize: 14,
    color: COLORS.gray,
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  totalValue: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  receiveRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.primary + '10',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  receiveLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  receiveValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primary,
  },
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  disclaimerText: {
    fontSize: 11,
    color: COLORS.gray,
    flex: 1,
  },
});

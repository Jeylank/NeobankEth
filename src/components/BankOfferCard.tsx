import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

const COLORS = {
  primary: '#006633',
  gold: '#FFD700',
  white: '#FFFFFF',
  gray: '#6B7280',
  lightGray: '#F3F4F6',
  text: '#1F2937',
  green: '#10B981',
};

interface BankOfferCardProps {
  bank: string;
  rate: number;
  fee: number;
  receiveAmount: number;
  deliveryTime: string;
  currency?: string;
  sendAmount?: number;
  sendCurrency?: string;
  selected?: boolean;
  bestRate?: boolean;
  onSelect: () => void;
}

export default function BankOfferCard({
  bank,
  rate,
  fee,
  receiveAmount,
  deliveryTime,
  currency = 'ETB',
  sendCurrency = 'EUR',
  selected = false,
  bestRate = false,
  onSelect,
}: BankOfferCardProps) {
  const { t } = useTranslation();

  return (
    <TouchableOpacity
      style={[
        styles.card,
        selected && styles.cardSelected,
        bestRate && styles.cardBest,
      ]}
      onPress={onSelect}
      activeOpacity={0.7}
    >
      {bestRate && (
        <View style={styles.bestBadge}>
          <Ionicons name="star" size={12} color={COLORS.white} />
          <Text style={styles.bestBadgeText}>{t('fxMarketplace.bestRate')}</Text>
        </View>
      )}

      <View style={styles.header}>
        <View style={styles.bankInfo}>
          <View style={styles.bankIcon}>
            <Ionicons name="business" size={20} color={COLORS.primary} />
          </View>
          <Text style={styles.bankName}>{bank}</Text>
        </View>
        {selected && (
          <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />
        )}
      </View>

      <View style={styles.detailsGrid}>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>{t('fxMarketplace.rate')}</Text>
          <Text style={styles.detailValue}>{rate.toFixed(2)}</Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>{t('fxMarketplace.receive')}</Text>
          <Text style={styles.receiveValue}>
            {receiveAmount.toLocaleString()} {currency}
          </Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>{t('fxMarketplace.fee')}</Text>
          <Text style={styles.detailValue}>
            {sendCurrency === 'EUR' ? '€' : sendCurrency === 'USD' ? '$' : sendCurrency === 'GBP' ? '£' : ''}{fee.toFixed(2)}
          </Text>
        </View>
        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>{t('fxMarketplace.delivery')}</Text>
          <View style={styles.deliveryRow}>
            <Ionicons name="time-outline" size={14} color={COLORS.green} />
            <Text style={styles.deliveryValue}>{deliveryTime}</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.selectButton, selected && styles.selectButtonActive]}
        onPress={onSelect}
        activeOpacity={0.8}
      >
        <Text style={[styles.selectButtonText, selected && styles.selectButtonTextActive]}>
          {selected ? t('fxMarketplace.selected') : t('fxMarketplace.select')}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardSelected: {
    borderColor: COLORS.primary,
    borderWidth: 2,
    backgroundColor: '#F0FFF4',
  },
  cardBest: {
    borderColor: COLORS.gold,
    borderWidth: 2,
  },
  bestBadge: {
    position: 'absolute',
    top: -1,
    right: 16,
    backgroundColor: COLORS.gold,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bestBadgeText: {
    color: '#1F2937',
    fontSize: 11,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  bankInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bankIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bankName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  detailItem: {
    width: '50%',
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: 12,
    color: COLORS.gray,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  receiveValue: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
  deliveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deliveryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#10B981',
  },
  selectButton: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  selectButtonActive: {
    backgroundColor: COLORS.primary,
  },
  selectButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  selectButtonTextActive: {
    color: COLORS.white,
  },
});

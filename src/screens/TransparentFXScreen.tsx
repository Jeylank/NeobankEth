import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { exchangeRatesApi } from '../services/api';

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
  blue: '#3B82F6',
  cyan: '#0891B2',
  purple: '#8B5CF6',
  orange: '#F97316',
};

const FEE_PERCENT = 1.5;

const CURRENCY_PAIRS = [
  { from: 'EUR', to: 'ETB', flag: '🇪🇺' },
  { from: 'USD', to: 'ETB', flag: '🇺🇸' },
  { from: 'GBP', to: 'ETB', flag: '🇬🇧' },
];

const MOCK_MID_MARKET: Record<string, number> = {
  EUR: 62.50,
  USD: 57.00,
  GBP: 72.50,
};

const CALCULATOR_CURRENCIES = ['EUR', 'USD', 'GBP', 'ETB'];

export default function TransparentFXScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const [calcFrom, setCalcFrom] = useState('EUR');
  const [calcTo, setCalcTo] = useState('ETB');
  const [calcAmount, setCalcAmount] = useState('100');

  const loadRates = useCallback(async () => {
    try {
      const data = await exchangeRatesApi.getRates();
      if (data?.rates) {
        setRates(data.rates);
      }
      setLastUpdated(data?.lastUpdated || new Date().toISOString());
    } catch {
      setRates({});
      setLastUpdated(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRates();
  }, [loadRates]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRates();
    setRefreshing(false);
  };

  const getOurRate = (from: string): number => {
    if (rates[`${from}_ETB`]) return rates[`${from}_ETB`];
    if (rates[from]) return rates[from];
    return MOCK_MID_MARKET[from] || 1;
  };

  const getMidMarketRate = (from: string): number => {
    const ourRate = getOurRate(from);
    return ourRate * (1 + FEE_PERCENT / 100);
  };

  const getFee = (from: string, amount: number): number => {
    return Math.round(amount * (FEE_PERCENT / 100) * 100) / 100;
  };

  const getTotalCost = (from: string, amount: number): number => {
    return amount + getFee(from, amount);
  };

  const getCalcRate = (): number => {
    if (calcFrom === calcTo) return 1;
    if (calcTo === 'ETB') return getOurRate(calcFrom);
    if (calcFrom === 'ETB') {
      const rate = getOurRate(calcTo);
      return rate > 0 ? 1 / rate : 0;
    }
    const fromToETB = getOurRate(calcFrom);
    const toToETB = getOurRate(calcTo);
    return toToETB > 0 ? fromToETB / toToETB : 0;
  };

  const getConvertedAmount = (): string => {
    const amount = parseFloat(calcAmount) || 0;
    const rate = getCalcRate();
    const fee = getFee(calcFrom, amount);
    const net = amount - fee;
    return (net * rate).toFixed(2);
  };

  const getCalcFee = (): string => {
    const amount = parseFloat(calcAmount) || 0;
    return getFee(calcFrom, amount).toFixed(2);
  };

  const formatLastUpdated = (): string => {
    if (!lastUpdated) return '';
    try {
      const d = new Date(lastUpdated);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return lastUpdated;
    }
  };

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
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.headerCard}>
          <View style={styles.headerIconRow}>
            <View style={styles.headerIconCircle}>
              <Ionicons name="swap-horizontal" size={28} color={COLORS.white} />
            </View>
          </View>
          <Text style={styles.headerTitle}>{t('transparentFX.title')}</Text>
          <Text style={styles.headerSubtitle}>{t('transparentFX.subtitle')}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('transparentFX.rateComparison')}</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, { flex: 1.2 }]}>{t('transparentFX.pair')}</Text>
            <Text style={[styles.tableHeaderText, { flex: 1 }]}>{t('transparentFX.midMarket')}</Text>
            <Text style={[styles.tableHeaderText, { flex: 1 }]}>{t('transparentFX.ourRate')}</Text>
            <Text style={[styles.tableHeaderText, { flex: 0.8 }]}>{t('transparentFX.fee')}</Text>
          </View>
          {CURRENCY_PAIRS.map((pair) => {
            const ourRate = getOurRate(pair.from);
            const midRate = getMidMarketRate(pair.from);
            return (
              <View key={pair.from} style={styles.tableRow}>
                <View style={[styles.tableCell, { flex: 1.2 }]}>
                  <Text style={styles.flagText}>{pair.flag}</Text>
                  <Text style={styles.pairText}>{pair.from}→{pair.to}</Text>
                </View>
                <Text style={[styles.tableCellText, { flex: 1 }]}>{midRate.toFixed(2)}</Text>
                <Text style={[styles.tableCellText, styles.ourRateText, { flex: 1 }]}>{ourRate.toFixed(2)}</Text>
                <Text style={[styles.tableCellText, { flex: 0.8 }]}>{FEE_PERCENT}%</Text>
              </View>
            );
          })}
          <View style={styles.tableFooter}>
            <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.lastUpdatedText}>
              {t('transparentFX.lastUpdated')}: {formatLastUpdated()}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('transparentFX.rateCalculator')}</Text>

          <View style={styles.calcRow}>
            <Text style={styles.calcLabel}>{t('transparentFX.fromCurrency')}</Text>
            <View style={styles.currencyPicker}>
              {CALCULATOR_CURRENCIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.currencyOption, calcFrom === c && styles.currencyOptionActive]}
                  onPress={() => {
                    if (c === calcTo) setCalcTo(calcFrom);
                    setCalcFrom(c);
                  }}
                >
                  <Text style={[styles.currencyOptionText, calcFrom === c && styles.currencyOptionTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.calcRow}>
            <Text style={styles.calcLabel}>{t('transparentFX.amount')}</Text>
            <TextInput
              style={styles.calcInput}
              value={calcAmount}
              onChangeText={setCalcAmount}
              keyboardType="decimal-pad"
              placeholder="100"
            />
          </View>

          <View style={styles.calcArrow}>
            <Ionicons name="arrow-down" size={24} color={COLORS.cyan} />
          </View>

          <View style={styles.calcRow}>
            <Text style={styles.calcLabel}>{t('transparentFX.toCurrency')}</Text>
            <View style={styles.currencyPicker}>
              {CALCULATOR_CURRENCIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.currencyOption, calcTo === c && styles.currencyOptionActive]}
                  onPress={() => {
                    if (c === calcFrom) setCalcFrom(calcTo);
                    setCalcTo(c);
                  }}
                >
                  <Text style={[styles.currencyOptionText, calcTo === c && styles.currencyOptionTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.resultCard}>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>{t('transparentFX.convertedAmount')}</Text>
              <Text style={styles.resultValue}>{calcTo} {getConvertedAmount()}</Text>
            </View>
            <View style={styles.resultDivider} />
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>{t('transparentFX.feeBreakdown')}</Text>
              <Text style={styles.resultFee}>{calcFrom} {getCalcFee()} ({FEE_PERCENT}%)</Text>
            </View>
            <View style={styles.resultDivider} />
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>{t('transparentFX.exchangeRate')}</Text>
              <Text style={styles.resultRate}>1 {calcFrom} = {getCalcRate().toFixed(4)} {calcTo}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('transparentFX.transparencyInfo')}</Text>

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, { backgroundColor: COLORS.success + '20' }]}>
                <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
              </View>
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoTitle}>{t('transparentFX.noHiddenFees')}</Text>
                <Text style={styles.infoDesc}>{t('transparentFX.noHiddenFeesDesc')}</Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, { backgroundColor: COLORS.blue + '20' }]}>
                <Ionicons name="analytics" size={20} color={COLORS.blue} />
              </View>
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoTitle}>{t('transparentFX.midMarketFee')}</Text>
                <Text style={styles.infoDesc}>{t('transparentFX.midMarketFeeDesc')}</Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, { backgroundColor: COLORS.purple + '20' }]}>
                <Ionicons name="shield-checkmark" size={20} color={COLORS.purple} />
              </View>
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoTitle}>{t('transparentFX.partnerDisclaimer')}</Text>
                <Text style={styles.infoDesc}>{t('transparentFX.partnerDisclaimerDesc')}</Text>
              </View>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.convertButton}
          onPress={() => navigation.navigate('Wallet')}
        >
          <Ionicons name="swap-horizontal" size={20} color={COLORS.white} />
          <Text style={styles.convertButtonText}>{t('transparentFX.quickConvert')}</Text>
        </TouchableOpacity>

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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCard: {
    backgroundColor: COLORS.cyan,
    margin: 16,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  headerIconRow: {
    marginBottom: 12,
  },
  headerIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  section: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 4,
  },
  tableHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tableCell: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flagText: {
    fontSize: 18,
    marginRight: 6,
  },
  pairText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  tableCellText: {
    fontSize: 14,
    color: COLORS.text,
  },
  ourRateText: {
    fontWeight: '700',
    color: COLORS.primary,
  },
  tableFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 6,
  },
  lastUpdatedText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  calcRow: {
    marginBottom: 12,
  },
  calcLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  currencyPicker: {
    flexDirection: 'row',
    gap: 8,
  },
  currencyOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  currencyOptionActive: {
    backgroundColor: COLORS.cyan,
    borderColor: COLORS.cyan,
  },
  currencyOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  currencyOptionTextActive: {
    color: COLORS.white,
  },
  calcInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  calcArrow: {
    alignItems: 'center',
    marginVertical: 4,
  },
  resultCard: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  resultLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  resultValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  resultFee: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.orange,
  },
  resultRate: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  resultDivider: {
    height: 1,
    backgroundColor: COLORS.border,
  },
  infoCard: {
    gap: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  infoIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoTextContainer: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  infoDesc: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  convertButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.cyan,
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  convertButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
});

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fxMarketplaceApi, FxQuote } from '../services/api';
import BankOfferCard from '../components/BankOfferCard';
import '../i18n';

const COLORS = {
  primary: '#006633',
  gold: '#FFD700',
  white: '#FFFFFF',
  gray: '#6B7280',
  lightGray: '#F3F4F6',
  text: '#1F2937',
  red: '#DC2626',
};

export default function FxMarketplaceScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const amount = route.params?.amount ?? 200;
  const currency = route.params?.currency ?? 'EUR';
  const payoutMethod = route.params?.payoutMethod ?? 'bank';
  const beneficiaryId = route.params?.beneficiaryId;
  const description = route.params?.description ?? '';
  const paymentMethod = route.params?.paymentMethod ?? 'wallet';

  const [quotes, setQuotes] = useState<FxQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency;

  useEffect(() => {
    fetchQuotes();
  }, []);

  const fetchQuotes = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fxMarketplaceApi.getQuotes({
        amount,
        currency,
        payoutMethod,
      });
      const sorted = data.sort((a: FxQuote, b: FxQuote) => b.receiveAmount - a.receiveAmount);
      setQuotes(sorted);
    } catch (e: any) {
      setError(e.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOffer = async () => {
    if (!selectedQuoteId) {
      Alert.alert(t('common.error'), t('fxMarketplace.pleaseSelect'));
      return;
    }

    setSubmitting(true);
    try {
      await fxMarketplaceApi.selectQuote(selectedQuoteId);

      const selectedQuote = quotes.find((q) => q.quoteId === selectedQuoteId);

      navigation.navigate('Remittance', {
        prefilled: true,
        amount,
        fromCurrency: currency,
        toCurrency: 'ETB',
        selectedQuote,
        beneficiaryId,
        description,
        paymentMethod,
        payoutMethod,
      });
    } catch (e: any) {
      Alert.alert(t('common.error'), e.message || t('fxMarketplace.selectError'));
    } finally {
      setSubmitting(false);
    }
  };

  const bestQuoteId = quotes.length > 0 ? quotes[0].quoteId : null;

  const renderQuote = ({ item }: { item: FxQuote }) => (
    <BankOfferCard
      bank={item.bank}
      rate={item.rate}
      fee={item.fee}
      receiveAmount={item.receiveAmount}
      deliveryTime={item.deliveryTime}
      sendCurrency={currency}
      selected={selectedQuoteId === item.quoteId}
      bestRate={item.quoteId === bestQuoteId}
      onSelect={() => setSelectedQuoteId(item.quoteId)}
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerCard}>
        <View style={styles.flagAccent}>
          <View style={[styles.stripe, { backgroundColor: '#006633' }]} />
          <View style={[styles.stripe, { backgroundColor: '#FFD700' }]} />
          <View style={[styles.stripe, { backgroundColor: '#DC2626' }]} />
        </View>
        <Text style={styles.headerTitle}>{t('fxMarketplace.chooseRate')}</Text>
        <Text style={styles.headerSubtitle}>
          {t('fxMarketplace.sending')} {currencySymbol}{amount.toLocaleString()}
        </Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>{t('fxMarketplace.fetching')}</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.red} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchQuotes}>
            <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : quotes.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="search-outline" size={48} color={COLORS.gray} />
          <Text style={styles.emptyText}>{t('fxMarketplace.noOffers')}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.offersCount}>
            {quotes.length} {t('fxMarketplace.offersAvailable')}
          </Text>
          <FlatList
            data={quotes}
            renderItem={renderQuote}
            keyExtractor={(item) => item.quoteId}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
          <View style={styles.footer}>
            <View style={styles.selectedInfo}>
              {selectedQuoteId ? (
                <>
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />
                  <Text style={styles.selectedText}>
                    {quotes.find((q) => q.quoteId === selectedQuoteId)?.bank}
                  </Text>
                </>
              ) : (
                <Text style={styles.selectPrompt}>{t('fxMarketplace.pleaseSelect')}</Text>
              )}
            </View>
            <TouchableOpacity
              style={[
                styles.confirmButton,
                !selectedQuoteId && styles.confirmButtonDisabled,
              ]}
              onPress={handleSelectOffer}
              disabled={!selectedQuoteId || submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <>
                  <Text style={styles.confirmButtonText}>
                    {t('fxMarketplace.confirmOffer')}
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
                </>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
  },
  headerCard: {
    backgroundColor: COLORS.white,
    padding: 20,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  flagAccent: {
    flexDirection: 'row',
    height: 4,
    marginBottom: 12,
    borderRadius: 2,
    overflow: 'hidden',
  },
  stripe: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 15,
    color: COLORS.gray,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: COLORS.gray,
  },
  errorText: {
    marginTop: 12,
    fontSize: 15,
    color: COLORS.red,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
  },
  retryButtonText: {
    color: COLORS.white,
    fontWeight: '600',
  },
  emptyText: {
    marginTop: 12,
    fontSize: 15,
    color: COLORS.gray,
    textAlign: 'center',
  },
  offersCount: {
    fontSize: 13,
    color: COLORS.gray,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  footer: {
    backgroundColor: COLORS.white,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selectedInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectedText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  selectPrompt: {
    fontSize: 13,
    color: COLORS.gray,
  },
  confirmButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  confirmButtonDisabled: {
    backgroundColor: '#9CA3AF',
  },
  confirmButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
});

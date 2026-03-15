import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import AdminGuard from '../../components/AdminGuard';

const COLORS = {
  primary: '#006633',
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  green: '#10B981',
  blue: '#3B82F6',
  red: '#EF4444',
  amber: '#F59E0B',
  purple: '#8B5CF6',
  cyan: '#0891B2',
};

const MENU_ITEMS = [
  {
    key: 'overview',
    screen: 'AdminOverview',
    icon: 'grid-outline' as const,
    color: COLORS.primary,
    bg: '#ECFDF5',
  },
  {
    key: 'payoutMonitoring',
    screen: 'AdminPayoutMonitoring',
    icon: 'cash-outline' as const,
    color: COLORS.blue,
    bg: '#EFF6FF',
  },
  {
    key: 'fraudAlerts',
    screen: 'AdminFraudAlerts',
    icon: 'warning-outline' as const,
    color: COLORS.red,
    bg: '#FEF2F2',
  },
  {
    key: 'supportTickets',
    screen: 'AdminSupportTickets',
    icon: 'chatbubble-ellipses-outline' as const,
    color: COLORS.amber,
    bg: '#FFFBEB',
  },
  {
    key: 'disputes',
    screen: 'AdminDisputes',
    icon: 'document-text-outline' as const,
    color: COLORS.purple,
    bg: '#F5F3FF',
  },
  {
    key: 'liquidity',
    screen: 'AdminLiquidity',
    icon: 'water-outline' as const,
    color: COLORS.cyan,
    bg: '#ECFEFF',
  },
  {
    key: 'reconciliation',
    screen: 'AdminReconciliationOverview',
    icon: 'git-compare-outline' as const,
    color: '#7C3AED',
    bg: '#F5F3FF',
  },
];

function AdminConsoleContent() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Ionicons name="shield-checkmark" size={24} color={COLORS.white} />
          <Text style={styles.headerTitle}>{t('admin.adminConsole')}</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.welcomeCard}>
          <View style={styles.flagStripe}>
            <View style={[styles.stripe, { backgroundColor: '#006633' }]} />
            <View style={[styles.stripe, { backgroundColor: '#FFD700' }]} />
            <View style={[styles.stripe, { backgroundColor: '#DC2626' }]} />
          </View>
          <Text style={styles.welcomeTitle}>{t('admin.adminConsole')}</Text>
          <Text style={styles.welcomeSubtitle}>
            {t('admin.overview')} • {t('admin.payoutMonitoring')} • {t('admin.fraudAlerts')}
          </Text>
        </View>

        <View style={styles.grid}>
          {MENU_ITEMS.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={styles.menuCard}
              onPress={() => navigation.navigate(item.screen)}
              activeOpacity={0.7}
            >
              <View style={[styles.iconCircle, { backgroundColor: item.bg }]}>
                <Ionicons name={item.icon} size={28} color={item.color} />
              </View>
              <Text style={styles.menuLabel}>{t(`admin.${item.key}`)}</Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={COLORS.textSecondary}
              />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {t('admin.consoleVersion')}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AdminConsoleScreen() {
  return (
    <AdminGuard>
      <AdminConsoleContent />
    </AdminGuard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.white,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 16,
    paddingBottom: 32,
  },
  welcomeCard: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    overflow: 'hidden',
  },
  flagStripe: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 16,
  },
  stripe: {
    flex: 1,
    height: 4,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 4,
  },
  welcomeSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
  grid: {
    gap: 12,
  },
  menuCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  footer: {
    alignItems: 'center',
    marginTop: 32,
    paddingVertical: 16,
  },
  footerText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
});

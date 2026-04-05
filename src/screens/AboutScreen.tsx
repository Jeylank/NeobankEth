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

const C = {
  primary: '#006633',
  light:   '#E6F4EC',
  white:   '#FFFFFF',
  bg:      '#F5F7FA',
  text:    '#1F2937',
  sub:     '#6B7280',
  border:  '#E5E7EB',
};

const LINKS = [
  { label: 'Privacy Policy',    icon: 'lock-closed-outline',  url: 'https://sumsuma.com/privacy' },
  { label: 'Terms of Service',  icon: 'document-text-outline', url: 'https://sumsuma.com/terms' },
  { label: 'Help & Support',    icon: 'help-circle-outline',   url: 'https://sumsuma.com/support' },
  { label: 'Website',           icon: 'globe-outline',         url: 'https://sumsuma.com' },
];

const FEATURES = [
  { icon: 'send',               label: 'Remittance to Ethiopia' },
  { icon: 'people',             label: 'Family Wallet & Circle' },
  { icon: 'heart',              label: 'Support Campaigns' },
  { icon: 'repeat',             label: 'Recurring Support' },
  { icon: 'wallet',             label: 'Multi-Currency Wallet' },
  { icon: 'trending-up',        label: 'Transparent FX Rates' },
  { icon: 'flash',              label: 'Bill Payments' },
  { icon: 'shield-checkmark',   label: 'Biometric Security' },
];

export default function AboutScreen() {
  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <View style={s.hero}>
          <View style={s.logoCircle}>
            <Text style={s.logoText}>H</Text>
          </View>
          <Text style={s.appName}>Sumsuma</Text>
          <Text style={s.tagline}>Secure Finance for the Ethiopian Diaspora</Text>
          <View style={s.versionBadge}>
            <Text style={s.versionText}>Version 1.0.0</Text>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>About Sumsuma</Text>
          <Text style={s.aboutText}>
            Sumsuma is a non-custodial financial platform that connects the Ethiopian diaspora
            with their families back home. We facilitate remittances, bill payments, and family
            support through licensed Ethiopian financial institutions — we never hold your funds.
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Features</Text>
          {FEATURES.map((f) => (
            <View key={f.label} style={s.featureRow}>
              <View style={s.featureIcon}>
                <Ionicons name={f.icon as any} size={18} color={C.primary} />
              </View>
              <Text style={s.featureLabel}>{f.label}</Text>
            </View>
          ))}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Legal & Support</Text>
          {LINKS.map((link) => (
            <TouchableOpacity
              key={link.label}
              style={s.linkRow}
              onPress={() => Linking.openURL(link.url).catch(() => {})}
            >
              <View style={s.linkIcon}>
                <Ionicons name={link.icon as any} size={18} color={C.primary} />
              </View>
              <Text style={s.linkLabel}>{link.label}</Text>
              <Ionicons name="open-outline" size={16} color={C.sub} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.footerCard}>
          <Ionicons name="shield-checkmark" size={20} color={C.primary} />
          <Text style={s.footerText}>
            Licensed & regulated · Non-custodial model · 256-bit encryption
          </Text>
        </View>

        <Text style={s.copyright}>© 2026 Sumsuma Global. All rights reserved.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll:    { padding: 20 },

  hero: { alignItems: 'center', marginBottom: 28 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  logoText:     { fontSize: 36, fontWeight: '800', color: C.white },
  appName:      { fontSize: 24, fontWeight: '800', color: C.text },
  tagline:      { fontSize: 14, color: C.sub, textAlign: 'center', marginTop: 4, lineHeight: 20 },
  versionBadge: {
    marginTop: 10, paddingHorizontal: 14, paddingVertical: 5,
    backgroundColor: C.light, borderRadius: 12,
  },
  versionText: { fontSize: 13, fontWeight: '600', color: C.primary },

  card: {
    backgroundColor: C.white, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 12 },

  aboutText: { fontSize: 14, color: C.sub, lineHeight: 22 },

  featureRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  featureIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.light, alignItems: 'center', justifyContent: 'center',
  },
  featureLabel: { fontSize: 14, color: C.text, fontWeight: '500' },

  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  linkIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.light, alignItems: 'center', justifyContent: 'center',
  },
  linkLabel: { flex: 1, fontSize: 14, color: C.text, fontWeight: '500' },

  footerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.light, borderRadius: 12, padding: 14, marginBottom: 16,
  },
  footerText: { flex: 1, fontSize: 13, color: C.primary, fontWeight: '500' },

  copyright: { fontSize: 12, color: C.sub, textAlign: 'center', marginBottom: 8 },
});

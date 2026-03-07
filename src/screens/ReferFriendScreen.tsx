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
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { referralApi } from '../services/api';

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

export default function ReferFriendScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');

  const { data: referralData, isLoading } = useQuery({
    queryKey: ['referral'],
    queryFn: () => referralApi.getInfo(),
  });

  const inviteMutation = useMutation({
    mutationFn: (email: string) => referralApi.invite(email),
    onSuccess: () => {
      Alert.alert(t('common.success'), t('referral.inviteSent'));
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['referral'] });
    },
    onError: (error: any) => {
      Alert.alert(t('common.error'), error.message || t('referral.inviteFailed'));
    },
  });

  const referralCode = referralData?.code || 'LOADING...';
  const referralLink = `https://habeshare.com/invite/${referralCode}`;
  const totalReferred = referralData?.totalReferred || 0;
  const totalEarnings = referralData?.totalEarnings || 0;
  const pendingRewards = referralData?.pendingRewards || 0;

  const handleCopyCode = async () => {
    await Clipboard.setStringAsync(referralCode);
    Alert.alert(t('referral.copied'), t('referral.codeCopied'));
  };

  const handleCopyLink = async () => {
    await Clipboard.setStringAsync(referralLink);
    Alert.alert(t('referral.copied'), t('referral.linkCopied'));
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: t('referral.shareMessage', { code: referralCode, link: referralLink }),
        title: t('referral.shareTitle'),
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  const handleInviteByEmail = () => {
    if (!email.trim()) {
      Alert.alert(t('common.error'), t('referral.enterEmail'));
      return;
    }
    if (!email.includes('@')) {
      Alert.alert(t('common.error'), t('referral.validEmail'));
      return;
    }
    inviteMutation.mutate(email);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="gift" size={40} color={COLORS.gold} />
          </View>
          <Text style={styles.title}>{t('referral.title')}</Text>
          <Text style={styles.subtitle}>{t('referral.subtitle')}</Text>
        </View>

        <View style={styles.statsSection}>
          <View style={styles.statCard}>
            <Ionicons name="people" size={24} color={COLORS.primary} />
            <Text style={styles.statValue}>{totalReferred}</Text>
            <Text style={styles.statLabel}>{t('referral.friendsReferred')}</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="wallet" size={24} color={COLORS.success} />
            <Text style={styles.statValue}>{totalEarnings.toLocaleString()}</Text>
            <Text style={styles.statLabel}>{t('referral.totalEarned')}</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="time" size={24} color={COLORS.gold} />
            <Text style={styles.statValue}>{pendingRewards.toLocaleString()}</Text>
            <Text style={styles.statLabel}>{t('referral.pending')}</Text>
          </View>
        </View>

        <View style={styles.codeSection}>
          <Text style={styles.sectionTitle}>{t('referral.yourCode')}</Text>
          <View style={styles.codeCard}>
            <Text style={styles.codeText}>{referralCode}</Text>
            <TouchableOpacity style={styles.copyButton} onPress={handleCopyCode}>
              <Ionicons name="copy" size={20} color={COLORS.white} />
              <Text style={styles.copyButtonText}>{t('referral.copy')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.linkSection}>
          <Text style={styles.sectionTitle}>{t('referral.referralLink')}</Text>
          <View style={styles.linkCard}>
            <Text style={styles.linkText} numberOfLines={1}>
              {referralLink}
            </Text>
            <TouchableOpacity style={styles.copyLinkButton} onPress={handleCopyLink}>
              <Ionicons name="copy-outline" size={20} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.shareSection}>
          <Text style={styles.sectionTitle}>{t('referral.shareVia')}</Text>
          <View style={styles.shareButtons}>
            <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
              <View style={[styles.shareIcon, { backgroundColor: '#25D366' }]}>
                <Ionicons name="logo-whatsapp" size={24} color={COLORS.white} />
              </View>
              <Text style={styles.shareLabel}>{t('referral.whatsapp')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
              <View style={[styles.shareIcon, { backgroundColor: '#1877F2' }]}>
                <Ionicons name="logo-facebook" size={24} color={COLORS.white} />
              </View>
              <Text style={styles.shareLabel}>{t('referral.facebook')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
              <View style={[styles.shareIcon, { backgroundColor: '#1DA1F2' }]}>
                <Ionicons name="logo-twitter" size={24} color={COLORS.white} />
              </View>
              <Text style={styles.shareLabel}>{t('referral.twitter')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
              <View style={[styles.shareIcon, { backgroundColor: COLORS.textSecondary }]}>
                <Ionicons name="share-social" size={24} color={COLORS.white} />
              </View>
              <Text style={styles.shareLabel}>{t('referral.more')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.emailSection}>
          <Text style={styles.sectionTitle}>{t('referral.inviteByEmail')}</Text>
          <View style={styles.emailForm}>
            <TextInput
              style={styles.emailInput}
              value={email}
              onChangeText={setEmail}
              placeholder={t('referral.emailPlaceholder')}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[styles.inviteButton, inviteMutation.isPending && styles.inviteButtonDisabled]}
              onPress={handleInviteByEmail}
              disabled={inviteMutation.isPending}
            >
              {inviteMutation.isPending ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Text style={styles.inviteButtonText}>{t('referral.invite')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.howItWorks}>
          <Text style={styles.sectionTitle}>{t('referral.howItWorks')}</Text>
          <View style={styles.step}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>1</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>{t('referral.step1Title')}</Text>
              <Text style={styles.stepDescription}>{t('referral.step1Desc')}</Text>
            </View>
          </View>
          <View style={styles.step}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>2</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>{t('referral.step2Title')}</Text>
              <Text style={styles.stepDescription}>{t('referral.step2Desc')}</Text>
            </View>
          </View>
          <View style={styles.step}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>3</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>{t('referral.step3Title')}</Text>
              <Text style={styles.stepDescription}>{t('referral.step3Desc')}</Text>
            </View>
          </View>
        </View>

        <View style={styles.termsSection}>
          <Text style={styles.termsTitle}>{t('referral.termsTitle')}</Text>
          <Text style={styles.termsText}>{t('referral.termsText')}</Text>
        </View>
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
  header: {
    padding: 24,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  headerIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.white,
    opacity: 0.9,
    marginTop: 8,
  },
  statsSection: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    marginTop: 8,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  codeSection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  codeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
  },
  codeText: {
    flex: 1,
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
    letterSpacing: 2,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  copyButtonText: {
    color: COLORS.white,
    fontWeight: '600',
  },
  linkSection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
  },
  linkText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  copyLinkButton: {
    padding: 8,
  },
  shareSection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  shareButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  shareButton: {
    alignItems: 'center',
  },
  shareIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
  emailSection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  emailForm: {
    flexDirection: 'row',
    gap: 12,
  },
  emailInput: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  inviteButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  inviteButtonDisabled: {
    opacity: 0.6,
  },
  inviteButtonText: {
    color: COLORS.white,
    fontWeight: '600',
  },
  howItWorks: {
    padding: 20,
    backgroundColor: COLORS.white,
    margin: 20,
    marginTop: 0,
    borderRadius: 16,
  },
  step: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepNumberText: {
    color: COLORS.white,
    fontWeight: 'bold',
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  stepDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  termsSection: {
    margin: 20,
    marginTop: 0,
    padding: 16,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 40,
  },
  termsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  termsText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
});

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Switch,
  TextInput,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { authApi, balanceApi } from '../services/api';
import { biometricService } from '../services/biometric';
import { firebaseAuth } from '../services/firebase';

const COLORS = {
  primary: '#006633',
  gold: '#FFD700',
  red: '#DC2626',
  white: '#FFFFFF',
  gray: '#6B7280',
  lightGray: '#F3F4F6',
  text: '#1F2937',
};

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { user, signOut, isLoading: authLoading } = useAuth();
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricType, setBiometricType] = useState<string>('Biometric');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [isEnabling, setIsEnabling] = useState(false);

  const { data: profileData, isLoading: profileLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => authApi.getProfile(),
    enabled: !!user,
  });

  const { data: balanceData } = useQuery({
    queryKey: ['balance'],
    queryFn: () => balanceApi.getBalance(),
  });

  useEffect(() => {
    checkBiometric();
  }, []);

  const checkBiometric = async () => {
    const available = await biometricService.isAvailable();
    setBiometricAvailable(available);
    
    if (available) {
      const enabled = await biometricService.isEnabled();
      setBiometricEnabled(enabled);
      
      const types = await biometricService.getSupportedTypes();
      if (types.includes('Face ID')) {
        setBiometricType('Face ID');
      } else if (types.includes('Fingerprint')) {
        setBiometricType('Fingerprint');
      }
    }
  };

  const handleBiometricToggle = async (value: boolean) => {
    if (value) {
      setShowPasswordModal(true);
    } else {
      Alert.alert(
        `Disable ${biometricType}`,
        `Are you sure you want to disable ${biometricType} login?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: async () => {
              await biometricService.disable();
              setBiometricEnabled(false);
              Alert.alert('Success', `${biometricType} login has been disabled.`);
            },
          },
        ]
      );
    }
  };

  const handleEnableBiometric = async () => {
    if (!password) {
      Alert.alert('Error', 'Please enter your password');
      return;
    }

    if (!user?.email) {
      Alert.alert('Error', 'User email not found');
      return;
    }

    setIsEnabling(true);
    try {
      await firebaseAuth.signIn(user.email, password);

      const authenticated = await biometricService.authenticate(
        `Confirm your identity to enable ${biometricType}`
      );

      if (authenticated) {
        await biometricService.enable({
          email: user.email,
          password: password,
        });
        setBiometricEnabled(true);
        setShowPasswordModal(false);
        setPassword('');
        Alert.alert('Success', `${biometricType} login has been enabled! You can now use ${biometricType} to sign in.`);
      } else {
        Alert.alert('Error', 'Biometric authentication failed. Please try again.');
      }
    } catch (error: any) {
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        Alert.alert('Error', 'Incorrect password. Please try again.');
      } else {
        Alert.alert('Error', error.message || 'Failed to enable biometric login');
      }
    } finally {
      setIsEnabling(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: signOut },
      ]
    );
  };

  const menuItems = [
    {
      section: 'Account',
      items: [
        { icon: 'person-outline', label: 'Personal Information', action: () => {} },
        { icon: 'card-outline', label: 'KYC Verification', action: () => navigation.navigate('KYC') },
        { icon: 'notifications-outline', label: 'Notifications', action: () => {} },
      ],
    },
    {
      section: 'Banking',
      items: [
        { icon: 'business-outline', label: 'Bank Accounts', action: () => navigation.navigate('BankAccounts') },
        { icon: 'flash-outline', label: 'Pay Bills', action: () => navigation.navigate('BillPayments') },
        { icon: 'paper-plane-outline', label: 'Track Transfers', action: () => navigation.navigate('RemittanceTracking') },
        { icon: 'people-outline', label: 'Beneficiaries', action: () => {} },
      ],
    },
    {
      section: 'Payments',
      items: [
        { icon: 'card-outline', label: 'Add via Chapa', action: () => navigation.navigate('ChapaPayment') },
        { icon: 'phone-portrait-outline', label: 'Add via Telebirr', action: () => navigation.navigate('TelebirrPayment') },
      ],
    },
    {
      section: 'Rewards',
      items: [
        { icon: 'gift-outline', label: 'Refer a Friend', action: () => navigation.navigate('ReferFriend') },
      ],
    },
    {
      section: 'Preferences',
      items: [
        { icon: 'language-outline', label: 'Language', action: () => navigation.navigate('Language') },
        { icon: 'cash-outline', label: 'Currency', value: 'USD' },
        { icon: 'moon-outline', label: 'Dark Mode', value: 'Off' },
      ],
    },
    {
      section: 'Support',
      items: [
        { icon: 'help-circle-outline', label: 'Help & Support', action: () => navigation.navigate('Support') },
        { icon: 'information-circle-outline', label: 'About', action: () => {} },
      ],
    },
  ];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  if (profileLoading || authLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.profileHeader}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(profileData?.fullName || user?.email || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <TouchableOpacity style={styles.editAvatarButton}>
            <Ionicons name="camera" size={16} color={COLORS.white} />
          </TouchableOpacity>
        </View>
        <Text style={styles.userName}>{profileData?.fullName || 'User'}</Text>
        <Text style={styles.userEmail}>{user?.email}</Text>
        
        <View style={styles.balanceContainer}>
          <Text style={styles.balanceLabel}>Account Balance</Text>
          <Text style={styles.balanceValue}>
            {formatCurrency(balanceData?.balance || 0)}
          </Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Ionicons name="trending-up" size={24} color={COLORS.primary} />
          <Text style={styles.statValue}>12</Text>
          <Text style={styles.statLabel}>Transactions</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Ionicons name="send" size={24} color={COLORS.gold} />
          <Text style={styles.statValue}>5</Text>
          <Text style={styles.statLabel}>Remittances</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Ionicons name="flag" size={24} color={COLORS.red} />
          <Text style={styles.statValue}>3</Text>
          <Text style={styles.statLabel}>Goals</Text>
        </View>
      </View>

      {menuItems.map((section, sectionIndex) => (
        <View key={sectionIndex} style={styles.menuSection}>
          <Text style={styles.sectionTitle}>{section.section}</Text>
          <View style={styles.menuCard}>
            {section.items.map((item, itemIndex) => (
              <TouchableOpacity
                key={itemIndex}
                style={[
                  styles.menuItem,
                  itemIndex < section.items.length - 1 && styles.menuItemBorder,
                ]}
                onPress={'action' in item ? item.action : undefined}
              >
                <View style={styles.menuItemLeft}>
                  <Ionicons name={item.icon as any} size={22} color={COLORS.gray} />
                  <Text style={styles.menuItemLabel}>{item.label}</Text>
                </View>
                {'value' in item && item.value ? (
                  <Text style={styles.menuItemValue}>{item.value}</Text>
                ) : (
                  <Ionicons name="chevron-forward" size={20} color={COLORS.gray} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {biometricAvailable && (
        <View style={styles.menuSection}>
          <Text style={styles.sectionTitle}>Security</Text>
          <View style={styles.menuCard}>
            <View style={styles.biometricRow}>
              <View style={styles.menuItemLeft}>
                <Ionicons 
                  name={biometricType === 'Face ID' ? 'scan-outline' : 'finger-print-outline'} 
                  size={22} 
                  color={COLORS.gray} 
                />
                <View style={styles.biometricInfo}>
                  <Text style={styles.menuItemLabel}>{biometricType} Login</Text>
                  <Text style={styles.biometricDescription}>
                    Quick and secure access
                  </Text>
                </View>
              </View>
              <Switch
                value={biometricEnabled}
                onValueChange={handleBiometricToggle}
                trackColor={{ false: '#E5E7EB', true: '#BBF7D0' }}
                thumbColor={biometricEnabled ? COLORS.primary : '#9CA3AF'}
              />
            </View>
          </View>
        </View>
      )}

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Ionicons name="log-out-outline" size={22} color={COLORS.red} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <View style={styles.flagStripe}>
          <View style={[styles.stripe, { backgroundColor: '#006633' }]} />
          <View style={[styles.stripe, { backgroundColor: '#FFD700' }]} />
          <View style={[styles.stripe, { backgroundColor: '#FF0000' }]} />
        </View>
        <Text style={styles.appVersion}>Habeshare v1.0.0</Text>
        <Text style={styles.footerText}>Habeshare Global</Text>
      </View>

      <View style={styles.bottomPadding} />

      <Modal
        visible={showPasswordModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowPasswordModal(false);
          setPassword('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Enable {biometricType} Login</Text>
            <Text style={styles.modalDescription}>
              Enter your password to enable {biometricType} login. Your credentials will be securely stored on your device.
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Enter your password"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowPasswordModal(false);
                  setPassword('');
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalEnableButton, isEnabling && styles.buttonDisabled]}
                onPress={handleEnableBiometric}
                disabled={isEnabling}
              >
                {isEnabling ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalEnableText}>Enable</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.lightGray,
  },
  profileHeader: {
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 30,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  editAvatarButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  userName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.white,
    marginTop: 12,
  },
  userEmail: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
  balanceContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  balanceValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.white,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: -20,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: COLORS.lightGray,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  menuSection: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray,
    marginBottom: 8,
    marginLeft: 4,
  },
  menuCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuItemLabel: {
    fontSize: 15,
    color: COLORS.text,
    marginLeft: 12,
  },
  menuItemValue: {
    fontSize: 14,
    color: COLORS.gray,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
  },
  signOutText: {
    fontSize: 16,
    color: COLORS.red,
    fontWeight: '500',
    marginLeft: 8,
  },
  footer: {
    alignItems: 'center',
    marginTop: 32,
  },
  flagStripe: {
    flexDirection: 'row',
    width: 60,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  stripe: {
    flex: 1,
  },
  appVersion: {
    fontSize: 14,
    color: COLORS.gray,
    marginTop: 12,
  },
  footerText: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 4,
  },
  bottomPadding: {
    height: 40,
  },
  biometricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  biometricInfo: {
    marginLeft: 12,
    flex: 1,
  },
  biometricDescription: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  modalDescription: {
    fontSize: 14,
    color: COLORS.gray,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  modalInput: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 24,
    color: COLORS.text,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.gray,
    alignItems: 'center',
  },
  modalCancelText: {
    color: COLORS.gray,
    fontSize: 16,
    fontWeight: '600',
  },
  modalEnableButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  modalEnableText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});

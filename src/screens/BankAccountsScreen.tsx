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
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bankAccountsApi } from '../services/api';

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

const BANK_TYPES = [
  { id: 'cbe', name: 'Commercial Bank of Ethiopia', icon: 'business' },
  { id: 'awash', name: 'Awash Bank', icon: 'business' },
  { id: 'dashen', name: 'Dashen Bank', icon: 'business' },
  { id: 'abyssinia', name: 'Bank of Abyssinia', icon: 'business' },
  { id: 'nib', name: 'Nib International Bank', icon: 'business' },
  { id: 'other', name: 'Other Bank', icon: 'business' },
];

export default function BankAccountsScreen() {
  const queryClient = useQueryClient();
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedBank, setSelectedBank] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => bankAccountsApi.getAll(),
  });

  const addMutation = useMutation({
    mutationFn: (data: { bankName: string; accountNumber: string; accountName: string }) =>
      bankAccountsApi.add(data),
    onSuccess: () => {
      Alert.alert('Success', 'Bank account added successfully!');
      setModalVisible(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || 'Failed to add bank account');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => bankAccountsApi.delete(id),
    onSuccess: () => {
      Alert.alert('Success', 'Bank account removed');
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || 'Failed to remove bank account');
    },
  });

  const resetForm = () => {
    setSelectedBank('');
    setAccountNumber('');
    setAccountName('');
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleAddAccount = () => {
    if (!selectedBank || !accountNumber || !accountName) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    const bankInfo = BANK_TYPES.find(b => b.id === selectedBank);
    addMutation.mutate({
      bankName: bankInfo?.name || selectedBank,
      accountNumber,
      accountName,
    });
  };

  const handleDeleteAccount = (id: number, bankName: string) => {
    Alert.alert(
      'Remove Bank Account',
      `Are you sure you want to remove ${bankName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => deleteMutation.mutate(id) },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Bank Accounts</Text>
          <Text style={styles.subtitle}>Manage your connected bank accounts</Text>
        </View>

        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setModalVisible(true)}
        >
          <Ionicons name="add-circle" size={24} color={COLORS.primary} />
          <Text style={styles.addButtonText}>Add New Bank Account</Text>
        </TouchableOpacity>

        <View style={styles.accountsSection}>
          <Text style={styles.sectionTitle}>Connected Accounts</Text>
          
          {isLoading ? (
            <ActivityIndicator color={COLORS.primary} style={{ padding: 20 }} />
          ) : data?.accounts?.length > 0 ? (
            data.accounts.map((account: any) => (
              <View key={account.id} style={styles.accountCard}>
                <View style={styles.bankIcon}>
                  <Ionicons name="business" size={24} color={COLORS.primary} />
                </View>
                <View style={styles.accountDetails}>
                  <Text style={styles.bankName}>{account.bankName}</Text>
                  <Text style={styles.accountNumber}>
                    ****{account.accountNumber?.slice(-4)}
                  </Text>
                  <Text style={styles.accountHolder}>{account.accountName}</Text>
                </View>
                <View style={styles.accountActions}>
                  <View style={[styles.statusBadge, { backgroundColor: COLORS.success + '20' }]}>
                    <Text style={[styles.statusText, { color: COLORS.success }]}>Verified</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleDeleteAccount(account.id, account.bankName)}
                  >
                    <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="wallet-outline" size={48} color={COLORS.textSecondary} />
              <Text style={styles.emptyTitle}>No Bank Accounts</Text>
              <Text style={styles.emptyText}>
                Add a bank account to start sending and receiving money
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Bank Account</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.inputLabel}>Select Bank</Text>
              <View style={styles.bankGrid}>
                {BANK_TYPES.map((bank) => (
                  <TouchableOpacity
                    key={bank.id}
                    style={[
                      styles.bankOption,
                      selectedBank === bank.id && styles.bankOptionSelected,
                    ]}
                    onPress={() => setSelectedBank(bank.id)}
                  >
                    <Text
                      style={[
                        styles.bankOptionText,
                        selectedBank === bank.id && styles.bankOptionTextSelected,
                      ]}
                      numberOfLines={2}
                    >
                      {bank.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Account Number</Text>
                <TextInput
                  style={styles.input}
                  value={accountNumber}
                  onChangeText={setAccountNumber}
                  placeholder="Enter account number"
                  keyboardType="number-pad"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Account Holder Name</Text>
                <TextInput
                  style={styles.input}
                  value={accountName}
                  onChangeText={setAccountName}
                  placeholder="Enter account holder name"
                />
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.submitButton, addMutation.isPending && styles.submitButtonDisabled]}
              onPress={handleAddAccount}
              disabled={addMutation.isPending}
            >
              {addMutation.isPending ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.submitButtonText}>Add Account</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  header: {
    padding: 20,
    backgroundColor: COLORS.primary,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.white,
    opacity: 0.8,
    marginTop: 4,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    margin: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    gap: 8,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
  accountsSection: {
    padding: 20,
    paddingTop: 0,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  bankIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountDetails: {
    flex: 1,
    marginLeft: 12,
  },
  bankName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  accountNumber: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  accountHolder: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  accountActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  deleteButton: {
    padding: 4,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
    backgroundColor: COLORS.white,
    borderRadius: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalBody: {
    padding: 20,
  },
  bankGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  bankOption: {
    width: '48%',
    backgroundColor: COLORS.background,
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  bankOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  bankOptionText: {
    fontSize: 12,
    color: COLORS.text,
    textAlign: 'center',
  },
  bankOptionTextSelected: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    margin: 20,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
});

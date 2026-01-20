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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billsApi } from '../services/api';

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
  warning: '#F59E0B',
};

const BILL_CATEGORIES = [
  { id: 'electricity', name: 'Electricity', icon: 'flash' as const },
  { id: 'water', name: 'Water', icon: 'water' as const },
  { id: 'internet', name: 'Internet', icon: 'wifi' as const },
  { id: 'phone', name: 'Phone', icon: 'call' as const },
  { id: 'education', name: 'Education', icon: 'school' as const },
  { id: 'tv', name: 'TV/Cable', icon: 'tv' as const },
];

export default function BillPaymentsScreen() {
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { data: billsData, isLoading, refetch } = useQuery({
    queryKey: ['bills'],
    queryFn: () => billsApi.getAll(),
  });

  const payMutation = useMutation({
    mutationFn: (data: { category: string; accountNumber: string; amount: number }) =>
      billsApi.payBill(data),
    onSuccess: () => {
      Alert.alert('Success', 'Bill payment successful!');
      setSelectedCategory(null);
      setAccountNumber('');
      setAmount('');
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || 'Payment failed');
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handlePayBill = () => {
    if (!selectedCategory || !accountNumber || !amount) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    payMutation.mutate({
      category: selectedCategory,
      accountNumber,
      amount: amountNum,
    });
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
          <Text style={styles.title}>Bill Payments</Text>
          <Text style={styles.subtitle}>Pay your bills quickly and securely</Text>
        </View>

        <View style={styles.categoriesSection}>
          <Text style={styles.sectionTitle}>Select Category</Text>
          <View style={styles.categoriesGrid}>
            {BILL_CATEGORIES.map((category) => (
              <TouchableOpacity
                key={category.id}
                style={[
                  styles.categoryCard,
                  selectedCategory === category.id && styles.categoryCardSelected,
                ]}
                onPress={() => setSelectedCategory(category.id)}
              >
                <Ionicons
                  name={category.icon}
                  size={28}
                  color={selectedCategory === category.id ? COLORS.white : COLORS.primary}
                />
                <Text
                  style={[
                    styles.categoryName,
                    selectedCategory === category.id && styles.categoryNameSelected,
                  ]}
                >
                  {category.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {selectedCategory && (
          <View style={styles.paymentForm}>
            <Text style={styles.sectionTitle}>Payment Details</Text>
            
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Account/Meter Number</Text>
              <TextInput
                style={styles.input}
                value={accountNumber}
                onChangeText={setAccountNumber}
                placeholder="Enter account number"
                keyboardType="default"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Amount (ETB)</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                keyboardType="decimal-pad"
              />
            </View>

            <TouchableOpacity
              style={[styles.payButton, payMutation.isPending && styles.payButtonDisabled]}
              onPress={handlePayBill}
              disabled={payMutation.isPending}
            >
              {payMutation.isPending ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="card" size={20} color={COLORS.white} />
                  <Text style={styles.payButtonText}>Pay Bill</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.historySection}>
          <Text style={styles.sectionTitle}>Recent Payments</Text>
          {isLoading ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : billsData?.bills?.length > 0 ? (
            billsData.bills.slice(0, 5).map((bill: any) => (
              <View key={bill.id} style={styles.historyItem}>
                <View style={styles.historyIcon}>
                  <Ionicons
                    name={BILL_CATEGORIES.find(c => c.id === bill.category)?.icon || 'document'}
                    size={20}
                    color={COLORS.primary}
                  />
                </View>
                <View style={styles.historyDetails}>
                  <Text style={styles.historyTitle}>{bill.category}</Text>
                  <Text style={styles.historyDate}>{bill.accountNumber}</Text>
                </View>
                <View style={styles.historyAmount}>
                  <Text style={styles.amountText}>ETB {bill.amount?.toFixed(2)}</Text>
                  <Text style={[styles.statusText, { color: COLORS.success }]}>Paid</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No payment history</Text>
          )}
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
  categoriesSection: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  categoryCard: {
    width: '30%',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  categoryCardSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  categoryName: {
    fontSize: 12,
    color: COLORS.text,
    marginTop: 8,
    textAlign: 'center',
  },
  categoryNameSelected: {
    color: COLORS.white,
  },
  paymentForm: {
    padding: 20,
    backgroundColor: COLORS.white,
    marginHorizontal: 20,
    borderRadius: 12,
    marginBottom: 20,
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
  payButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  payButtonDisabled: {
    opacity: 0.6,
  },
  payButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  historySection: {
    padding: 20,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  historyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyDetails: {
    flex: 1,
    marginLeft: 12,
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    textTransform: 'capitalize',
  },
  historyDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  historyAmount: {
    alignItems: 'flex-end',
  },
  amountText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  statusText: {
    fontSize: 12,
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    padding: 20,
  },
});

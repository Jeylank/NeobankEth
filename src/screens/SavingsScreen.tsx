import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { savingsApi } from '../services/api';
import type { SavingsGoal } from '../types';

const COLORS = {
  primary: '#006633',
  gold: '#FFD700',
  red: '#DC2626',
  white: '#FFFFFF',
  gray: '#6B7280',
  lightGray: '#F3F4F6',
  text: '#1F2937',
};

export default function SavingsScreen() {
  const queryClient = useQueryClient();
  const [modalVisible, setModalVisible] = useState(false);
  const [newGoal, setNewGoal] = useState({ name: '', targetAmount: '', currency: 'USD' });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['savings-goals'],
    queryFn: () => savingsApi.getGoals(),
  });

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const createMutation = useMutation({
    mutationFn: savingsApi.createGoal,
    onSuccess: () => {
      Alert.alert('Success', 'Savings goal created!');
      setModalVisible(false);
      setNewGoal({ name: '', targetAmount: '', currency: 'USD' });
      queryClient.invalidateQueries({ queryKey: ['savings-goals'] });
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || 'Failed to create goal');
    },
  });

  const handleCreateGoal = () => {
    if (!newGoal.name || !newGoal.targetAmount) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    createMutation.mutate({
      name: newGoal.name,
      targetAmount: newGoal.targetAmount,
      currency: newGoal.currency,
    });
  };

  const formatCurrency = (amount: string, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(parseFloat(amount));
  };

  const getProgress = (goal: SavingsGoal) => {
    return Math.min((parseFloat(goal.currentAmount) / parseFloat(goal.targetAmount)) * 100, 100);
  };

  const totalSaved = data?.goals?.reduce(
    (sum, goal) => sum + parseFloat(goal.currentAmount),
    0
  ) || 0;

  const totalTarget = data?.goals?.reduce(
    (sum, goal) => sum + parseFloat(goal.targetAmount),
    0
  ) || 0;

  return (
    <View style={styles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Saved</Text>
              <Text style={styles.summaryValue}>${totalSaved.toFixed(2)}</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Target</Text>
              <Text style={styles.summaryValue}>${totalTarget.toFixed(2)}</Text>
            </View>
          </View>
          <View style={styles.overallProgress}>
            <View
              style={[
                styles.overallProgressFill,
                { width: totalTarget > 0 ? `${(totalSaved / totalTarget) * 100}%` : '0%' },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {totalTarget > 0 ? ((totalSaved / totalTarget) * 100).toFixed(1) : 0}% of total goal
          </Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your Goals</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setModalVisible(true)}
          >
            <Ionicons name="add" size={20} color={COLORS.white} />
            <Text style={styles.addButtonText}>Add Goal</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color={COLORS.primary} style={styles.loader} />
        ) : data?.goals?.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="wallet-outline" size={64} color={COLORS.gray} />
            <Text style={styles.emptyTitle}>No Savings Goals Yet</Text>
            <Text style={styles.emptyText}>
              Start saving for your dreams by creating your first goal
            </Text>
          </View>
        ) : (
          data?.goals?.map((goal) => (
            <View key={goal.id} style={styles.goalCard}>
              <View style={styles.goalHeader}>
                <View style={styles.goalIcon}>
                  <Ionicons name="flag" size={24} color={COLORS.primary} />
                </View>
                <View style={styles.goalInfo}>
                  <Text style={styles.goalName}>{goal.name}</Text>
                  <Text style={styles.goalStatus}>
                    {goal.status === 'completed' ? '🎉 Goal Achieved!' : 'In Progress'}
                  </Text>
                </View>
                {goal.status === 'completed' && (
                  <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />
                )}
              </View>

              <View style={styles.goalProgress}>
                <View style={styles.progressLabels}>
                  <Text style={styles.progressCurrent}>
                    {formatCurrency(goal.currentAmount, goal.currency)}
                  </Text>
                  <Text style={styles.progressTarget}>
                    of {formatCurrency(goal.targetAmount, goal.currency)}
                  </Text>
                </View>
                <View style={styles.progressBar}>
                  <View
                    style={[styles.progressFill, { width: `${getProgress(goal)}%` }]}
                  />
                </View>
                <Text style={styles.progressPercent}>
                  {getProgress(goal).toFixed(1)}% complete
                </Text>
              </View>

              {goal.deadline && (
                <View style={styles.deadlineRow}>
                  <Ionicons name="calendar-outline" size={16} color={COLORS.gray} />
                  <Text style={styles.deadlineText}>
                    Target: {new Date(goal.deadline).toLocaleDateString()}
                  </Text>
                </View>
              )}
            </View>
          ))
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Goal</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Goal Name (e.g., Emergency Fund)"
              placeholderTextColor={COLORS.gray}
              value={newGoal.name}
              onChangeText={(text) => setNewGoal({ ...newGoal, name: text })}
            />

            <TextInput
              style={styles.modalInput}
              placeholder="Target Amount"
              placeholderTextColor={COLORS.gray}
              value={newGoal.targetAmount}
              onChangeText={(text) => setNewGoal({ ...newGoal, targetAmount: text })}
              keyboardType="decimal-pad"
            />

            <View style={styles.currencySelector}>
              {['USD', 'ETB', 'EUR'].map((currency) => (
                <TouchableOpacity
                  key={currency}
                  style={[
                    styles.currencyOption,
                    newGoal.currency === currency && styles.currencyOptionActive,
                  ]}
                  onPress={() => setNewGoal({ ...newGoal, currency })}
                >
                  <Text
                    style={[
                      styles.currencyText,
                      newGoal.currency === currency && styles.currencyTextActive,
                    ]}
                  >
                    {currency}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.createButton, createMutation.isPending && styles.buttonDisabled]}
              onPress={handleCreateGoal}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.createButtonText}>Create Goal</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
  },
  summaryCard: {
    backgroundColor: COLORS.primary,
    margin: 16,
    padding: 20,
    borderRadius: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
  },
  summaryValue: {
    color: COLORS.white,
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 4,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  overallProgress: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  overallProgressFill: {
    height: '100%',
    backgroundColor: COLORS.gold,
    borderRadius: 4,
  },
  progressText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 4,
  },
  loader: {
    marginTop: 40,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray,
    textAlign: 'center',
    marginTop: 8,
  },
  goalCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  goalIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.lightGray,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  goalInfo: {
    flex: 1,
  },
  goalName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  goalStatus: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  goalProgress: {
    marginBottom: 12,
  },
  progressLabels: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  progressCurrent: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  progressTarget: {
    fontSize: 14,
    color: COLORS.gray,
    marginLeft: 4,
  },
  progressBar: {
    height: 8,
    backgroundColor: COLORS.lightGray,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },
  progressPercent: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 4,
  },
  deadlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deadlineText: {
    fontSize: 12,
    color: COLORS.gray,
    marginLeft: 4,
  },
  bottomPadding: {
    height: 20,
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
    padding: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalInput: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 16,
  },
  currencySelector: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  currencyOption: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: COLORS.lightGray,
    marginHorizontal: 4,
    borderRadius: 8,
  },
  currencyOptionActive: {
    backgroundColor: COLORS.primary,
  },
  currencyText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  currencyTextActive: {
    color: COLORS.white,
  },
  createButton: {
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  createButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
});

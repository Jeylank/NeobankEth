import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { recipientService, Recipient } from '../services/recipientService';
import '../i18n';

const COLORS = {
  primary: '#006633',
  gold: '#FFD700',
  red: '#DC2626',
  white: '#FFFFFF',
  gray: '#6B7280',
  lightGray: '#F3F4F6',
  text: '#1F2937',
};

export default function RecipientsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const selectMode = route.params?.selectMode === true;

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecipient, setEditingRecipient] = useState<Recipient | null>(null);
  const [formName, setFormName] = useState('');
  const [formInstitution, setFormInstitution] = useState('');
  const [formAccountNumber, setFormAccountNumber] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const userId = user?.uid || 'demo_user';

  const loadRecipients = useCallback(async () => {
    setLoading(true);
    try {
      const data = await recipientService.getRecipients(userId);
      setRecipients(data);
    } catch (error) {
      console.error('Failed to load recipients:', error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadRecipients();
  }, [loadRecipients]);

  const filteredRecipients = recipients.filter((r) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.bank.toLowerCase().includes(q) ||
      r.accountNumber.includes(q)
    );
  });

  const maskAccountNumber = (num: string): string => {
    if (num.length <= 4) return num;
    return '••••' + num.slice(-4);
  };

  const openAddModal = () => {
    setEditingRecipient(null);
    setFormName('');
    setFormInstitution('');
    setFormAccountNumber('');
    setFormPhone('');
    setModalVisible(true);
  };

  const openEditModal = (recipient: Recipient) => {
    setEditingRecipient(recipient);
    setFormName(recipient.name);
    setFormInstitution(recipient.bank);
    setFormAccountNumber(recipient.accountNumber);
    setFormPhone(recipient.phone || '');
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formInstitution.trim() || !formAccountNumber.trim()) {
      Alert.alert(t('common.error'), t('recipient.fillRequired') || 'Please fill in all required fields');
      return;
    }

    setSaving(true);
    try {
      if (editingRecipient) {
        const updated = await recipientService.updateRecipient(userId, editingRecipient.id, {
          name: formName.trim(),
          bank: formInstitution.trim(),
          accountNumber: formAccountNumber.trim(),
          phone: formPhone.trim() || undefined,
        });
        setRecipients((prev) =>
          prev.map((r) => (r.id === updated.id ? updated : r))
        );
        Alert.alert(t('common.success'), t('recipient.recipientUpdated'));
      } else {
        const added = await recipientService.addRecipient(userId, {
          name: formName.trim(),
          bank: formInstitution.trim(),
          accountNumber: formAccountNumber.trim(),
          phone: formPhone.trim() || undefined,
        });
        setRecipients((prev) => [added, ...prev]);
        Alert.alert(t('common.success'), t('recipient.recipientAdded'));
      }
      setModalVisible(false);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || 'Failed to save recipient');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (recipient: Recipient) => {
    Alert.alert(
      t('recipient.deleteRecipient'),
      t('recipient.confirmDelete'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await recipientService.deleteRecipient(userId, recipient.id);
              setRecipients((prev) => prev.filter((r) => r.id !== recipient.id));
              Alert.alert(t('common.success'), t('recipient.recipientDeleted'));
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message || 'Failed to delete recipient');
            }
          },
        },
      ]
    );
  };

  const handleSelect = (recipient: Recipient) => {
    if (selectMode) {
      navigation.navigate('Remittance', { selectedRecipient: recipient });
    } else {
      openEditModal(recipient);
    }
  };

  const renderRecipient = ({ item }: { item: Recipient }) => (
    <TouchableOpacity style={styles.recipientCard} onPress={() => handleSelect(item)}>
      <View style={styles.recipientIcon}>
        <Ionicons name="person" size={24} color={COLORS.primary} />
      </View>
      <View style={styles.recipientInfo}>
        <Text style={styles.recipientName}>{item.name}</Text>
        <Text style={styles.recipientBank}>{item.bank}</Text>
        <Text style={styles.recipientAccount}>{maskAccountNumber(item.accountNumber)}</Text>
      </View>
      <View style={styles.recipientActions}>
        {selectMode ? (
          <Ionicons name="chevron-forward" size={20} color={COLORS.gray} />
        ) : (
          <>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => openEditModal(item)}
            >
              <Ionicons name="create-outline" size={20} color={COLORS.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => handleDelete(item)}
            >
              <Ionicons name="trash-outline" size={20} color={COLORS.red} />
            </TouchableOpacity>
          </>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {selectMode ? t('recipient.selectRecipient') : t('recipient.savedRecipients')}
        </Text>
        <TouchableOpacity onPress={openAddModal} style={styles.addButton}>
          <Ionicons name="add-circle" size={28} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color={COLORS.gray} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('recipient.searchRecipients')}
          placeholderTextColor={COLORS.gray}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color={COLORS.gray} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : filteredRecipients.length === 0 ? (
        <View style={styles.centerContent}>
          <Ionicons name="people-outline" size={60} color={COLORS.gray} />
          <Text style={styles.emptyText}>{t('recipient.noRecipients')}</Text>
          <TouchableOpacity style={styles.addFirstButton} onPress={openAddModal}>
            <Ionicons name="add" size={20} color={COLORS.white} />
            <Text style={styles.addFirstButtonText}>{t('recipient.addRecipient')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredRecipients}
          keyExtractor={(item) => item.id}
          renderItem={renderRecipient}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingRecipient ? t('recipient.editRecipient') : t('recipient.addRecipient')}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('recipient.recipientName')} *</Text>
              <TextInput
                style={styles.formInput}
                placeholder={t('recipient.recipientName')}
                placeholderTextColor={COLORS.gray}
                value={formName}
                onChangeText={setFormName}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('recipient.institution')} *</Text>
              <TextInput
                style={styles.formInput}
                placeholder={t('recipient.institution')}
                placeholderTextColor={COLORS.gray}
                value={formInstitution}
                onChangeText={setFormInstitution}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('recipient.accountNumber')} *</Text>
              <TextInput
                style={styles.formInput}
                placeholder={t('recipient.accountNumber')}
                placeholderTextColor={COLORS.gray}
                value={formAccountNumber}
                onChangeText={setFormAccountNumber}
                keyboardType="number-pad"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>{t('recipient.phone')}</Text>
              <TextInput
                style={styles.formInput}
                placeholder={t('recipient.phone')}
                placeholderTextColor={COLORS.gray}
                value={formPhone}
                onChangeText={setFormPhone}
                keyboardType="phone-pad"
              />
            </View>

            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.saveButtonText}>
                  {editingRecipient ? t('recipient.editRecipient') : t('recipient.addRecipient')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
    textAlign: 'center',
  },
  addButton: {
    padding: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    marginLeft: 8,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.gray,
    marginTop: 12,
    textAlign: 'center',
  },
  addFirstButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 16,
  },
  addFirstButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  recipientCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  recipientIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  recipientInfo: {
    flex: 1,
  },
  recipientName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  recipientBank: {
    fontSize: 13,
    color: COLORS.gray,
    marginTop: 2,
  },
  recipientAccount: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 1,
  },
  recipientActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    padding: 6,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
  },
  formInput: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 10,
    padding: 14,
    fontSize: 14,
    color: COLORS.text,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
});

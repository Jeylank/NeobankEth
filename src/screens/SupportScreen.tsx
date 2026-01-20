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
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { supportApi } from '../services/api';

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

const FAQ_ITEMS = [
  {
    question: 'How do I add money to my account?',
    answer: 'You can add money using Chapa, Telebirr, or bank transfer. Go to the Dashboard and tap "Add Funds" to see all available options.',
  },
  {
    question: 'How long do international transfers take?',
    answer: 'Most transfers are completed within 1-3 business days. The exact time depends on the destination country and payment method.',
  },
  {
    question: 'What are the transfer fees?',
    answer: 'Our fees are competitive and transparent. You can see the exact fee before confirming any transfer. Fees vary based on the destination and amount.',
  },
  {
    question: 'How do I verify my account?',
    answer: 'Go to Profile > KYC Verification and follow the steps to upload your ID document and take a selfie. Verification usually takes 24-48 hours.',
  },
  {
    question: 'Is my money safe?',
    answer: 'Yes! We use bank-level security and encryption to protect your account. Your funds are held in regulated financial institutions.',
  },
  {
    question: 'How do I reset my password?',
    answer: 'On the login screen, tap "Forgot Password" and enter your email. You\'ll receive a link to reset your password.',
  },
];

const CONTACT_OPTIONS = [
  { id: 'email', label: 'Email Support', icon: 'mail' as const, value: 'support@neobanker.com' },
  { id: 'phone', label: 'Phone Support', icon: 'call' as const, value: '+251 911 123 456' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' as const, value: '+251 911 123 456' },
];

export default function SupportScreen() {
  const [activeTab, setActiveTab] = useState<'faq' | 'contact'>('faq');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const submitMutation = useMutation({
    mutationFn: (data: { subject: string; message: string }) =>
      supportApi.submitTicket(data),
    onSuccess: () => {
      Alert.alert('Success', 'Your message has been sent. We\'ll get back to you within 24 hours.');
      setSubject('');
      setMessage('');
    },
    onError: (error: any) => {
      Alert.alert('Error', error.message || 'Failed to send message');
    },
  });

  const handleContact = async (type: string, value: string) => {
    let url = '';
    switch (type) {
      case 'email':
        url = `mailto:${value}`;
        break;
      case 'phone':
        url = `tel:${value.replace(/\s/g, '')}`;
        break;
      case 'whatsapp':
        url = `whatsapp://send?phone=${value.replace(/[^0-9+]/g, '')}`;
        break;
    }
    
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Error', 'Cannot open this link');
    }
  };

  const handleSubmitMessage = () => {
    if (!subject.trim() || !message.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    submitMutation.mutate({ subject, message });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Help & Support</Text>
          <Text style={styles.subtitle}>We're here to help you</Text>
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'faq' && styles.tabActive]}
            onPress={() => setActiveTab('faq')}
          >
            <Ionicons
              name="help-circle"
              size={20}
              color={activeTab === 'faq' ? COLORS.primary : COLORS.textSecondary}
            />
            <Text style={[styles.tabText, activeTab === 'faq' && styles.tabTextActive]}>
              FAQ
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'contact' && styles.tabActive]}
            onPress={() => setActiveTab('contact')}
          >
            <Ionicons
              name="chatbubbles"
              size={20}
              color={activeTab === 'contact' ? COLORS.primary : COLORS.textSecondary}
            />
            <Text style={[styles.tabText, activeTab === 'contact' && styles.tabTextActive]}>
              Contact Us
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'faq' ? (
          <View style={styles.faqSection}>
            {FAQ_ITEMS.map((faq, index) => (
              <TouchableOpacity
                key={index}
                style={styles.faqItem}
                onPress={() => setExpandedFaq(expandedFaq === index ? null : index)}
                activeOpacity={0.7}
              >
                <View style={styles.faqHeader}>
                  <Text style={styles.faqQuestion}>{faq.question}</Text>
                  <Ionicons
                    name={expandedFaq === index ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={COLORS.textSecondary}
                  />
                </View>
                {expandedFaq === index && (
                  <Text style={styles.faqAnswer}>{faq.answer}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.contactSection}>
            <Text style={styles.sectionTitle}>Quick Contact</Text>
            {CONTACT_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.id}
                style={styles.contactOption}
                onPress={() => handleContact(option.id, option.value)}
              >
                <View style={styles.contactIcon}>
                  <Ionicons name={option.icon} size={24} color={COLORS.primary} />
                </View>
                <View style={styles.contactDetails}>
                  <Text style={styles.contactLabel}>{option.label}</Text>
                  <Text style={styles.contactValue}>{option.value}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ))}

            <View style={styles.divider} />

            <Text style={styles.sectionTitle}>Send a Message</Text>
            <View style={styles.messageForm}>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Subject</Text>
                <TextInput
                  style={styles.input}
                  value={subject}
                  onChangeText={setSubject}
                  placeholder="What do you need help with?"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Message</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Describe your issue in detail..."
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                />
              </View>

              <TouchableOpacity
                style={[styles.submitButton, submitMutation.isPending && styles.submitButtonDisabled]}
                onPress={handleSubmitMessage}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <>
                    <Ionicons name="send" size={20} color={COLORS.white} />
                    <Text style={styles.submitButtonText}>Send Message</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.footer}>
          <View style={styles.footerHours}>
            <Ionicons name="time" size={20} color={COLORS.textSecondary} />
            <Text style={styles.footerText}>Support available 24/7</Text>
          </View>
          <Text style={styles.responseTime}>
            Average response time: under 2 hours
          </Text>
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
  tabs: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    padding: 8,
    margin: 20,
    borderRadius: 12,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  tabActive: {
    backgroundColor: COLORS.primary + '15',
  },
  tabText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  tabTextActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  faqSection: {
    paddingHorizontal: 20,
  },
  faqItem: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqQuestion: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    paddingRight: 12,
  },
  faqAnswer: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 12,
    lineHeight: 22,
  },
  contactSection: {
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  contactOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  contactIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactDetails: {
    flex: 1,
    marginLeft: 12,
  },
  contactLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  contactValue: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 24,
  },
  messageForm: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
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
  textArea: {
    minHeight: 120,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    alignItems: 'center',
    padding: 24,
  },
  footerHours: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  responseTime: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
});

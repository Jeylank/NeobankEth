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
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { kycStorage, firebaseAuth, KYCUploadProgress } from '../services/firebase';

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

const DOCUMENT_TYPES = [
  { id: 'national_id', name: 'National ID', icon: 'card' as const },
  { id: 'passport', name: 'Passport', icon: 'document' as const },
  { id: 'drivers_license', name: "Driver's License", icon: 'car' as const },
];

export default function KYCScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [documentType, setDocumentType] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [address, setAddress] = useState('');
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  const [selfieImage, setSelfieImage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<KYCUploadProgress>({});

  const currentUser = firebaseAuth.getCurrentUser();

  const { data: kycStatus, isLoading } = useQuery({
    queryKey: ['kyc-status', currentUser?.uid],
    queryFn: async () => {
      if (!currentUser?.uid) return null;
      return kycStorage.getKYCStatus(currentUser.uid);
    },
    enabled: !!currentUser?.uid,
  });

  const submitMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!currentUser?.uid) throw new Error('Please sign in to submit KYC');
      return kycStorage.submitKYCDocuments(
        currentUser.uid,
        data,
        (progress) => setUploadProgress(progress)
      );
    },
    onSuccess: () => {
      Alert.alert(
        t('kyc.successTitle') || 'Success',
        t('kyc.successMessage') || 'KYC verification submitted! We will review your documents within 24-48 hours.'
      );
      queryClient.invalidateQueries({ queryKey: ['kyc-status'] });
    },
    onError: (error: any) => {
      Alert.alert(t('common.error') || 'Error', error.message || 'Failed to submit KYC');
    },
  });

  const pickImage = async (type: 'front' | 'back' | 'selfie') => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant camera roll permissions to upload documents');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: type === 'selfie' ? [1, 1] : [16, 10],
      quality: 0.8,
    });

    if (!result.canceled) {
      switch (type) {
        case 'front':
          setFrontImage(result.assets[0].uri);
          break;
        case 'back':
          setBackImage(result.assets[0].uri);
          break;
        case 'selfie':
          setSelfieImage(result.assets[0].uri);
          break;
      }
    }
  };

  const takePhoto = async (type: 'front' | 'back' | 'selfie') => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant camera permissions');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: type === 'selfie' ? [1, 1] : [16, 10],
      quality: 0.8,
    });

    if (!result.canceled) {
      switch (type) {
        case 'front':
          setFrontImage(result.assets[0].uri);
          break;
        case 'back':
          setBackImage(result.assets[0].uri);
          break;
        case 'selfie':
          setSelfieImage(result.assets[0].uri);
          break;
      }
    }
  };

  const handleNext = () => {
    if (step === 1) {
      if (!documentType) {
        Alert.alert('Error', 'Please select a document type');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!fullName || !dateOfBirth || !documentNumber) {
        Alert.alert('Error', 'Please fill in all required fields');
        return;
      }
      setStep(3);
    } else if (step === 3) {
      if (!frontImage) {
        Alert.alert('Error', 'Please upload the front of your document');
        return;
      }
      setStep(4);
    }
  };

  const handleSubmit = () => {
    if (!selfieImage) {
      Alert.alert('Error', 'Please take a selfie for verification');
      return;
    }
    submitMutation.mutate({
      documentType,
      documentNumber,
      fullName,
      dateOfBirth,
      address,
      frontImage,
      backImage,
      selfieImage,
    });
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

  if (kycStatus?.status === 'verified') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.verifiedContainer}>
          <View style={styles.verifiedIcon}>
            <Ionicons name="checkmark-circle" size={80} color={COLORS.success} />
          </View>
          <Text style={styles.verifiedTitle}>Verified</Text>
          <Text style={styles.verifiedText}>
            Your identity has been verified. You have full access to all features.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (kycStatus?.status === 'pending') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.verifiedContainer}>
          <View style={styles.pendingIcon}>
            <Ionicons name="time" size={80} color={COLORS.warning} />
          </View>
          <Text style={styles.verifiedTitle}>Under Review</Text>
          <Text style={styles.verifiedText}>
            Your documents are being reviewed. This usually takes 24-48 hours.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Identity Verification</Text>
          <Text style={styles.subtitle}>Complete KYC to unlock all features</Text>
        </View>

        <View style={styles.progressContainer}>
          {[1, 2, 3, 4].map((s) => (
            <View key={s} style={styles.progressStep}>
              <View style={[styles.progressDot, step >= s && styles.progressDotActive]}>
                {step > s ? (
                  <Ionicons name="checkmark" size={14} color={COLORS.white} />
                ) : (
                  <Text style={[styles.progressNumber, step >= s && styles.progressNumberActive]}>
                    {s}
                  </Text>
                )}
              </View>
              {s < 4 && <View style={[styles.progressLine, step > s && styles.progressLineActive]} />}
            </View>
          ))}
        </View>

        <View style={styles.content}>
          {step === 1 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Select Document Type</Text>
              <Text style={styles.stepDescription}>
                Choose the type of ID document you'll use for verification
              </Text>
              {DOCUMENT_TYPES.map((doc) => (
                <TouchableOpacity
                  key={doc.id}
                  style={[
                    styles.documentOption,
                    documentType === doc.id && styles.documentOptionSelected,
                  ]}
                  onPress={() => setDocumentType(doc.id)}
                >
                  <Ionicons
                    name={doc.icon}
                    size={24}
                    color={documentType === doc.id ? COLORS.primary : COLORS.textSecondary}
                  />
                  <Text
                    style={[
                      styles.documentOptionText,
                      documentType === doc.id && styles.documentOptionTextSelected,
                    ]}
                  >
                    {doc.name}
                  </Text>
                  {documentType === doc.id && (
                    <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {step === 2 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Personal Information</Text>
              <Text style={styles.stepDescription}>
                Enter your details exactly as they appear on your document
              </Text>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Full Name *</Text>
                <TextInput
                  style={styles.input}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="As shown on document"
                />
              </View>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Date of Birth *</Text>
                <TextInput
                  style={styles.input}
                  value={dateOfBirth}
                  onChangeText={setDateOfBirth}
                  placeholder="DD/MM/YYYY"
                />
              </View>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Document Number *</Text>
                <TextInput
                  style={styles.input}
                  value={documentNumber}
                  onChangeText={setDocumentNumber}
                  placeholder="Enter document number"
                />
              </View>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Address (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={address}
                  onChangeText={setAddress}
                  placeholder="Your current address"
                  multiline
                  numberOfLines={3}
                />
              </View>
            </View>
          )}

          {step === 3 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Upload Document</Text>
              <Text style={styles.stepDescription}>
                Take clear photos of your {DOCUMENT_TYPES.find(d => d.id === documentType)?.name}
              </Text>
              
              <View style={styles.uploadSection}>
                <Text style={styles.uploadLabel}>Front of Document *</Text>
                {frontImage ? (
                  <View style={styles.imagePreview}>
                    <Image source={{ uri: frontImage }} style={styles.previewImage} />
                    <TouchableOpacity
                      style={styles.removeImage}
                      onPress={() => setFrontImage(null)}
                    >
                      <Ionicons name="close-circle" size={24} color={COLORS.error} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.uploadButtons}>
                    <TouchableOpacity
                      style={styles.uploadButton}
                      onPress={() => takePhoto('front')}
                    >
                      <Ionicons name="camera" size={24} color={COLORS.primary} />
                      <Text style={styles.uploadButtonText}>Take Photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.uploadButton}
                      onPress={() => pickImage('front')}
                    >
                      <Ionicons name="image" size={24} color={COLORS.primary} />
                      <Text style={styles.uploadButtonText}>Choose File</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View style={styles.uploadSection}>
                <Text style={styles.uploadLabel}>Back of Document (Optional)</Text>
                {backImage ? (
                  <View style={styles.imagePreview}>
                    <Image source={{ uri: backImage }} style={styles.previewImage} />
                    <TouchableOpacity
                      style={styles.removeImage}
                      onPress={() => setBackImage(null)}
                    >
                      <Ionicons name="close-circle" size={24} color={COLORS.error} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.uploadButtons}>
                    <TouchableOpacity
                      style={styles.uploadButton}
                      onPress={() => takePhoto('back')}
                    >
                      <Ionicons name="camera" size={24} color={COLORS.primary} />
                      <Text style={styles.uploadButtonText}>Take Photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.uploadButton}
                      onPress={() => pickImage('back')}
                    >
                      <Ionicons name="image" size={24} color={COLORS.primary} />
                      <Text style={styles.uploadButtonText}>Choose File</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          )}

          {step === 4 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Take a Selfie</Text>
              <Text style={styles.stepDescription}>
                We need a photo of you to verify your identity
              </Text>
              
              <View style={styles.selfieSection}>
                {selfieImage ? (
                  <View style={styles.selfiePreview}>
                    <Image source={{ uri: selfieImage }} style={styles.selfieImage} />
                    <TouchableOpacity
                      style={styles.removeSelfie}
                      onPress={() => setSelfieImage(null)}
                    >
                      <Ionicons name="close-circle" size={28} color={COLORS.error} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.selfieButton}
                    onPress={() => takePhoto('selfie')}
                  >
                    <View style={styles.selfieIconContainer}>
                      <Ionicons name="person" size={48} color={COLORS.textSecondary} />
                    </View>
                    <Text style={styles.selfieButtonText}>Take Selfie</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.tips}>
                <Text style={styles.tipsTitle}>Tips for a good selfie:</Text>
                <Text style={styles.tipText}>• Good lighting, face clearly visible</Text>
                <Text style={styles.tipText}>• No sunglasses or hats</Text>
                <Text style={styles.tipText}>• Look directly at the camera</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.actions}>
          {step > 1 && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setStep(step - 1)}
            >
              <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          )}
          
          {step < 4 ? (
            <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
              <Text style={styles.nextButtonText}>{t('common.continue')}</Text>
              <Ionicons name="arrow-forward" size={20} color={COLORS.white} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.submitButton, submitMutation.isPending && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending ? (
                <View style={styles.uploadingContainer}>
                  <ActivityIndicator color={COLORS.white} />
                  <Text style={styles.uploadingText}>
                    {t('kyc.uploading') || 'Uploading documents...'}
                  </Text>
                  {(uploadProgress.front || uploadProgress.selfie) && (
                    <View style={styles.uploadProgressWrapper}>
                      <View style={styles.uploadProgressBar}>
                        <View 
                          style={[
                            styles.uploadProgressFill, 
                            { width: `${Math.round((
                              (uploadProgress.front || 0) + 
                              (uploadProgress.back || 0) + 
                              (uploadProgress.selfie || 0)
                            ) / (backImage ? 3 : 2))}%` }
                          ]} 
                        />
                      </View>
                    </View>
                  )}
                </View>
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
                  <Text style={styles.submitButtonText}>{t('kyc.submit') || 'Submit for Verification'}</Text>
                </>
              )}
            </TouchableOpacity>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: COLORS.white,
  },
  progressStep: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDotActive: {
    backgroundColor: COLORS.primary,
  },
  progressNumber: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  progressNumberActive: {
    color: COLORS.white,
  },
  progressLine: {
    width: 40,
    height: 2,
    backgroundColor: COLORS.border,
  },
  progressLineActive: {
    backgroundColor: COLORS.primary,
  },
  content: {
    padding: 20,
  },
  stepContent: {},
  stepTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 24,
  },
  documentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    gap: 12,
  },
  documentOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  documentOptionText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
  },
  documentOptionTextSelected: {
    fontWeight: '600',
    color: COLORS.primary,
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
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  uploadSection: {
    marginBottom: 24,
  },
  uploadLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  uploadButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  uploadButton: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
  },
  uploadButtonText: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  imagePreview: {
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    resizeMode: 'cover',
  },
  removeImage: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  selfieSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  selfieButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
  },
  selfieIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfieButtonText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '600',
  },
  selfiePreview: {
    position: 'relative',
  },
  selfieImage: {
    width: 200,
    height: 200,
    borderRadius: 100,
    resizeMode: 'cover',
  },
  removeSelfie: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  tips: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  tipText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  uploadingContainer: {
    alignItems: 'center',
    width: '100%',
  },
  uploadingText: {
    color: COLORS.white,
    fontSize: 14,
    marginTop: 8,
  },
  uploadProgressWrapper: {
    width: '100%',
    marginTop: 8,
  },
  uploadProgressBar: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  uploadProgressFill: {
    height: '100%',
    backgroundColor: COLORS.white,
    borderRadius: 2,
  },
  actions: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.primary,
    gap: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '600',
  },
  nextButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  nextButtonText: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: '600',
  },
  submitButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: '600',
  },
  verifiedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  verifiedIcon: {
    marginBottom: 24,
  },
  pendingIcon: {
    marginBottom: 24,
  },
  verifiedTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 12,
  },
  verifiedText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});

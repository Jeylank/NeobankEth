import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  ConfirmationResult,
  PhoneAuthProvider,
  signInWithCredential,
  linkWithCredential,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  getDocs,
  getDoc,
  setDoc
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  uploadBytesResumable
} from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.warn('Firebase configuration missing. Please set EXPO_PUBLIC_FIREBASE_* environment variables.');
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

let confirmationResult: ConfirmationResult | null = null;
let recaptchaVerifier: RecaptchaVerifier | null = null;

export const phoneUtils = {
  formatEthiopianNumber: (phoneNumber: string): string => {
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    if (cleaned.startsWith('251')) {
      return '+' + cleaned;
    }
    
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    
    if (cleaned.length === 9 && (cleaned.startsWith('9') || cleaned.startsWith('7'))) {
      return '+251' + cleaned;
    }
    
    return '+251' + cleaned;
  },
  
  validateEthiopianNumber: (phoneNumber: string): { valid: boolean; error?: string } => {
    const formatted = phoneUtils.formatEthiopianNumber(phoneNumber);
    const regex = /^\+251[79]\d{8}$/;
    
    if (!regex.test(formatted)) {
      return { 
        valid: false, 
        error: 'Please enter a valid Ethiopian phone number (9 digits starting with 9 or 7)' 
      };
    }
    
    return { valid: true };
  },
  
  getDisplayFormat: (phoneNumber: string): string => {
    const formatted = phoneUtils.formatEthiopianNumber(phoneNumber);
    if (formatted.length === 13) {
      return `${formatted.slice(0, 4)} ${formatted.slice(4, 6)} ${formatted.slice(6, 9)} ${formatted.slice(9)}`;
    }
    return formatted;
  }
};

export const firebaseAuth = {
  signIn: (email: string, password: string) => 
    signInWithEmailAndPassword(auth, email, password),
  
  signUp: (email: string, password: string) => 
    createUserWithEmailAndPassword(auth, email, password),
  
  signOut: () => signOut(auth),
  
  onAuthChange: (callback: (user: FirebaseUser | null) => void) => 
    onAuthStateChanged(auth, callback),
  
  getCurrentUser: () => auth.currentUser,
  
  getIdToken: async () => {
    const user = auth.currentUser;
    if (user) {
      // forceRefresh: true — always fetches a fresh token from Firebase servers,
      // bypassing any locally cached token that may be stale or corrupted.
      return await user.getIdToken(/* forceRefresh */ true);
    }
    return null;
  },

  initRecaptcha: (containerId: string) => {
    if (typeof window !== 'undefined') {
      try {
        recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
          size: 'invisible',
          callback: () => {},
          'expired-callback': () => {
            console.log('reCAPTCHA expired');
          }
        });
        return recaptchaVerifier;
      } catch (error) {
        console.error('reCAPTCHA init error:', error);
        return null;
      }
    }
    return null;
  },

  sendPhoneVerification: async (phoneNumber: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const formatted = phoneUtils.formatEthiopianNumber(phoneNumber);
      const validation = phoneUtils.validateEthiopianNumber(phoneNumber);
      
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      if (!recaptchaVerifier) {
        recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible',
        });
      }

      confirmationResult = await signInWithPhoneNumber(auth, formatted, recaptchaVerifier);
      return { success: true };
    } catch (error: any) {
      console.error('Phone verification error:', error);
      
      if (error.code === 'auth/invalid-phone-number') {
        return { success: false, error: 'Invalid phone number format' };
      }
      if (error.code === 'auth/too-many-requests') {
        return { success: false, error: 'Too many requests. Please try again later.' };
      }
      if (error.code === 'auth/quota-exceeded') {
        return { success: false, error: 'SMS quota exceeded. Please try again later or use email login.' };
      }
      
      return { 
        success: false, 
        error: 'Failed to send verification code. Please try email login or contact support.' 
      };
    }
  },

  verifyPhoneCode: async (code: string): Promise<{ success: boolean; user?: FirebaseUser; error?: string }> => {
    try {
      if (!confirmationResult) {
        return { success: false, error: 'No verification in progress. Please request a new code.' };
      }

      const result = await confirmationResult.confirm(code);
      confirmationResult = null;
      return { success: true, user: result.user };
    } catch (error: any) {
      console.error('Code verification error:', error);
      
      if (error.code === 'auth/invalid-verification-code') {
        return { success: false, error: 'Invalid verification code. Please check and try again.' };
      }
      if (error.code === 'auth/code-expired') {
        return { success: false, error: 'Verification code expired. Please request a new one.' };
      }
      
      return { success: false, error: 'Verification failed. Please try again.' };
    }
  },

  resendPhoneCode: async (phoneNumber: string): Promise<{ success: boolean; error?: string }> => {
    recaptchaVerifier = null;
    return firebaseAuth.sendPhoneVerification(phoneNumber);
  },
};

interface KYCUploadProgress {
  front?: number;
  back?: number;
  selfie?: number;
}

interface KYCDocumentData {
  documentType: string;
  documentNumber: string;
  fullName: string;
  dateOfBirth: string;
  address?: string;
  frontImageUrl: string;
  backImageUrl?: string;
  selfieImageUrl: string;
  status: 'pending' | 'verified' | 'rejected';
  submittedAt: any;
  userId: string;
}

const uriToBlob = async (uri: string): Promise<Blob> => {
  const response = await fetch(uri);
  const blob = await response.blob();
  return blob;
};

export const kycStorage = {
  uploadDocument: async (
    userId: string,
    imageUri: string,
    documentType: 'front' | 'back' | 'selfie',
    onProgress?: (progress: number) => void
  ): Promise<string> => {
    const timestamp = Date.now();
    const fileName = `kyc/${userId}/${documentType}_${timestamp}.jpg`;
    const storageRef = ref(storage, fileName);
    
    const blob = await uriToBlob(imageUri);
    
    return new Promise((resolve, reject) => {
      const uploadTask = uploadBytesResumable(storageRef, blob);
      
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          if (onProgress) {
            onProgress(progress);
          }
        },
        (error) => {
          console.error('Upload error:', error);
          reject(error);
        },
        async () => {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(downloadUrl);
        }
      );
    });
  },

  submitKYCDocuments: async (
    userId: string,
    data: {
      documentType: string;
      documentNumber: string;
      fullName: string;
      dateOfBirth: string;
      address?: string;
      frontImage: string;
      backImage?: string;
      selfieImage: string;
    },
    onProgress?: (progress: KYCUploadProgress) => void
  ): Promise<string> => {
    const progress: KYCUploadProgress = {};
    
    const frontImageUrl = await kycStorage.uploadDocument(
      userId,
      data.frontImage,
      'front',
      (p) => {
        progress.front = p;
        onProgress?.(progress);
      }
    );

    let backImageUrl: string | undefined;
    if (data.backImage) {
      backImageUrl = await kycStorage.uploadDocument(
        userId,
        data.backImage,
        'back',
        (p) => {
          progress.back = p;
          onProgress?.(progress);
        }
      );
    }

    const selfieImageUrl = await kycStorage.uploadDocument(
      userId,
      data.selfieImage,
      'selfie',
      (p) => {
        progress.selfie = p;
        onProgress?.(progress);
      }
    );

    const kycDocument: KYCDocumentData = {
      documentType: data.documentType,
      documentNumber: data.documentNumber,
      fullName: data.fullName,
      dateOfBirth: data.dateOfBirth,
      address: data.address,
      frontImageUrl,
      backImageUrl,
      selfieImageUrl,
      status: 'pending',
      submittedAt: serverTimestamp(),
      userId,
    };

    const kycRef = doc(db, 'kyc_documents', userId);
    await setDoc(kycRef, kycDocument);

    return userId;
  },

  getKYCStatus: async (userId: string): Promise<KYCDocumentData | null> => {
    const kycRef = doc(db, 'kyc_documents', userId);
    const kycDoc = await getDoc(kycRef);
    
    if (kycDoc.exists()) {
      return kycDoc.data() as KYCDocumentData;
    }
    return null;
  },
};

export { auth, db, storage };
export { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp, 
  Timestamp,
  getDocs,
  getDoc,
  setDoc,
  ref,
  uploadBytes,
  getDownloadURL
};
export type { FirebaseUser, KYCDocumentData, KYCUploadProgress };

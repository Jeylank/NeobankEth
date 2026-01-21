import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
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
      return await user.getIdToken();
    }
    return null;
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

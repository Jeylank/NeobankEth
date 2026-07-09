import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { AppState } from 'react-native';
import { secureStorage } from '../utils/storage';
import { firebaseAuth, FirebaseUser } from '../services/firebase';
import { SessionManager } from '../utils/security';
import { authApi } from '../services/api';
import { twoFactorService } from '../services/twoFactorService';
import { adminService } from '../services/adminService';

interface AuthContextType {
  user: FirebaseUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  pending2FA: boolean;
  pending2FACode: string;
  pending2FAEmail: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signInWithPhone: (user: FirebaseUser) => Promise<void>;
  verify2FACode: (code: string) => Promise<{ success: boolean; error?: string }>;
  completeTwoFactorLogin: () => Promise<void>;
  cancelTwoFactorLogin: () => Promise<void>;
  resend2FACode: () => Promise<string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,          setUser]          = useState<FirebaseUser | null>(null);
  const [isLoading,     setIsLoading]     = useState(true);
  const [isAdmin,       setIsAdmin]       = useState(false);
  const [pending2FA,     setPending2FA]     = useState(false);
  const [pending2FACode,  setPending2FACode]  = useState('');
  const [pending2FAEmail, setPending2FAEmail] = useState('');
  const pendingFirebaseUser = useRef<FirebaseUser | null>(null);
  const skip2FACheck        = useRef(false);

  const appState = useRef(AppState.currentState);

  const fetchAdminRole = async () => {
    try {
      const profile = await authApi.getProfile();
      setIsAdmin(profile.role === 'admin');
    } catch {
      setIsAdmin(false);
    }
  };

  useEffect(() => {
    const unsubscribe = firebaseAuth.onAuthChange(async (firebaseUser) => {
      if (firebaseUser) {
        if (skip2FACheck.current) {
          skip2FACheck.current = false;
          setUser(firebaseUser);
          const token = await firebaseUser.getIdToken();
          await secureStorage.setItemAsync('authToken', token);
          await SessionManager.recordActivity();
          await fetchAdminRole();
          setIsLoading(false);
          return;
        }

        const twoFAEnabled = await twoFactorService.isEnabled(firebaseUser.uid);

        if (twoFAEnabled) {
          pendingFirebaseUser.current = firebaseUser;
          const code = await twoFactorService.generateAndStoreOTP(firebaseUser.uid);
          setPending2FACode(code);
          setPending2FAEmail(firebaseUser.email ?? '');
          setPending2FA(true);
          setIsLoading(false);
        } else {
          setUser(firebaseUser);
          const token = await firebaseUser.getIdToken();
          await secureStorage.setItemAsync('authToken', token);
          await SessionManager.recordActivity();
          await fetchAdminRole();
          setIsLoading(false);
        }
      } else {
        setUser(null);
        setPending2FA(false);
        setPending2FACode('');
        setPending2FAEmail('');
        pendingFirebaseUser.current = null;
        await secureStorage.deleteItemAsync('authToken');
        await SessionManager.clearSession();
        setIsAdmin(false);
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active' && user) {
        const expired = await SessionManager.isSessionExpired();
        if (expired) {
          await firebaseAuth.signOut();
          await secureStorage.deleteItemAsync('authToken');
          await SessionManager.clearSession();
        } else {
          await SessionManager.recordActivity();
        }
      }
      appState.current = nextAppState;
    });

    return () => subscription.remove();
  }, [user]);

  const signIn = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      await firebaseAuth.signIn(email, password);
      await SessionManager.recordActivity();
      void adminService.logLogin('email');
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      await firebaseAuth.signUp(email, password);
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    setIsLoading(true);
    try {
      await firebaseAuth.signOut();
      await secureStorage.deleteItemAsync('authToken');
      setIsAdmin(false);
      setPending2FA(false);
      setPending2FACode('');
      pendingFirebaseUser.current = null;
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithPhone = async (firebaseUser: FirebaseUser) => {
    setIsLoading(true);
    try {
      setUser(firebaseUser);
      const token = await firebaseUser.getIdToken();
      await secureStorage.setItemAsync('authToken', token);
      await fetchAdminRole();
      void adminService.logLogin('phone');
    } finally {
      setIsLoading(false);
    }
  };

  const completeTwoFactorLogin = async () => {
    const fbUser = pendingFirebaseUser.current;
    if (!fbUser) return;
    skip2FACheck.current = true;
    setUser(fbUser);
    const token = await fbUser.getIdToken();
    await secureStorage.setItemAsync('authToken', token);
    await SessionManager.recordActivity();
    await fetchAdminRole();
    void adminService.logLogin('email');
    setPending2FA(false);
    setPending2FACode('');
    setPending2FAEmail('');
    pendingFirebaseUser.current = null;
  };

  const verify2FACode = async (code: string): Promise<{ success: boolean; error?: string }> => {
    const fbUser = pendingFirebaseUser.current;
    if (!fbUser) return { success: false, error: 'No pending login session.' };
    const result = await twoFactorService.verifyOTP(fbUser.uid, code);
    if (result.success) {
      await completeTwoFactorLogin();
    }
    return result;
  };

  const cancelTwoFactorLogin = async () => {
    await firebaseAuth.signOut();
    setPending2FA(false);
    setPending2FACode('');
    setPending2FAEmail('');
    pendingFirebaseUser.current = null;
  };

  const resend2FACode = async (): Promise<string> => {
    const fbUser = pendingFirebaseUser.current;
    if (!fbUser) return '';
    const code = await twoFactorService.generateAndStoreOTP(fbUser.uid);
    setPending2FACode(code);
    return code;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        isAdmin,
        pending2FA,
        pending2FACode,
        pending2FAEmail,
        signIn,
        signUp,
        signOut,
        signInWithPhone,
        verify2FACode,
        completeTwoFactorLogin,
        cancelTwoFactorLogin,
        resend2FACode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

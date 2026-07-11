import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { AppState } from 'react-native';
import { secureStorage } from '../utils/storage';
import { firebaseAuth, FirebaseUser } from '../services/firebase';
import { SessionManager } from '../utils/security';
import { authApi } from '../services/api';
import { twoFactorService } from '../services/twoFactorService';
import { applyAdminRoleResult, resolveAdminRole } from './adminRole';

interface AuthContextType {
  user: FirebaseUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isAdminLoading: boolean;
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
  const [isAdminLoading, setIsAdminLoading] = useState(false);
  const [pending2FA,     setPending2FA]     = useState(false);
  const [pending2FACode,  setPending2FACode]  = useState('');
  const [pending2FAEmail, setPending2FAEmail] = useState('');
  const pendingFirebaseUser = useRef<FirebaseUser | null>(null);
  const skip2FACheck        = useRef(false);
  const completedAuthUid = useRef<string | null>(null);
  const adminRoleRequest = useRef(0);
  const authStateWaiter = useRef<{
    uid: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);

  const appState = useRef(AppState.currentState);

  const resolveAuthStateWaiter = (uid: string) => {
    completedAuthUid.current = uid;
    const waiter = authStateWaiter.current;
    if (!waiter || waiter.uid !== uid) return;
    clearTimeout(waiter.timeout);
    authStateWaiter.current = null;
    waiter.resolve();
  };

  const rejectAuthStateWaiter = (message: string) => {
    const waiter = authStateWaiter.current;
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    authStateWaiter.current = null;
    waiter.reject(new Error(message));
  };

  const waitForAuthSession = (uid: string): Promise<void> => {
    if (completedAuthUid.current === uid) return Promise.resolve();
    authStateWaiter.current?.reject(new Error('A newer sign-in attempt was started.'));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (authStateWaiter.current?.uid === uid) {
          authStateWaiter.current = null;
          reject(new Error('Sign in took too long. Please try again.'));
        }
      }, 10_000);
      authStateWaiter.current = { uid, resolve, reject, timeout };
    });
  };

  const fetchAdminRole = async (firebaseUser: FirebaseUser) => {
    const request = ++adminRoleRequest.current;
    setIsAdminLoading(true);
    try {
      const resolved = await resolveAdminRole(firebaseUser, {
        storeToken: (token) => secureStorage.setItemAsync('authToken', token),
        getProfile: authApi.getProfile,
      });
      if (request === adminRoleRequest.current) {
        setIsAdmin((current) => applyAdminRoleResult(current, resolved));
      }
    } finally {
      if (request === adminRoleRequest.current) setIsAdminLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = firebaseAuth.onAuthChange(async (firebaseUser) => {
      if (firebaseUser) {
        if (skip2FACheck.current) {
          skip2FACheck.current = false;
          setUser(firebaseUser);
          await SessionManager.recordActivity();
          await fetchAdminRole(firebaseUser);
          resolveAuthStateWaiter(firebaseUser.uid);
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
          resolveAuthStateWaiter(firebaseUser.uid);
          setIsLoading(false);
        } else {
          setUser(firebaseUser);
          await SessionManager.recordActivity();
          await fetchAdminRole(firebaseUser);
          resolveAuthStateWaiter(firebaseUser.uid);
          setIsLoading(false);
        }
      } else {
        adminRoleRequest.current += 1;
        completedAuthUid.current = null;
        rejectAuthStateWaiter('Sign in was not completed. Please try again.');
        setUser(null);
        setPending2FA(false);
        setPending2FACode('');
        setPending2FAEmail('');
        pendingFirebaseUser.current = null;
        await secureStorage.deleteItemAsync('authToken');
        await SessionManager.clearSession();
        setIsAdmin(false);
        setIsAdminLoading(false);
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
      const credential = await firebaseAuth.signIn(email, password);
      await waitForAuthSession(credential.user.uid);
    } catch (error) {
      setIsLoading(false);
      throw error;
    }
  };

  const signUp = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const credential = await firebaseAuth.signUp(email, password);
      await waitForAuthSession(credential.user.uid);
    } catch (error) {
      setIsLoading(false);
      throw error;
    }
  };

  const signOut = async () => {
    setIsLoading(true);
    adminRoleRequest.current += 1;
    setIsAdmin(false);
    setIsAdminLoading(false);
    try {
      await firebaseAuth.signOut();
      await secureStorage.deleteItemAsync('authToken');
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
      await fetchAdminRole(firebaseUser);
    } finally {
      setIsLoading(false);
    }
  };

  const completeTwoFactorLogin = async () => {
    const fbUser = pendingFirebaseUser.current;
    if (!fbUser) return;
    setIsLoading(true);
    try {
      skip2FACheck.current = true;
      setUser(fbUser);
      await SessionManager.recordActivity();
      await fetchAdminRole(fbUser);
      setPending2FA(false);
      setPending2FACode('');
      setPending2FAEmail('');
      pendingFirebaseUser.current = null;
    } finally {
      setIsLoading(false);
    }
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
        isAdminLoading,
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

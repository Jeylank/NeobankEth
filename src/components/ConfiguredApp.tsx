import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { ThemeProvider, useTheme } from '../theme';
import RootNavigator from '../navigation/RootNavigator';
import {
  getAndRegisterPushToken,
  setupNotificationTapHandler,
  handleForegroundNotification,
} from '../services/pushNotifications';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 2,
    },
  },
});

function PushNotificationBootstrap() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.uid || Platform.OS === 'web') return;

    let cleanupTap: (() => void) | null = null;
    let cleanupFg: (() => void) | null = null;

    void (async () => {
      await getAndRegisterPushToken(user.uid);
      cleanupTap = await setupNotificationTapHandler();
      cleanupFg = await handleForegroundNotification((title, body) => {
        console.log('[Push] Foreground notification:', title, body);
      });
    })();

    return () => {
      cleanupTap?.();
      cleanupFg?.();
    };
  }, [user?.uid]);

  return null;
}

const linking = {
  prefixes: [],
  config: {
    screens: {
      AdminDashboard: 'admin',
      AdminAgentPayouts: 'admin/agents',
      AdminReconciliationOverview: 'admin/reconciliation',
      AdminRiskControls: 'admin/beta-controls',
      AdminTransfers: 'admin/transfers',
      AdminUsers: 'admin/users',
    },
  },
};

function AppContent() {
  const { isDark, colors } = useTheme();

  return (
    <NavigationContainer
      linking={linking}
      theme={{
        dark: isDark,
        colors: {
          primary: colors.primary,
          background: colors.background,
          card: colors.surface,
          text: colors.text,
          border: colors.border,
          notification: colors.error,
        },
      }}
    >
      <RootNavigator />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </NavigationContainer>
  );
}

export default function ConfiguredApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <PushNotificationBootstrap />
          <AppContent />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

import './global.css';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from './src/hooks/useAuth';
import { ThemeProvider, useTheme } from './src/theme';
import RootNavigator from './src/navigation/RootNavigator';
import {
  getAndRegisterPushToken,
  setupNotificationTapHandler,
  handleForegroundNotification,
  setNotificationNavigationHandler,
} from './src/services/pushNotifications';

if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync();
}

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

    (async () => {
      await getAndRegisterPushToken(user.uid);

      cleanupTap = await setupNotificationTapHandler();

      cleanupFg = await handleForegroundNotification((title, body, _data) => {
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

function AppContent() {
  const { isDark, colors } = useTheme();

  return (
    <NavigationContainer
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

export default function App() {
  const [fontsLoaded] = useFonts({
    'NotoSansEthiopic_400Regular': require('./assets/fonts/NotoSansEthiopic-Regular.ttf'),
    'NotoSansEthiopic_500Medium': require('./assets/fonts/NotoSansEthiopic-Medium.ttf'),
    'NotoSansEthiopic_600SemiBold': require('./assets/fonts/NotoSansEthiopic-SemiBold.ttf'),
    'NotoSansEthiopic_700Bold': require('./assets/fonts/NotoSansEthiopic-Bold.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded && Platform.OS !== 'web') {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#006633" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <PushNotificationBootstrap />
            <AppContent />
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
});

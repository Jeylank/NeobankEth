import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import {
  isFirebaseConfigured,
  invalidFirebaseConfig,
} from './src/config/firebaseConfig';

if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync();
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

  if (!isFirebaseConfigured) {
    return (
      <SafeAreaProvider>
        <View style={styles.setupContainer}>
          <Text style={styles.setupTitle}>App setup required</Text>
          <Text style={styles.setupText}>
            This build is missing its Firebase connection settings. Ask the build
            administrator to configure the preview environment and rebuild the app.
          </Text>
          <Text style={styles.setupDetails}>
            Missing or invalid: {invalidFirebaseConfig.join(', ')}
          </Text>
          <StatusBar style="dark" />
        </View>
      </SafeAreaProvider>
    );
  }

  // Firebase-dependent modules are loaded only after configuration validation.
  const ConfiguredApp =
    require('./src/components/ConfiguredApp').default as React.ComponentType;

  return (
    <SafeAreaProvider>
      <ConfiguredApp />
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
  setupContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#F9FAFB',
  },
  setupTitle: {
    marginBottom: 12,
    color: '#7F1D1D',
    fontSize: 24,
    fontWeight: '700',
  },
  setupText: {
    color: '#374151',
    fontSize: 16,
    lineHeight: 24,
  },
  setupDetails: {
    marginTop: 16,
    color: '#6B7280',
    fontSize: 13,
  },
});

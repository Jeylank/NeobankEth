import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const BIOMETRIC_ENABLED_KEY = 'biometricEnabled';
const BIOMETRIC_CREDENTIALS_KEY = 'biometricCredentials';

export interface BiometricCredentials {
  email: string;
  password: string;
}

export const biometricService = {
  isAvailable: async (): Promise<boolean> => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return false;
    
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return enrolled;
  },

  getSupportedTypes: async (): Promise<string[]> => {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const typeNames: string[] = [];
    
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      typeNames.push('Fingerprint');
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      typeNames.push('Face ID');
    }
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      typeNames.push('Iris');
    }
    
    return typeNames;
  },

  authenticate: async (promptMessage?: string): Promise<boolean> => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: promptMessage || 'Authenticate to access Habeshare',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
      fallbackLabel: 'Use Password',
    });
    
    return result.success;
  },

  isEnabled: async (): Promise<boolean> => {
    const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
    return enabled === 'true';
  },

  enable: async (credentials: BiometricCredentials): Promise<void> => {
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'true');
    await SecureStore.setItemAsync(
      BIOMETRIC_CREDENTIALS_KEY, 
      JSON.stringify(credentials)
    );
  },

  disable: async (): Promise<void> => {
    await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
    await SecureStore.deleteItemAsync(BIOMETRIC_CREDENTIALS_KEY);
  },

  getStoredCredentials: async (): Promise<BiometricCredentials | null> => {
    const credentialsJson = await SecureStore.getItemAsync(BIOMETRIC_CREDENTIALS_KEY);
    if (!credentialsJson) return null;
    
    try {
      return JSON.parse(credentialsJson) as BiometricCredentials;
    } catch {
      return null;
    }
  },

  authenticateAndGetCredentials: async (): Promise<BiometricCredentials | null> => {
    const isEnabled = await biometricService.isEnabled();
    if (!isEnabled) return null;

    const credentials = await biometricService.getStoredCredentials();
    if (!credentials) return null;

    const authenticated = await biometricService.authenticate();
    if (!authenticated) return null;

    return credentials;
  },
};

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim(),
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim(),
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim(),
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim(),
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID?.trim(),
};

const requiredFirebaseConfig = [
  ['apiKey', firebaseConfig.apiKey, /^AIza[0-9A-Za-z_-]{35}$/],
  [
    'authDomain',
    firebaseConfig.authDomain,
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i,
  ],
  ['projectId', firebaseConfig.projectId, /^[a-z0-9][a-z0-9-]{4,28}[a-z0-9]$/],
  ['appId', firebaseConfig.appId, /^1:\d+:(?:android|ios|web):[0-9a-f]+$/i],
] as const;

export const invalidFirebaseConfig = requiredFirebaseConfig
  .filter(([, value, pattern]) => !value || !pattern.test(value))
  .map(([name]) => name);

export const isFirebaseConfigured = invalidFirebaseConfig.length === 0;

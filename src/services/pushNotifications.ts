import { Platform } from 'react-native';

let Notifications: any = null;
let Device: any = null;

async function lazyLoad() {
  if (Platform.OS === 'web') return false;
  try {
    Notifications = await import('expo-notifications');
    Device = await import('expo-device');
    return true;
  } catch {
    return false;
  }
}

const BACKEND_BASE = process.env.EXPO_PUBLIC_API_URL ?? '';

export type NotificationNavPayload = {
  type: string;
  txId?: string;
  recipientId?: string;
  requestId?: string;
  campaignId?: string;
  scheduleId?: string;
};

let _navCallback: ((data: NotificationNavPayload) => void) | null = null;

export function setNotificationNavigationHandler(cb: (data: NotificationNavPayload) => void) {
  _navCallback = cb;
}

export function handleNotificationNavigation(data: NotificationNavPayload) {
  if (_navCallback) _navCallback(data);
}

export async function requestPushPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const loaded = await lazyLoad();
  if (!loaded || !Notifications) return false;

  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;

    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch (err) {
    console.warn('[Push] Permission request failed:', err);
    return false;
  }
}

export async function getAndRegisterPushToken(userId: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const loaded = await lazyLoad();
  if (!loaded || !Notifications || !Device) return null;

  try {
    const isDevice = Device?.isDevice ?? true;
    if (!isDevice) {
      console.warn('[Push] Must use a physical device for push tokens');
      return null;
    }

    const granted = await requestPushPermission();
    if (!granted) return null;

    const projectId = process.env.EXPO_PUBLIC_PROJECT_ID;
    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data as string;

    if (BACKEND_BASE) {
      await fetch(`${BACKEND_BASE}/api/notifications/register-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, token, platform: Platform.OS }),
      }).catch((e) => console.warn('[Push] Token register failed:', e));
    }

    return token;
  } catch (err) {
    console.warn('[Push] getAndRegisterPushToken error:', err);
    return null;
  }
}

export async function unregisterPushToken(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const loaded = await lazyLoad();
  if (!loaded || !Notifications) return;

  try {
    const projectId = process.env.EXPO_PUBLIC_PROJECT_ID;
    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data as string;

    if (BACKEND_BASE) {
      await fetch(`${BACKEND_BASE}/api/notifications/unregister-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, token }),
      }).catch(() => {});
    }
  } catch {
  }
}

export async function handleForegroundNotification(
  onReceive: (title: string, body: string, data: any) => void
): Promise<() => void> {
  if (Platform.OS === 'web') return () => {};
  const loaded = await lazyLoad();
  if (!loaded || !Notifications) return () => {};

  const subscription = Notifications.addNotificationReceivedListener((notification: any) => {
    const { title = '', body = '', data = {} } = notification.request.content;
    onReceive(title, body, data);
  });

  return () => subscription.remove();
}

export async function setupNotificationTapHandler(): Promise<() => void> {
  if (Platform.OS === 'web') return () => {};
  const loaded = await lazyLoad();
  if (!loaded || !Notifications) return () => {};

  const subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
    const data: NotificationNavPayload = response.notification.request.content.data ?? {};
    handleNotificationNavigation(data);
  });

  return () => subscription.remove();
}

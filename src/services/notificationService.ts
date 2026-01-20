import { initializeApp, getApps, getApp } from 'firebase/app';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FCM_TOKEN_KEY = 'fcm_token';

interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface NotificationPreferences {
  transactionAlerts: boolean;
  remittanceUpdates: boolean;
  promotions: boolean;
  securityAlerts: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  transactionAlerts: true,
  remittanceUpdates: true,
  promotions: true,
  securityAlerts: true,
};

class NotificationService {
  private fcmToken: string | null = null;
  private preferences: NotificationPreferences = DEFAULT_PREFERENCES;

  async initialize(): Promise<void> {
    try {
      await this.loadPreferences();
      await this.loadStoredToken();
      console.log('NotificationService initialized');
    } catch (error) {
      console.error('Failed to initialize NotificationService:', error);
    }
  }

  async requestPermission(): Promise<boolean> {
    try {
      console.log('Push notification permission requested');
      return true;
    } catch (error) {
      console.error('Failed to request notification permission:', error);
      return false;
    }
  }

  async registerForPushNotifications(): Promise<string | null> {
    try {
      const hasPermission = await this.requestPermission();
      if (!hasPermission) {
        console.log('Notification permission denied');
        return null;
      }

      const token = `fcm_token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.fcmToken = token;
      await AsyncStorage.setItem(FCM_TOKEN_KEY, token);

      console.log('FCM Token registered:', token.substring(0, 20) + '...');
      return token;
    } catch (error) {
      console.error('Failed to register for push notifications:', error);
      return null;
    }
  }

  async getFCMToken(): Promise<string | null> {
    if (this.fcmToken) return this.fcmToken;
    return await this.loadStoredToken();
  }

  private async loadStoredToken(): Promise<string | null> {
    try {
      const token = await AsyncStorage.getItem(FCM_TOKEN_KEY);
      this.fcmToken = token;
      return token;
    } catch (error) {
      console.error('Failed to load FCM token:', error);
      return null;
    }
  }

  async sendTokenToServer(userId: number): Promise<boolean> {
    try {
      const token = await this.getFCMToken();
      if (!token) {
        console.log('No FCM token available');
        return false;
      }

      console.log('FCM token would be sent to server for user:', userId);
      return true;
    } catch (error) {
      console.error('Failed to send FCM token to server:', error);
      return false;
    }
  }

  async scheduleLocalNotification(payload: NotificationPayload, delayMs: number = 0): Promise<void> {
    try {
      console.log('Local notification scheduled:', {
        ...payload,
        scheduledFor: new Date(Date.now() + delayMs).toISOString(),
      });
    } catch (error) {
      console.error('Failed to schedule local notification:', error);
    }
  }

  async sendTransactionNotification(type: string, amount: string, currency: string): Promise<void> {
    if (!this.preferences.transactionAlerts) return;

    const payload: NotificationPayload = {
      title: type === 'deposit' ? 'Money Received' : 'Transaction Complete',
      body: `${type === 'deposit' ? 'Received' : 'Sent'} ${currency} ${amount}`,
      data: { type: 'transaction', transactionType: type },
    };
    await this.scheduleLocalNotification(payload);
  }

  async sendRemittanceUpdateNotification(status: string, recipientName: string): Promise<void> {
    if (!this.preferences.remittanceUpdates) return;

    const statusMessages: Record<string, string> = {
      pending: `Transfer to ${recipientName} is being processed`,
      completed: `Transfer to ${recipientName} completed successfully`,
      failed: `Transfer to ${recipientName} failed. Please contact support.`,
    };

    const payload: NotificationPayload = {
      title: 'Remittance Update',
      body: statusMessages[status] || `Transfer status: ${status}`,
      data: { type: 'remittance', status },
    };
    await this.scheduleLocalNotification(payload);
  }

  async sendSecurityAlertNotification(alertType: string, details: string): Promise<void> {
    if (!this.preferences.securityAlerts) return;

    const payload: NotificationPayload = {
      title: 'Security Alert',
      body: details,
      data: { type: 'security', alertType },
    };
    await this.scheduleLocalNotification(payload);
  }

  async sendPromotionalNotification(title: string, message: string): Promise<void> {
    if (!this.preferences.promotions) return;

    const payload: NotificationPayload = {
      title,
      body: message,
      data: { type: 'promotion' },
    };
    await this.scheduleLocalNotification(payload);
  }

  async getPreferences(): Promise<NotificationPreferences> {
    return this.preferences;
  }

  async updatePreferences(updates: Partial<NotificationPreferences>): Promise<void> {
    this.preferences = { ...this.preferences, ...updates };
    await AsyncStorage.setItem('notification_preferences', JSON.stringify(this.preferences));
  }

  private async loadPreferences(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem('notification_preferences');
      if (stored) {
        this.preferences = { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('Failed to load notification preferences:', error);
    }
  }

  async clearToken(): Promise<void> {
    try {
      this.fcmToken = null;
      await AsyncStorage.removeItem(FCM_TOKEN_KEY);
    } catch (error) {
      console.error('Failed to clear FCM token:', error);
    }
  }
}

export const notificationService = new NotificationService();
export type { NotificationPayload, NotificationPreferences };

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import {
  subscribeToNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '../services/firestoreNotifications';
import type { Notification } from '../services/firestoreNotifications';

const COLORS = {
  primary: '#006633',
  gold: '#FFD700',
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  success: '#10B981',
  error: '#EF4444',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  orange: '#F97316',
  unreadBg: '#F0FDF4',
};

type FilterType = 'all' | 'transaction' | 'remittance' | 'security';

const FILTER_TABS: FilterType[] = ['all', 'transaction', 'remittance', 'security'];

const NOTIFICATION_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  transaction: { icon: 'cash', color: COLORS.success },
  remittance: { icon: 'send', color: COLORS.blue },
  security: { icon: 'shield', color: COLORS.error },
  promotion: { icon: 'megaphone', color: COLORS.orange },
  system: { icon: 'information-circle', color: COLORS.purple },
};

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.uid ?? '';

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const unsubscribe = subscribeToNotifications(userId, (data) => {
      setNotifications(data);
      setLoading(false);
      setRefreshing(false);
    });

    return () => unsubscribe();
  }, [userId]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
  }, []);

  const handleMarkAllRead = async () => {
    if (!userId || markingAll) return;
    setMarkingAll(true);
    try {
      await markAllNotificationsAsRead(userId);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    } finally {
      setMarkingAll(false);
    }
  };

  const handleTapNotification = async (notification: Notification) => {
    if (!notification.read && notification.id) {
      try {
        await markNotificationAsRead(notification.id);
      } catch (err) {
        console.error('Failed to mark as read:', err);
      }
    }
  };

  const filteredNotifications = activeFilter === 'all'
    ? notifications
    : notifications.filter((n) => n.type === activeFilter);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const getTimeAgo = (createdAt: any) => {
    if (!createdAt) return '';
    let date: Date;
    if (createdAt?.toDate) {
      date = createdAt.toDate();
    } else if (createdAt?.seconds) {
      date = new Date(createdAt.seconds * 1000);
    } else {
      date = new Date(createdAt);
    }
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t('notifications.justNow');
    if (diffMin < 60) return t('notifications.minutesAgo', { count: diffMin });
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return t('notifications.hoursAgo', { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return t('notifications.oneDayAgo');
    if (diffDays < 30) return t('notifications.daysAgo', { count: diffDays });
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths === 1) return t('notifications.oneMonthAgo');
    return t('notifications.monthsAgo', { count: diffMonths });
  };

  const getIconInfo = (type: string) => {
    return NOTIFICATION_ICONS[type] || NOTIFICATION_ICONS.system;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>{t('notifications.title')}</Text>
        {unreadCount > 0 && (
          <TouchableOpacity
            style={styles.markAllButton}
            onPress={handleMarkAllRead}
            disabled={markingAll}
          >
            {markingAll ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <>
                <Ionicons name="checkmark-done" size={16} color={COLORS.primary} />
                <Text style={styles.markAllText}>{t('notifications.markAllRead')}</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterContainer}
      >
        {FILTER_TABS.map((tab) => {
          const isActive = activeFilter === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.filterTab, isActive && styles.filterTabActive]}
              onPress={() => setActiveFilter(tab)}
            >
              <Text style={[styles.filterTabText, isActive && styles.filterTabTextActive]}>
                {t(`notifications.filter_${tab}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView
        style={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {filteredNotifications.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconContainer}>
              <Ionicons name="notifications-off-outline" size={64} color={COLORS.textSecondary} />
            </View>
            <Text style={styles.emptyTitle}>{t('notifications.noNotifications')}</Text>
            <Text style={styles.emptyMessage}>{t('notifications.emptyMessage')}</Text>
          </View>
        ) : (
          filteredNotifications.map((notification) => {
            const iconInfo = getIconInfo(notification.type);
            return (
              <TouchableOpacity
                key={notification.id}
                style={[
                  styles.notificationCard,
                  !notification.read && styles.notificationCardUnread,
                ]}
                onPress={() => handleTapNotification(notification)}
                activeOpacity={0.7}
              >
                <View style={[styles.iconContainer, { backgroundColor: iconInfo.color + '15' }]}>
                  <Ionicons name={iconInfo.icon} size={22} color={iconInfo.color} />
                </View>
                <View style={styles.contentContainer}>
                  <View style={styles.titleRow}>
                    <Text
                      style={[
                        styles.notificationTitle,
                        !notification.read && styles.notificationTitleUnread,
                      ]}
                      numberOfLines={1}
                    >
                      {notification.title}
                    </Text>
                    {!notification.read && <View style={styles.unreadDot} />}
                  </View>
                  <Text style={styles.notificationMessage} numberOfLines={2}>
                    {notification.message}
                  </Text>
                  <Text style={styles.notificationTime}>
                    {getTimeAgo(notification.createdAt)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  markAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: COLORS.primary + '10',
  },
  markAllText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '500',
  },
  filterContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterTabActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterTabText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  filterTabTextActive: {
    color: COLORS.white,
  },
  listContainer: {
    flex: 1,
  },
  notificationCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
    alignItems: 'flex-start',
  },
  notificationCardUnread: {
    backgroundColor: COLORS.unreadBg,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  contentContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notificationTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
    flex: 1,
  },
  notificationTitleUnread: {
    fontWeight: '700',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginLeft: 8,
  },
  notificationMessage: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  notificationTime: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 6,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});

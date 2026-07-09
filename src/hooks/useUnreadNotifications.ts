import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { getUnreadCount } from '../services/firestoreNotifications';

/**
 * useUnreadNotifications — shared, real-time unread notification count.
 *
 * Backed by a live Firestore listener (getUnreadCount), so the badge updates
 * immediately after notifications are marked read anywhere in the app —
 * no polling interval needed. In-app only; no SMS/push involved.
 */
export function useUnreadNotifications(): number {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user?.uid) {
      setUnreadCount(0);
      return;
    }
    const unsubscribe = getUnreadCount(user.uid, setUnreadCount);
    return () => unsubscribe();
  }, [user?.uid]);

  return unreadCount;
}

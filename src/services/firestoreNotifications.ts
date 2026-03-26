import { 
  db, 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp,
  getDocs
} from './firebase';

export interface Notification {
  id?: string;
  userId: string;
  type: 'transaction' | 'remittance' | 'security' | 'promotion' | 'system';
  title: string;
  message: string;
  read: boolean;
  data?: Record<string, any>;
  createdAt: any;
}

const NOTIFICATIONS_COLLECTION = 'notifications';

export const subscribeToNotifications = (
  userId: string,
  callback: (notifications: Notification[]) => void,
  onError?: (error: Error) => void,
  maxItems: number = 50
) => {
  const notificationsRef = collection(db, NOTIFICATIONS_COLLECTION);
  // Avoid orderBy in the query — it requires a composite Firestore index.
  // We sort client-side instead so the app works without index deployment.
  const q = query(
    notificationsRef,
    where('userId', '==', userId),
    limit(maxItems)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const notifications: Notification[] = [];
      snapshot.forEach((doc) => {
        notifications.push({
          id: doc.id,
          ...doc.data()
        } as Notification);
      });
      // Sort by createdAt descending client-side
      notifications.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() ?? (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const bTime = b.createdAt?.toMillis?.() ?? (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return bTime - aTime;
      });
      callback(notifications);
    },
    (error) => {
      console.error('[Notifications] Firestore subscription error:', error);
      if (onError) {
        onError(error);
      } else {
        callback([]);
      }
    }
  );
};

export const createNotification = async (notification: Omit<Notification, 'id' | 'createdAt' | 'read'>) => {
  const notificationsRef = collection(db, NOTIFICATIONS_COLLECTION);
  return addDoc(notificationsRef, {
    ...notification,
    read: false,
    createdAt: serverTimestamp()
  });
};

export const markNotificationAsRead = async (notificationId: string) => {
  const notificationRef = doc(db, NOTIFICATIONS_COLLECTION, notificationId);
  return updateDoc(notificationRef, { read: true });
};

export const markAllNotificationsAsRead = async (userId: string) => {
  const notificationsRef = collection(db, NOTIFICATIONS_COLLECTION);
  const q = query(
    notificationsRef,
    where('userId', '==', userId),
    where('read', '==', false)
  );
  
  const snapshot = await getDocs(q);
  const updates = snapshot.docs.map((doc) => 
    updateDoc(doc.ref, { read: true })
  );
  
  return Promise.all(updates);
};

export const deleteNotification = async (notificationId: string) => {
  const notificationRef = doc(db, NOTIFICATIONS_COLLECTION, notificationId);
  return deleteDoc(notificationRef);
};

export const getUnreadCount = (
  userId: string,
  callback: (count: number) => void
) => {
  const notificationsRef = collection(db, NOTIFICATIONS_COLLECTION);
  const q = query(
    notificationsRef,
    where('userId', '==', userId),
    where('read', '==', false)
  );

  return onSnapshot(q, (snapshot) => {
    callback(snapshot.size);
  });
};

export const sendTransactionNotification = async (
  userId: string,
  amount: number,
  currency: string,
  type: 'sent' | 'received'
) => {
  return createNotification({
    userId,
    type: 'transaction',
    title: type === 'sent' ? 'Money Sent' : 'Money Received',
    message: type === 'sent' 
      ? `You sent ${currency} ${amount.toFixed(2)}`
      : `You received ${currency} ${amount.toFixed(2)}`,
    data: { amount, currency, transactionType: type }
  });
};

export const sendRemittanceNotification = async (
  userId: string,
  recipientName: string,
  amount: number,
  status: 'initiated' | 'processing' | 'completed' | 'failed'
) => {
  const statusMessages = {
    initiated: `Transfer to ${recipientName} has been initiated`,
    processing: `Transfer to ${recipientName} is being processed`,
    completed: `Transfer of $${amount.toFixed(2)} to ${recipientName} completed successfully`,
    failed: `Transfer to ${recipientName} failed. Please try again.`
  };

  return createNotification({
    userId,
    type: 'remittance',
    title: `Remittance ${status.charAt(0).toUpperCase() + status.slice(1)}`,
    message: statusMessages[status],
    data: { recipientName, amount, status }
  });
};

export const sendSecurityNotification = async (
  userId: string,
  event: 'login' | 'password_change' | 'suspicious_activity'
) => {
  const messages = {
    login: 'New login detected on your account',
    password_change: 'Your password was changed successfully',
    suspicious_activity: 'Suspicious activity detected on your account. Please review.'
  };

  return createNotification({
    userId,
    type: 'security',
    title: 'Security Alert',
    message: messages[event],
    data: { event, timestamp: new Date().toISOString() }
  });
};

import { 
  db, 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp,
  getDocs,
  getDoc
} from './firebase';

export interface ChatMessage {
  id?: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderType: 'user' | 'support';
  message: string;
  read: boolean;
  createdAt: any;
}

export interface Conversation {
  id?: string;
  userId: string;
  userEmail: string;
  userName: string;
  subject: string;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  category: 'general' | 'remittance' | 'account' | 'technical' | 'billing';
  lastMessage?: string;
  lastMessageAt?: any;
  createdAt: any;
  updatedAt: any;
}

const CONVERSATIONS_COLLECTION = 'conversations';
const MESSAGES_COLLECTION = 'messages';

export const createConversation = async (
  userId: string,
  userEmail: string,
  userName: string,
  subject: string,
  category: Conversation['category'] = 'general',
  priority: Conversation['priority'] = 'medium'
): Promise<string> => {
  const conversationsRef = collection(db, CONVERSATIONS_COLLECTION);
  const docRef = await addDoc(conversationsRef, {
    userId,
    userEmail,
    userName,
    subject,
    status: 'open',
    priority,
    category,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return docRef.id;
};

export const getUserConversations = (
  userId: string,
  callback: (conversations: Conversation[]) => void
) => {
  const conversationsRef = collection(db, CONVERSATIONS_COLLECTION);
  const q = query(
    conversationsRef,
    where('userId', '==', userId),
    orderBy('updatedAt', 'desc'),
    limit(20)
  );

  return onSnapshot(q, (snapshot) => {
    const conversations: Conversation[] = [];
    snapshot.forEach((doc) => {
      conversations.push({
        id: doc.id,
        ...doc.data()
      } as Conversation);
    });
    callback(conversations);
  });
};

export const getConversation = async (conversationId: string): Promise<Conversation | null> => {
  const conversationRef = doc(db, CONVERSATIONS_COLLECTION, conversationId);
  const snapshot = await getDoc(conversationRef);
  if (snapshot.exists()) {
    return { id: snapshot.id, ...snapshot.data() } as Conversation;
  }
  return null;
};

export const updateConversationStatus = async (
  conversationId: string,
  status: Conversation['status']
) => {
  const conversationRef = doc(db, CONVERSATIONS_COLLECTION, conversationId);
  return updateDoc(conversationRef, { 
    status, 
    updatedAt: serverTimestamp() 
  });
};

export const subscribeToMessages = (
  conversationId: string,
  callback: (messages: ChatMessage[]) => void,
  maxMessages: number = 100
) => {
  const messagesRef = collection(db, MESSAGES_COLLECTION);
  const q = query(
    messagesRef,
    where('conversationId', '==', conversationId),
    orderBy('createdAt', 'asc'),
    limit(maxMessages)
  );

  return onSnapshot(q, (snapshot) => {
    const messages: ChatMessage[] = [];
    snapshot.forEach((doc) => {
      messages.push({
        id: doc.id,
        ...doc.data()
      } as ChatMessage);
    });
    callback(messages);
  });
};

export const sendMessage = async (
  conversationId: string,
  senderId: string,
  senderName: string,
  senderType: 'user' | 'support',
  message: string
) => {
  const messagesRef = collection(db, MESSAGES_COLLECTION);
  const messageDoc = await addDoc(messagesRef, {
    conversationId,
    senderId,
    senderName,
    senderType,
    message,
    read: false,
    createdAt: serverTimestamp()
  });

  const conversationRef = doc(db, CONVERSATIONS_COLLECTION, conversationId);
  await updateDoc(conversationRef, {
    lastMessage: message,
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    status: senderType === 'user' ? 'pending' : 'open'
  });

  return messageDoc.id;
};

export const markMessagesAsRead = async (conversationId: string, userId: string) => {
  const messagesRef = collection(db, MESSAGES_COLLECTION);
  const q = query(
    messagesRef,
    where('conversationId', '==', conversationId),
    where('senderId', '!=', userId),
    where('read', '==', false)
  );

  const snapshot = await getDocs(q);
  const updates = snapshot.docs.map((doc) => 
    updateDoc(doc.ref, { read: true })
  );

  return Promise.all(updates);
};

export const getUnreadMessageCount = (
  userId: string,
  callback: (count: number) => void
) => {
  const conversationsRef = collection(db, CONVERSATIONS_COLLECTION);
  const q = query(
    conversationsRef,
    where('userId', '==', userId)
  );

  return onSnapshot(q, async (conversationsSnapshot) => {
    let totalUnread = 0;
    
    for (const convDoc of conversationsSnapshot.docs) {
      const messagesRef = collection(db, MESSAGES_COLLECTION);
      const messagesQuery = query(
        messagesRef,
        where('conversationId', '==', convDoc.id),
        where('senderType', '==', 'support'),
        where('read', '==', false)
      );
      const messagesSnapshot = await getDocs(messagesQuery);
      totalUnread += messagesSnapshot.size;
    }
    
    callback(totalUnread);
  });
};

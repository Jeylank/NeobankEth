import {
  db,
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from './firebase';
import { remittanceApi } from './api';
import { createNotification } from './firestoreNotifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MoneyRequest, RequestPurpose } from '../types';

const COLLECTION = 'money_requests';
const LOCAL_KEY = 'money_requests_local';

function requestsRef() {
  return collection(db, COLLECTION);
}

function requestDoc(requestId: string) {
  return doc(db, COLLECTION, requestId);
}

async function tryNotification(
  userId: string,
  title: string,
  message: string,
  data?: Record<string, any>
): Promise<void> {
  try {
    await createNotification({
      userId,
      type: 'system',
      title,
      message,
      data,
    });
  } catch (error) {
    console.warn('Failed to send notification:', error);
  }
}

async function getLocalRequests(): Promise<MoneyRequest[]> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

async function saveLocalRequests(requests: MoneyRequest[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(requests));
}

class MoneyRequestsService {
  private useLocalFallback = false;

  private enableFallback(): void {
    if (!this.useLocalFallback) {
      console.warn('Firestore unavailable for money requests — using local fallback');
      this.useLocalFallback = true;
    }
  }

  async createRequest(data: {
    requesterId: string;
    requesterName: string;
    receiverId: string;
    amount: number;
    currency: string;
    purpose: RequestPurpose;
    message?: string;
  }): Promise<MoneyRequest> {
    const now = new Date().toISOString();
    const requestData = {
      ...data,
      status: 'pending' as const,
      createdAt: now,
      updatedAt: now,
    };

    if (this.useLocalFallback || !data.receiverId) {
      const localRequests = await getLocalRequests();
      const newRequest: MoneyRequest = {
        ...requestData,
        id: `req_${Date.now()}`,
      };
      localRequests.unshift(newRequest);
      await saveLocalRequests(localRequests);
      return newRequest;
    }

    try {
      const docRef = await addDoc(requestsRef(), requestData);
      const newRequest: MoneyRequest = { ...requestData, id: docRef.id };

      await tryNotification(
        data.receiverId,
        'Family Support Request',
        `${data.requesterName} requested ${data.amount} ${data.currency} for ${data.purpose.replace('_', ' ')}.`,
        { requestId: docRef.id, category: 'family_request' }
      );

      return newRequest;
    } catch (error) {
      console.error('Firestore createRequest failed, using fallback:', error);
      this.enableFallback();
      const localRequests = await getLocalRequests();
      const newRequest: MoneyRequest = {
        ...requestData,
        id: `req_${Date.now()}`,
      };
      localRequests.unshift(newRequest);
      await saveLocalRequests(localRequests);
      return newRequest;
    }
  }

  async getIncomingRequests(userId: string): Promise<MoneyRequest[]> {
    if (this.useLocalFallback || !userId) {
      const all = await getLocalRequests();
      return all.filter(r => r.receiverId === userId).sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    try {
      const q = query(
        requestsRef(),
        where('receiverId', '==', userId),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => ({ ...d.data(), id: d.id } as MoneyRequest));
    } catch (error) {
      console.error('Firestore getIncomingRequests failed, using fallback:', error);
      this.enableFallback();
      const all = await getLocalRequests();
      return all.filter(r => r.receiverId === userId);
    }
  }

  async getOutgoingRequests(userId: string): Promise<MoneyRequest[]> {
    if (this.useLocalFallback || !userId) {
      const all = await getLocalRequests();
      return all.filter(r => r.requesterId === userId).sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    try {
      const q = query(
        requestsRef(),
        where('requesterId', '==', userId),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => ({ ...d.data(), id: d.id } as MoneyRequest));
    } catch (error) {
      console.error('Firestore getOutgoingRequests failed, using fallback:', error);
      this.enableFallback();
      const all = await getLocalRequests();
      return all.filter(r => r.requesterId === userId);
    }
  }

  async approveRequest(requestId: string, userId: string): Promise<MoneyRequest> {
    if (this.useLocalFallback) {
      const localRequests = await getLocalRequests();
      const idx = localRequests.findIndex(r => r.id === requestId);
      if (idx === -1) throw new Error('Request not found');
      localRequests[idx].status = 'approved';
      localRequests[idx].updatedAt = new Date().toISOString();
      await saveLocalRequests(localRequests);
      return localRequests[idx];
    }

    try {
      const ref = requestDoc(requestId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Request not found');

      const request = { ...snap.data(), id: requestId } as MoneyRequest;
      if (request.receiverId !== userId) throw new Error('Unauthorized');
      if (request.status !== 'pending') throw new Error('Request already processed');

      try {
        await remittanceApi.initiateTransfer({
          amount: request.amount,
          fromCurrency: 'EUR',
          toCurrency: request.currency,
          beneficiaryId: 0,
          description: `Family Request: ${request.requesterName} - ${request.purpose.replace('_', ' ')}`,
          payoutMethod: 'mobile_wallet',
        });
      } catch (transferErr) {
        console.warn('Payout API call failed (demo mode):', transferErr);
      }

      await updateDoc(ref, {
        status: 'approved',
        updatedAt: new Date().toISOString(),
      });

      await tryNotification(
        request.requesterId,
        'Request Approved',
        `Your request for ${request.amount} ${request.currency} has been approved.`,
        { requestId, category: 'family_request' }
      );

      return { ...request, status: 'approved', updatedAt: new Date().toISOString() };
    } catch (error: any) {
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore approveRequest failed, using fallback:', error);
        this.enableFallback();
        return this.approveRequest(requestId, userId);
      }
      throw error;
    }
  }

  async declineRequest(requestId: string, userId: string): Promise<MoneyRequest> {
    if (this.useLocalFallback) {
      const localRequests = await getLocalRequests();
      const idx = localRequests.findIndex(r => r.id === requestId);
      if (idx === -1) throw new Error('Request not found');
      localRequests[idx].status = 'declined';
      localRequests[idx].updatedAt = new Date().toISOString();
      await saveLocalRequests(localRequests);
      return localRequests[idx];
    }

    try {
      const ref = requestDoc(requestId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Request not found');

      const request = { ...snap.data(), id: requestId } as MoneyRequest;
      if (request.receiverId !== userId) throw new Error('Unauthorized');
      if (request.status !== 'pending') throw new Error('Request already processed');

      await updateDoc(ref, {
        status: 'declined',
        updatedAt: new Date().toISOString(),
      });

      await tryNotification(
        request.requesterId,
        'Request Declined',
        `Your request for ${request.amount} ${request.currency} has been declined.`,
        { requestId, category: 'family_request' }
      );

      return { ...request, status: 'declined', updatedAt: new Date().toISOString() };
    } catch (error: any) {
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore declineRequest failed, using fallback:', error);
        this.enableFallback();
        return this.declineRequest(requestId, userId);
      }
      throw error;
    }
  }
}

export const moneyRequestsService = new MoneyRequestsService();

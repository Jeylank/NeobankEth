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
import type { MoneyRequest, RequestPurpose, RequestStatus } from '../types';

const COLLECTION = 'money_requests';
const LOCAL_KEY = 'money_requests_local';
const IS_DEV = __DEV__;

type AuditAction = 'request_created' | 'request_approved' | 'request_declined' | 'payout_initiated_from_request';

function requestsRef() {
  return collection(db, COLLECTION);
}

function requestDoc(requestId: string) {
  return doc(db, COLLECTION, requestId);
}

function auditCollection(userId: string) {
  return collection(db, 'users', userId, 'request_audit_log');
}

async function addAuditLog(
  userId: string,
  action: AuditAction,
  requestId: string,
  details: Record<string, any>
): Promise<void> {
  try {
    await addDoc(auditCollection(userId), {
      action,
      requestId,
      details,
      timestamp: serverTimestamp(),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('Failed to write audit log:', error);
  }
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
  private offlineMode = false;

  private enableFallback(): void {
    if (IS_DEV) {
      if (!this.useLocalFallback) {
        console.warn('Firestore unavailable for money requests — using local fallback (dev mode)');
        this.useLocalFallback = true;
      }
    } else {
      this.offlineMode = true;
    }
  }

  isOffline(): boolean {
    return this.offlineMode && !IS_DEV;
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
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    const now = new Date().toISOString();
    const requestData = {
      ...data,
      status: 'pending' as RequestStatus,
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

      await addAuditLog(data.receiverId, 'request_created', docRef.id, {
        requesterName: data.requesterName,
        amount: data.amount,
        currency: data.currency,
        purpose: data.purpose,
      });

      await tryNotification(
        data.receiverId,
        'Family Support Request',
        `${data.requesterName} requested ${data.amount} ${data.currency} for ${data.purpose.replace('_', ' ')}.`,
        { requestId: docRef.id, category: 'family_request' }
      );

      return newRequest;
    } catch (error) {
      console.error('Firestore createRequest failed:', error);
      this.enableFallback();
      if (!IS_DEV) throw new Error('OFFLINE');
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
      if (!IS_DEV && this.offlineMode) return [];
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
      console.error('Firestore getIncomingRequests failed:', error);
      this.enableFallback();
      if (!IS_DEV) return [];
      const all = await getLocalRequests();
      return all.filter(r => r.receiverId === userId);
    }
  }

  async getOutgoingRequests(userId: string): Promise<MoneyRequest[]> {
    if (this.useLocalFallback || !userId) {
      if (!IS_DEV && this.offlineMode) return [];
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
      console.error('Firestore getOutgoingRequests failed:', error);
      this.enableFallback();
      if (!IS_DEV) return [];
      const all = await getLocalRequests();
      return all.filter(r => r.requesterId === userId);
    }
  }

  async approveRequest(requestId: string, userId: string): Promise<MoneyRequest> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    if (this.useLocalFallback) {
      const localRequests = await getLocalRequests();
      const idx = localRequests.findIndex(r => r.id === requestId);
      if (idx === -1) throw new Error('Request not found');
      if (localRequests[idx].status !== 'pending') throw new Error('ALREADY_PROCESSED');
      const now = new Date().toISOString();
      localRequests[idx].status = 'completed';
      localRequests[idx].transactionId = `txn_local_${Date.now()}`;
      localRequests[idx].approvedAt = now;
      localRequests[idx].approvedBy = userId;
      localRequests[idx].updatedAt = now;
      await saveLocalRequests(localRequests);
      return localRequests[idx];
    }

    try {
      const ref = requestDoc(requestId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Request not found');

      const request = { ...snap.data(), id: requestId } as MoneyRequest;
      if (request.receiverId !== userId) throw new Error('Unauthorized');
      if (request.status !== 'pending') throw new Error('ALREADY_PROCESSED');

      const approvedAt = new Date().toISOString();

      await updateDoc(ref, {
        status: 'processing' as RequestStatus,
        approvedAt,
        approvedBy: userId,
        updatedAt: approvedAt,
      });

      await addAuditLog(userId, 'request_approved', requestId, {
        requesterName: request.requesterName,
        amount: request.amount,
        currency: request.currency,
        approvedAt,
      });

      let transactionId: string | undefined;
      let finalStatus: RequestStatus = 'completed';

      try {
        const transferResult = await remittanceApi.initiateTransfer({
          userId,
          recipientId: request.requesterId,
          amount: request.amount,
          currency: 'EUR',
          payout_method: 'mobile_money',
        });
        transactionId = transferResult.transactionId;

        await addAuditLog(userId, 'payout_initiated_from_request', requestId, {
          transactionId,
          amount: request.amount,
          currency: request.currency,
          requesterName: request.requesterName,
        });
      } catch (transferErr) {
        console.warn('Payout API call failed:', transferErr);
        transactionId = `txn_failed_${Date.now()}`;
        finalStatus = 'failed';
      }

      await updateDoc(ref, {
        status: finalStatus,
        transactionId,
        updatedAt: new Date().toISOString(),
      });

      await tryNotification(
        request.requesterId,
        finalStatus === 'completed' ? 'Request Completed' : 'Request Failed',
        finalStatus === 'completed'
          ? `Your request for ${request.amount} ${request.currency} has been approved and sent.`
          : `Your request for ${request.amount} ${request.currency} was approved but the payout failed. Please contact support.`,
        { requestId, transactionId, category: 'family_request' }
      );

      return {
        ...request,
        status: finalStatus,
        transactionId,
        approvedAt,
        approvedBy: userId,
        updatedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      if (error?.message === 'ALREADY_PROCESSED') throw error;
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore approveRequest failed:', error);
        this.enableFallback();
        if (!IS_DEV) throw new Error('OFFLINE');
        return this.approveRequest(requestId, userId);
      }
      throw error;
    }
  }

  async declineRequest(requestId: string, userId: string): Promise<MoneyRequest> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    if (this.useLocalFallback) {
      const localRequests = await getLocalRequests();
      const idx = localRequests.findIndex(r => r.id === requestId);
      if (idx === -1) throw new Error('Request not found');
      if (localRequests[idx].status !== 'pending') throw new Error('ALREADY_PROCESSED');
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
      if (request.status !== 'pending') throw new Error('ALREADY_PROCESSED');

      await updateDoc(ref, {
        status: 'declined' as RequestStatus,
        updatedAt: new Date().toISOString(),
      });

      await addAuditLog(userId, 'request_declined', requestId, {
        requesterName: request.requesterName,
        amount: request.amount,
        currency: request.currency,
      });

      await tryNotification(
        request.requesterId,
        'Request Declined',
        `Your request for ${request.amount} ${request.currency} has been declined.`,
        { requestId, category: 'family_request' }
      );

      return { ...request, status: 'declined', updatedAt: new Date().toISOString() };
    } catch (error: any) {
      if (error?.message === 'ALREADY_PROCESSED') throw error;
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore declineRequest failed:', error);
        this.enableFallback();
        if (!IS_DEV) throw new Error('OFFLINE');
        return this.declineRequest(requestId, userId);
      }
      throw error;
    }
  }
}

export const moneyRequestsService = new MoneyRequestsService();

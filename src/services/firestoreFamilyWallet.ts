import {
  db,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from './firebase';
import { remittanceApi } from './api';
import { familyWalletService } from './familyWalletService';
import type { FamilyMember, MonthlyAllocation } from '../types';

export interface AuditLogEntry {
  action: 'member_added' | 'member_updated' | 'member_paused' | 'member_resumed' | 'member_deleted' | 'support_sent';
  memberId?: string;
  memberName?: string;
  details: Record<string, any>;
  createdAt: any;
}

const PAYOUT_METHOD_MAP: Record<FamilyMember['payoutMethod'], string> = {
  telebirr: 'mobile_wallet',
  direct_transfer: 'bank_account',
  cash_pickup: 'cash_pickup',
};

const getNextPayoutDate = (): string => {
  const date = new Date();
  date.setMonth(date.getMonth() + 1, 1);
  return date.toISOString();
};

const SEED_MEMBERS: Omit<FamilyMember, 'id'>[] = [
  {
    userId: '',
    name: 'Almaz Bekele',
    relationship: 'mother',
    phone: '+251911234567',
    payoutMethod: 'telebirr',
    monthlyAmount: 200,
    currency: 'USD',
    status: 'active',
    nextPayoutDate: getNextPayoutDate(),
    note: 'Monthly living expenses',
    createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    userId: '',
    name: 'Dawit Bekele',
    relationship: 'brother',
    phone: '+251922345678',
    payoutMethod: 'direct_transfer',
    monthlyAmount: 150,
    currency: 'USD',
    status: 'active',
    nextPayoutDate: getNextPayoutDate(),
    note: 'University tuition support',
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
  },
  {
    userId: '',
    name: 'Tigist Bekele',
    relationship: 'sister',
    phone: '+251933456789',
    payoutMethod: 'cash_pickup',
    monthlyAmount: 100,
    currency: 'USD',
    status: 'active',
    nextPayoutDate: getNextPayoutDate(),
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
];

function membersCollection(userId: string) {
  return collection(db, 'users', userId, 'family_members');
}

function auditCollection(userId: string) {
  return collection(db, 'users', userId, 'family_audit_log');
}

function sentCollection(userId: string) {
  return collection(db, 'users', userId, 'family_sent');
}

function memberDoc(userId: string, memberId: string) {
  return doc(db, 'users', userId, 'family_members', memberId);
}

async function addAuditLog(
  userId: string,
  action: AuditLogEntry['action'],
  memberId: string | undefined,
  memberName: string | undefined,
  details: Record<string, any>
): Promise<void> {
  try {
    await addDoc(auditCollection(userId), {
      action,
      memberId: memberId || null,
      memberName: memberName || null,
      details,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

async function seedDevData(userId: string): Promise<FamilyMember[]> {
  const seeded: FamilyMember[] = [];
  for (const seed of SEED_MEMBERS) {
    const data = { ...seed, userId };
    const docRef = await addDoc(membersCollection(userId), data);
    seeded.push({ ...data, id: docRef.id } as FamilyMember);
  }
  await addAuditLog(userId, 'member_added', undefined, undefined, {
    seedData: true,
    count: SEED_MEMBERS.length,
  });
  return seeded;
}

function isFirestoreAvailable(userId: string | undefined): boolean {
  return !!userId;
}

class FirestoreFamilyWalletService {
  private useLocalFallback = false;

  private shouldFallback(userId: string | undefined): boolean {
    return this.useLocalFallback || !isFirestoreAvailable(userId);
  }

  private enableFallback(): void {
    if (!this.useLocalFallback) {
      console.warn('Firestore unavailable — using local storage fallback');
      this.useLocalFallback = true;
    }
  }

  async getFamilyMembers(userId: string): Promise<FamilyMember[]> {
    if (this.shouldFallback(userId)) {
      return familyWalletService.getFamilyMembers();
    }

    try {
      const q = query(membersCollection(userId), orderBy('createdAt', 'asc'));
      const snapshot = await getDocs(q);

      if (snapshot.empty && __DEV__) {
        return seedDevData(userId);
      }

      return snapshot.docs.map((d) => ({
        ...d.data(),
        id: d.id,
      })) as FamilyMember[];
    } catch (error) {
      console.error('Firestore getFamilyMembers failed, using fallback:', error);
      this.enableFallback();
      return familyWalletService.getFamilyMembers();
    }
  }

  async addFamilyMember(
    userId: string,
    data: Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<FamilyMember> {
    if (this.shouldFallback(userId)) {
      return familyWalletService.addFamilyMember(data);
    }

    try {
      const now = new Date().toISOString();
      const memberData = {
        ...data,
        userId,
        createdAt: now,
        updatedAt: now,
      };
      const docRef = await addDoc(membersCollection(userId), memberData);
      const newMember: FamilyMember = { ...memberData, id: docRef.id };

      await addAuditLog(userId, 'member_added', docRef.id, data.name, {
        relationship: data.relationship,
        monthlyAmount: data.monthlyAmount,
        currency: data.currency,
        payoutMethod: data.payoutMethod,
      });

      return newMember;
    } catch (error) {
      console.error('Firestore addFamilyMember failed, using fallback:', error);
      this.enableFallback();
      return familyWalletService.addFamilyMember(data);
    }
  }

  async updateFamilyMember(
    userId: string,
    memberId: string,
    data: Partial<FamilyMember>
  ): Promise<FamilyMember> {
    if (this.shouldFallback(userId)) {
      return familyWalletService.updateFamilyMember(memberId, data);
    }

    try {
      const ref = memberDoc(userId, memberId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        throw new Error('Family member not found');
      }

      const updates = {
        ...data,
        updatedAt: new Date().toISOString(),
      };
      delete (updates as any).id;
      await updateDoc(ref, updates);

      const updated = { ...snap.data(), ...updates, id: memberId } as FamilyMember;

      await addAuditLog(userId, 'member_updated', memberId, updated.name, {
        updatedFields: Object.keys(data),
      });

      return updated;
    } catch (error: any) {
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore updateFamilyMember failed, using fallback:', error);
        this.enableFallback();
        return familyWalletService.updateFamilyMember(memberId, data);
      }
      throw error;
    }
  }

  async deleteFamilyMember(userId: string, memberId: string): Promise<void> {
    if (this.shouldFallback(userId)) {
      return familyWalletService.deleteFamilyMember(memberId);
    }

    try {
      const ref = memberDoc(userId, memberId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        throw new Error('Family member not found');
      }
      const memberData = snap.data() as FamilyMember;

      await deleteDoc(ref);

      await addAuditLog(userId, 'member_deleted', memberId, memberData.name, {
        relationship: memberData.relationship,
        monthlyAmount: memberData.monthlyAmount,
      });
    } catch (error: any) {
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore deleteFamilyMember failed, using fallback:', error);
        this.enableFallback();
        return familyWalletService.deleteFamilyMember(memberId);
      }
      throw error;
    }
  }

  async toggleMemberStatus(userId: string, memberId: string): Promise<FamilyMember> {
    if (this.shouldFallback(userId)) {
      return familyWalletService.toggleMemberStatus(memberId);
    }

    try {
      const ref = memberDoc(userId, memberId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        throw new Error('Family member not found');
      }

      const current = snap.data() as FamilyMember;
      const newStatus = current.status === 'active' ? 'paused' : 'active';
      const updates = {
        status: newStatus,
        updatedAt: new Date().toISOString(),
      };
      await updateDoc(ref, updates);

      const action: AuditLogEntry['action'] = newStatus === 'paused' ? 'member_paused' : 'member_resumed';
      await addAuditLog(userId, action, memberId, current.name, {
        previousStatus: current.status,
        newStatus,
      });

      return { ...current, ...updates, id: memberId } as FamilyMember;
    } catch (error: any) {
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore toggleMemberStatus failed, using fallback:', error);
        this.enableFallback();
        return familyWalletService.toggleMemberStatus(memberId);
      }
      throw error;
    }
  }

  async sendFamilySupport(userId: string, member: FamilyMember): Promise<MonthlyAllocation> {
    if (this.shouldFallback(userId)) {
      try {
        await remittanceApi.initiateTransfer({
          userId,
          recipientId: member.id,
          amount: member.monthlyAmount,
          currency: member.currency,
          payout_method: member.payoutMethod === 'cash_pickup' ? 'agent_cash' : PAYOUT_METHOD_MAP[member.payoutMethod],
        });
      } catch (transferError) {
        console.warn('Remittance API unavailable, recording locally:', transferError);
      }
      return familyWalletService.sendFamilySupport(member.id);
    }

    const allocation: MonthlyAllocation = {
      memberId: member.id,
      memberName: member.name,
      amount: member.monthlyAmount,
      currency: member.currency,
      status: 'sent',
      sentAt: new Date().toISOString(),
    };

    try {
      await remittanceApi.initiateTransfer({
        userId,
        recipientId: member.id,
        amount: member.monthlyAmount,
        currency: member.currency,
        payout_method: member.payoutMethod === 'cash_pickup' ? 'agent_cash' : PAYOUT_METHOD_MAP[member.payoutMethod],
      });
    } catch (error) {
      allocation.status = 'failed';
      const now = new Date();
      const sentKey = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
      try {
        await addDoc(sentCollection(userId), {
          ...allocation,
          monthKey: sentKey,
          createdAt: serverTimestamp(),
        });
      } catch (fsError) {
        console.error('Failed to record failed allocation to Firestore:', fsError);
      }

      await addAuditLog(userId, 'support_sent', member.id, member.name, {
        amount: member.monthlyAmount,
        currency: member.currency,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Transfer failed',
      });

      throw error;
    }

    const now = new Date();
    const sentKey = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
    try {
      await addDoc(sentCollection(userId), {
        ...allocation,
        monthKey: sentKey,
        createdAt: serverTimestamp(),
      });

      const ref = memberDoc(userId, member.id);
      await updateDoc(ref, {
        nextPayoutDate: getNextPayoutDate(),
        updatedAt: new Date().toISOString(),
      });

      await addAuditLog(userId, 'support_sent', member.id, member.name, {
        amount: member.monthlyAmount,
        currency: member.currency,
        payoutMethod: member.payoutMethod,
        status: 'sent',
      });
    } catch (fsError) {
      console.error('Firestore post-send recording failed:', fsError);
    }

    return allocation;
  }

  async getSentThisMonth(userId: string): Promise<MonthlyAllocation[]> {
    if (this.shouldFallback(userId)) {
      return familyWalletService.getSentThisMonth();
    }

    try {
      const now = new Date();
      const monthKey = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;

      const q = query(
        sentCollection(userId),
        where('monthKey', '==', monthKey)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => {
        const data = d.data();
        return {
          memberId: data.memberId,
          memberName: data.memberName,
          amount: data.amount,
          currency: data.currency,
          status: data.status,
          sentAt: data.sentAt,
        };
      });
    } catch (error) {
      console.error('Firestore getSentThisMonth failed, using fallback:', error);
      this.enableFallback();
      return familyWalletService.getSentThisMonth();
    }
  }
}

export const firestoreFamilyWalletService = new FirestoreFamilyWalletService();

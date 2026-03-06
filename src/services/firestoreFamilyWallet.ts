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

class FirestoreFamilyWalletService {
  async getFamilyMembers(userId: string): Promise<FamilyMember[]> {
    const q = query(membersCollection(userId), orderBy('createdAt', 'asc'));
    const snapshot = await getDocs(q);

    if (snapshot.empty && __DEV__) {
      return seedDevData(userId);
    }

    return snapshot.docs.map((d) => ({
      ...d.data(),
      id: d.id,
    })) as FamilyMember[];
  }

  async addFamilyMember(
    userId: string,
    data: Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<FamilyMember> {
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
  }

  async updateFamilyMember(
    userId: string,
    memberId: string,
    data: Partial<FamilyMember>
  ): Promise<FamilyMember> {
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
  }

  async deleteFamilyMember(userId: string, memberId: string): Promise<void> {
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
  }

  async toggleMemberStatus(userId: string, memberId: string): Promise<FamilyMember> {
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
  }

  async sendFamilySupport(userId: string, member: FamilyMember): Promise<MonthlyAllocation> {
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
        amount: member.monthlyAmount,
        fromCurrency: member.currency,
        toCurrency: 'ETB',
        beneficiaryId: 0,
        description: `Family Support: ${member.name}${member.note ? ' - ' + member.note : ''}`,
        payoutMethod: PAYOUT_METHOD_MAP[member.payoutMethod],
      });
    } catch (error) {
      allocation.status = 'failed';
      const now = new Date();
      const sentKey = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
      await addDoc(sentCollection(userId), {
        ...allocation,
        monthKey: sentKey,
        createdAt: serverTimestamp(),
      });

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

    return allocation;
  }

  async getSentThisMonth(userId: string): Promise<MonthlyAllocation[]> {
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
  }
}

export const firestoreFamilyWalletService = new FirestoreFamilyWalletService();

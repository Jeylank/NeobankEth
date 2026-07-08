import {
  db,
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  orderBy,
  serverTimestamp,
} from './firebase';
import { remittanceApi } from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FamilyCircle, CircleMember, CircleContribution } from '../types';

const LOCAL_CIRCLES_KEY = 'family_circles_local';
const LOCAL_CONTRIBUTIONS_KEY = 'circle_contributions_local';
const IS_DEV = __DEV__;

type AuditAction =
  | 'circle_created'
  | 'circle_updated'
  | 'member_added'
  | 'member_removed'
  | 'contribution_recorded'
  | 'payout_initiated'
  | 'payout_failed';

const PAYOUT_METHOD_MAP: Record<string, string> = {
  telebirr: 'mobile_wallet',
  direct_transfer: 'bank_account',
  cash_pickup: 'cash_pickup',
};

function circlesCollection(userId: string) {
  return collection(db, 'users', userId, 'family_circles');
}

function contributionsCollection(userId: string) {
  return collection(db, 'users', userId, 'circle_contributions');
}

function circleDoc(userId: string, circleId: string) {
  return doc(db, 'users', userId, 'family_circles', circleId);
}

function auditCollection(userId: string) {
  return collection(db, 'users', userId, 'circle_audit_log');
}

async function addAuditLog(
  userId: string,
  action: AuditAction,
  circleId: string | undefined,
  details: Record<string, any>
): Promise<void> {
  try {
    await addDoc(auditCollection(userId), {
      action,
      circleId: circleId || null,
      details,
      timestamp: serverTimestamp(),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('Failed to write circle audit log:', error);
  }
}

async function getLocalCircles(): Promise<FamilyCircle[]> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_CIRCLES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

async function saveLocalCircles(circles: FamilyCircle[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_CIRCLES_KEY, JSON.stringify(circles));
}

async function getLocalContributions(): Promise<CircleContribution[]> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_CONTRIBUTIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

async function saveLocalContributions(contributions: CircleContribution[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_CONTRIBUTIONS_KEY, JSON.stringify(contributions));
}

function getCurrentPeriod(frequency: 'monthly' | 'quarterly'): string {
  const now = new Date();
  const year = now.getFullYear();
  if (frequency === 'monthly') {
    return `${year}_${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  return `${year}_Q${quarter}`;
}

class FamilyCircleService {
  private useLocalFallback = false;
  private offlineMode = false;

  private enableFallback(): void {
    if (IS_DEV) {
      if (!this.useLocalFallback) {
        console.warn('Firestore unavailable for family circles — using local fallback (dev mode)');
        this.useLocalFallback = true;
      }
    } else {
      this.offlineMode = true;
    }
  }

  isOffline(): boolean {
    return this.offlineMode && !IS_DEV;
  }

  async createCircle(
    userId: string,
    data: Omit<FamilyCircle, 'id' | 'createdAt' | 'updatedAt' | 'totalContributed'>
  ): Promise<FamilyCircle> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    const now = new Date().toISOString();
    const circleData = {
      ...data,
      userId,
      totalContributed: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (this.useLocalFallback || !userId) {
      const localCircles = await getLocalCircles();
      const newCircle: FamilyCircle = {
        ...circleData,
        id: `circle_${Date.now()}`,
      };
      localCircles.unshift(newCircle);
      await saveLocalCircles(localCircles);
      return newCircle;
    }

    try {
      const docRef = await addDoc(circlesCollection(userId), circleData);
      const newCircle: FamilyCircle = { ...circleData, id: docRef.id };

      await addAuditLog(userId, 'circle_created', docRef.id, {
        name: data.name,
        beneficiary: data.beneficiary.name,
        totalTarget: data.totalTarget,
        currency: data.currency,
        frequency: data.frequency,
        memberCount: data.members.length,
      });

      return newCircle;
    } catch (error) {
      console.error('Firestore createCircle failed:', error);
      this.enableFallback();
      if (!IS_DEV) throw new Error('OFFLINE');
      const localCircles = await getLocalCircles();
      const newCircle: FamilyCircle = {
        ...circleData,
        id: `circle_${Date.now()}`,
      };
      localCircles.unshift(newCircle);
      await saveLocalCircles(localCircles);
      return newCircle;
    }
  }

  async getCircles(userId: string): Promise<FamilyCircle[]> {
    if (this.useLocalFallback || !userId) {
      if (!IS_DEV && this.offlineMode) return [];
      return getLocalCircles();
    }

    try {
      const q = query(circlesCollection(userId), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as FamilyCircle));
    } catch (error) {
      console.error('Firestore getCircles failed:', error);
      this.enableFallback();
      if (!IS_DEV) return [];
      return getLocalCircles();
    }
  }

  async updateCircle(
    userId: string,
    circleId: string,
    data: Partial<FamilyCircle>
  ): Promise<FamilyCircle> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    if (this.useLocalFallback) {
      const localCircles = await getLocalCircles();
      const idx = localCircles.findIndex((c) => c.id === circleId);
      if (idx === -1) throw new Error('Circle not found');
      localCircles[idx] = {
        ...localCircles[idx],
        ...data,
        updatedAt: new Date().toISOString(),
      };
      await saveLocalCircles(localCircles);
      return localCircles[idx];
    }

    try {
      const ref = circleDoc(userId, circleId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Circle not found');

      const updates = {
        ...data,
        updatedAt: new Date().toISOString(),
      };
      delete (updates as any).id;
      await updateDoc(ref, updates);

      const updated = { ...snap.data(), ...updates, id: circleId } as FamilyCircle;

      await addAuditLog(userId, 'circle_updated', circleId, {
        updatedFields: Object.keys(data),
      });

      return updated;
    } catch (error: any) {
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore updateCircle failed:', error);
        this.enableFallback();
        if (!IS_DEV) throw new Error('OFFLINE');
        return this.updateCircle(userId, circleId, data);
      }
      throw error;
    }
  }

  async addMember(
    userId: string,
    circleId: string,
    member: Omit<CircleMember, 'id' | 'joinedAt' | 'status'>
  ): Promise<FamilyCircle> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    const newMember: CircleMember = {
      ...member,
      id: `member_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'active',
      joinedAt: new Date().toISOString(),
    };

    if (this.useLocalFallback) {
      const localCircles = await getLocalCircles();
      const idx = localCircles.findIndex((c) => c.id === circleId);
      if (idx === -1) throw new Error('Circle not found');
      localCircles[idx].members.push(newMember);
      localCircles[idx].updatedAt = new Date().toISOString();
      await saveLocalCircles(localCircles);
      return localCircles[idx];
    }

    try {
      const ref = circleDoc(userId, circleId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Circle not found');

      const circle = { ...snap.data(), id: circleId } as FamilyCircle;
      const updatedMembers = [...circle.members, newMember];

      await updateDoc(ref, {
        members: updatedMembers,
        updatedAt: new Date().toISOString(),
      });

      await addAuditLog(userId, 'member_added', circleId, {
        memberName: member.name,
        location: member.location,
        amount: member.amount,
        currency: member.currency,
      });

      return { ...circle, members: updatedMembers, updatedAt: new Date().toISOString() };
    } catch (error: any) {
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore addMember failed:', error);
        this.enableFallback();
        if (!IS_DEV) throw new Error('OFFLINE');
        return this.addMember(userId, circleId, member);
      }
      throw error;
    }
  }

  async removeMember(
    userId: string,
    circleId: string,
    memberId: string
  ): Promise<FamilyCircle> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    if (this.useLocalFallback) {
      const localCircles = await getLocalCircles();
      const idx = localCircles.findIndex((c) => c.id === circleId);
      if (idx === -1) throw new Error('Circle not found');
      const memberIdx = localCircles[idx].members.findIndex((m) => m.id === memberId);
      if (memberIdx === -1) throw new Error('Member not found');
      const removedName = localCircles[idx].members[memberIdx].name;
      localCircles[idx].members[memberIdx].status = 'left';
      localCircles[idx].updatedAt = new Date().toISOString();
      await saveLocalCircles(localCircles);
      return localCircles[idx];
    }

    try {
      const ref = circleDoc(userId, circleId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Circle not found');

      const circle = { ...snap.data(), id: circleId } as FamilyCircle;
      const memberIdx = circle.members.findIndex((m) => m.id === memberId);
      if (memberIdx === -1) throw new Error('Member not found');

      const removedName = circle.members[memberIdx].name;
      const updatedMembers = circle.members.map((m) =>
        m.id === memberId ? { ...m, status: 'left' as const } : m
      );

      await updateDoc(ref, {
        members: updatedMembers,
        updatedAt: new Date().toISOString(),
      });

      await addAuditLog(userId, 'member_removed', circleId, {
        memberId,
        memberName: removedName,
      });

      return { ...circle, members: updatedMembers, updatedAt: new Date().toISOString() };
    } catch (error: any) {
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore removeMember failed:', error);
        this.enableFallback();
        if (!IS_DEV) throw new Error('OFFLINE');
        return this.removeMember(userId, circleId, memberId);
      }
      throw error;
    }
  }

  async recordContribution(
    userId: string,
    data: Omit<CircleContribution, 'id' | 'createdAt'>
  ): Promise<CircleContribution> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    const now = new Date().toISOString();
    const contributionData = {
      ...data,
      createdAt: now,
    };

    if (this.useLocalFallback || !userId) {
      const localContributions = await getLocalContributions();
      const newContribution: CircleContribution = {
        ...contributionData,
        id: `contrib_${Date.now()}`,
      };
      localContributions.unshift(newContribution);
      await saveLocalContributions(localContributions);

      const localCircles = await getLocalCircles();
      const circleIdx = localCircles.findIndex((c) => c.id === data.circleId);
      if (circleIdx !== -1) {
        localCircles[circleIdx].totalContributed += data.amount;
        localCircles[circleIdx].updatedAt = now;
        await saveLocalCircles(localCircles);
      }

      return newContribution;
    }

    try {
      const docRef = await addDoc(contributionsCollection(userId), contributionData);
      const newContribution: CircleContribution = { ...contributionData, id: docRef.id };

      const circleRef = circleDoc(userId, data.circleId);
      const circleSnap = await getDoc(circleRef);
      if (circleSnap.exists()) {
        const circle = circleSnap.data() as FamilyCircle;
        await updateDoc(circleRef, {
          totalContributed: (circle.totalContributed || 0) + data.amount,
          updatedAt: now,
        });
      }

      await addAuditLog(userId, 'contribution_recorded', data.circleId, {
        contributionId: docRef.id,
        memberName: data.memberName,
        amount: data.amount,
        currency: data.currency,
        period: data.period,
        status: data.status,
      });

      return newContribution;
    } catch (error) {
      console.error('Firestore recordContribution failed:', error);
      this.enableFallback();
      if (!IS_DEV) throw new Error('OFFLINE');
      const localContributions = await getLocalContributions();
      const newContribution: CircleContribution = {
        ...contributionData,
        id: `contrib_${Date.now()}`,
      };
      localContributions.unshift(newContribution);
      await saveLocalContributions(localContributions);
      return newContribution;
    }
  }

  async getContributions(userId: string, circleId?: string): Promise<CircleContribution[]> {
    if (this.useLocalFallback || !userId) {
      if (!IS_DEV && this.offlineMode) return [];
      const all = await getLocalContributions();
      if (circleId) {
        return all.filter((c) => c.circleId === circleId);
      }
      return all;
    }

    try {
      const q = query(contributionsCollection(userId), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const all = snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as CircleContribution));
      if (circleId) {
        return all.filter((c) => c.circleId === circleId);
      }
      return all;
    } catch (error) {
      console.error('Firestore getContributions failed:', error);
      this.enableFallback();
      if (!IS_DEV) return [];
      const all = await getLocalContributions();
      if (circleId) {
        return all.filter((c) => c.circleId === circleId);
      }
      return all;
    }
  }

  async processCirclePayout(userId: string, circleId: string): Promise<{ success: boolean; error?: string }> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    let circle: FamilyCircle | undefined;

    if (this.useLocalFallback) {
      const localCircles = await getLocalCircles();
      circle = localCircles.find((c) => c.id === circleId);
    } else {
      try {
        const ref = circleDoc(userId, circleId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          circle = { ...snap.data(), id: circleId } as FamilyCircle;
        }
      } catch (error) {
        console.error('Failed to get circle for payout:', error);
        this.enableFallback();
        if (!IS_DEV) throw new Error('OFFLINE');
        const localCircles = await getLocalCircles();
        circle = localCircles.find((c) => c.id === circleId);
      }
    }

    if (!circle) {
      throw new Error('Circle not found');
    }

    const period = getCurrentPeriod(circle.frequency);
    const contributions = await this.getContributions(userId, circleId);
    const activeMembers = circle.members.filter((m) => m.status === 'active');
    const periodContributions = contributions.filter(
      (c) => c.period === period && c.status === 'sent'
    );

    const allContributed = activeMembers.every((member) =>
      periodContributions.some((c) => c.memberId === member.id)
    );

    if (!allContributed) {
      return { success: false, error: 'Not all members have contributed for this period' };
    }

    try {
      await remittanceApi.initiateTransfer({
        userId,
        recipientId: circle.id,
        amount: circle.totalTarget,
        currency: circle.currency,
        payout_method: circle.beneficiary.payoutMethod === 'cash_pickup'
          ? 'agent_cash'
          : PAYOUT_METHOD_MAP[circle.beneficiary.payoutMethod] || 'mobile_money',
      });

      const nextDate = new Date();
      if (circle.frequency === 'monthly') {
        nextDate.setMonth(nextDate.getMonth() + 1, 1);
      } else {
        nextDate.setMonth(nextDate.getMonth() + 3, 1);
      }

      await this.updateCircle(userId, circleId, {
        nextPayoutDate: nextDate.toISOString(),
      });

      await addAuditLog(userId, 'payout_initiated', circleId, {
        beneficiary: circle.beneficiary.name,
        amount: circle.totalTarget,
        currency: circle.currency,
        period,
        payoutMethod: circle.beneficiary.payoutMethod,
      });

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Payout failed';

      await addAuditLog(userId, 'payout_failed', circleId, {
        beneficiary: circle.beneficiary.name,
        amount: circle.totalTarget,
        currency: circle.currency,
        period,
        error: errorMsg,
      });

      return { success: false, error: errorMsg };
    }
  }
}

export const familyCircleService = new FamilyCircleService();

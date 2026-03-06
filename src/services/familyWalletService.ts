import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FamilyMember, FamilyWallet, MonthlyAllocation } from '../types';

const STORAGE_KEY = 'family_wallet_members';
const SENT_KEY = 'family_wallet_sent';

const getNextPayoutDate = (): string => {
  const date = new Date();
  date.setMonth(date.getMonth() + 1, 1);
  return date.toISOString();
};

const SEED_MEMBERS: FamilyMember[] = [
  {
    id: 'fm_1',
    userId: '1',
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
    id: 'fm_2',
    userId: '1',
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
    id: 'fm_3',
    userId: '1',
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

class FamilyWalletService {
  private async getMembers(): Promise<FamilyMember[]> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_MEMBERS));
      return SEED_MEMBERS;
    } catch (error) {
      console.error('Failed to get family members:', error);
      return SEED_MEMBERS;
    }
  }

  private async saveMembers(members: FamilyMember[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(members));
  }

  async getFamilyWallet(): Promise<FamilyWallet> {
    const members = await this.getMembers();
    const totalMonthlyBudget = members
      .filter(m => m.status === 'active')
      .reduce((sum, m) => sum + m.monthlyAmount, 0);

    return {
      id: 'fw_1',
      userId: '1',
      members,
      totalMonthlyBudget,
      currency: 'USD',
      createdAt: members.length > 0 ? members[0].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async getFamilyMembers(): Promise<FamilyMember[]> {
    return this.getMembers();
  }

  async addFamilyMember(data: Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>): Promise<FamilyMember> {
    const members = await this.getMembers();
    const now = new Date().toISOString();
    const newMember: FamilyMember = {
      ...data,
      id: `fm_${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    };
    members.push(newMember);
    await this.saveMembers(members);
    return newMember;
  }

  async updateFamilyMember(id: string, data: Partial<FamilyMember>): Promise<FamilyMember> {
    const members = await this.getMembers();
    const index = members.findIndex(m => m.id === id);
    if (index === -1) {
      throw new Error('Family member not found');
    }
    members[index] = {
      ...members[index],
      ...data,
      id,
      updatedAt: new Date().toISOString(),
    };
    await this.saveMembers(members);
    return members[index];
  }

  async deleteFamilyMember(id: string): Promise<void> {
    const members = await this.getMembers();
    const filtered = members.filter(m => m.id !== id);
    if (filtered.length === members.length) {
      throw new Error('Family member not found');
    }
    await this.saveMembers(filtered);
  }

  async toggleMemberStatus(id: string): Promise<FamilyMember> {
    const members = await this.getMembers();
    const member = members.find(m => m.id === id);
    if (!member) {
      throw new Error('Family member not found');
    }
    member.status = member.status === 'active' ? 'paused' : 'active';
    member.updatedAt = new Date().toISOString();
    await this.saveMembers(members);
    return member;
  }

  async sendFamilySupport(memberId: string): Promise<MonthlyAllocation> {
    const members = await this.getMembers();
    const member = members.find(m => m.id === memberId);
    if (!member) {
      throw new Error('Family member not found');
    }

    const allocation: MonthlyAllocation = {
      memberId: member.id,
      memberName: member.name,
      amount: member.monthlyAmount,
      currency: member.currency,
      status: 'sent',
      sentAt: new Date().toISOString(),
    };

    const sentKey = `${SENT_KEY}_${new Date().getFullYear()}_${new Date().getMonth()}`;
    try {
      const stored = await AsyncStorage.getItem(sentKey);
      const sentList: MonthlyAllocation[] = stored ? JSON.parse(stored) : [];
      sentList.push(allocation);
      await AsyncStorage.setItem(sentKey, JSON.stringify(sentList));
    } catch (error) {
      console.error('Failed to record sent support:', error);
    }

    member.nextPayoutDate = getNextPayoutDate();
    member.updatedAt = new Date().toISOString();
    await this.saveMembers(members);

    return allocation;
  }

  async getSentThisMonth(): Promise<MonthlyAllocation[]> {
    const sentKey = `${SENT_KEY}_${new Date().getFullYear()}_${new Date().getMonth()}`;
    try {
      const stored = await AsyncStorage.getItem(sentKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to get sent allocations:', error);
      return [];
    }
  }
}

export const familyWalletService = new FamilyWalletService();

import AsyncStorage from '@react-native-async-storage/async-storage';
import { clientRiskService } from './riskControls/clientRiskService';

interface ReferralInfo {
  referralCode: string;
  referralLink: string;
  totalReferrals: number;
  successfulReferrals: number;
  pendingReferrals: number;
  totalEarnings: number;
  currency: string;
}

interface Referral {
  id: string;
  referredEmail: string;
  referredName: string;
  status: 'pending' | 'completed' | 'expired';
  earnedAmount: number;
  currency: string;
  createdAt: string;
  completedAt?: string;
}

interface LoyaltyTier {
  id: string;
  name: string;
  minPoints: number;
  benefits: string[];
  color: string;
}

interface LoyaltyPoints {
  totalPoints: number;
  availablePoints: number;
  pendingPoints: number;
  currentTier: LoyaltyTier;
  nextTier: LoyaltyTier | null;
  pointsToNextTier: number;
}

interface RepeatBonus {
  id: string;
  name: string;
  description: string;
  requiredTransactions: number;
  currentProgress: number;
  bonusType: 'percentage' | 'fixed' | 'points';
  bonusValue: number;
  currency?: string;
  expiresAt?: string;
  isComplete: boolean;
}

interface PointsTransaction {
  id: string;
  type: 'earned' | 'redeemed' | 'expired';
  amount: number;
  description: string;
  createdAt: string;
}

const LOYALTY_TIERS: LoyaltyTier[] = [
  {
    id: 'bronze',
    name: 'Bronze',
    minPoints: 0,
    benefits: ['Standard transfer fees', 'Basic support'],
    color: '#CD7F32',
  },
  {
    id: 'silver',
    name: 'Silver',
    minPoints: 500,
    benefits: ['10% fee discount', 'Priority support', 'Birthday bonus'],
    color: '#C0C0C0',
  },
  {
    id: 'gold',
    name: 'Gold',
    minPoints: 2000,
    benefits: ['25% fee discount', 'Dedicated support', 'Monthly bonus', 'Higher limits'],
    color: '#FFD700',
  },
  {
    id: 'platinum',
    name: 'Platinum',
    minPoints: 5000,
    benefits: ['50% fee discount', 'VIP support', 'Weekly bonus', 'No transfer limits', 'Exclusive rates'],
    color: '#E5E4E2',
  },
];

const REFERRAL_REWARD_AMOUNT = 10;
const REFERRAL_REWARD_CURRENCY = 'USD';
const POINTS_PER_DOLLAR = 1;

class LoyaltyService {
  private readonly REFERRAL_KEY = 'referral_info';
  private readonly POINTS_KEY = 'loyalty_points';
  private readonly BONUSES_KEY = 'repeat_bonuses';
  private readonly HISTORY_KEY = 'points_history';

  async getReferralInfo(userId: number): Promise<ReferralInfo> {
    try {
      const stored = await AsyncStorage.getItem(`${this.REFERRAL_KEY}_${userId}`);
      if (stored) {
        return JSON.parse(stored);
      }

      const referralCode = this.generateReferralCode(userId);
      const defaultInfo: ReferralInfo = {
        referralCode,
        referralLink: `https://habeshare.com/ref/${referralCode}`,
        totalReferrals: 0,
        successfulReferrals: 0,
        pendingReferrals: 0,
        totalEarnings: 0,
        currency: REFERRAL_REWARD_CURRENCY,
      };
      await AsyncStorage.setItem(`${this.REFERRAL_KEY}_${userId}`, JSON.stringify(defaultInfo));
      return defaultInfo;
    } catch (error) {
      console.error('Failed to get referral info:', error);
      throw error;
    }
  }

  private generateReferralCode(userId: number): string {
    const prefix = 'HS';
    const userPart = userId.toString().padStart(4, '0').slice(-4);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}${userPart}${random}`;
  }

  async getReferrals(userId: number): Promise<Referral[]> {
    try {
      const stored = await AsyncStorage.getItem(`referrals_${userId}`);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to get referrals:', error);
      return [];
    }
  }

  async submitReferral(userId: number, referredEmail: string, referredName: string): Promise<Referral> {
    try {
      const referral: Referral = {
        id: `ref_${Date.now()}`,
        referredEmail,
        referredName,
        status: 'pending',
        earnedAmount: 0,
        currency: REFERRAL_REWARD_CURRENCY,
        createdAt: new Date().toISOString(),
      };

      const referrals = await this.getReferrals(userId);
      referrals.unshift(referral);
      await AsyncStorage.setItem(`referrals_${userId}`, JSON.stringify(referrals));

      const info = await this.getReferralInfo(userId);
      info.totalReferrals += 1;
      info.pendingReferrals += 1;
      await AsyncStorage.setItem(`${this.REFERRAL_KEY}_${userId}`, JSON.stringify(info));

      return referral;
    } catch (error) {
      console.error('Failed to submit referral:', error);
      throw error;
    }
  }

  async completeReferral(userId: number, referralId: string): Promise<void> {
    // ── Risk Controls Layer ────────────────────────────────────────────────
    try {
      await clientRiskService.runReferralRewardChecks(String(userId));
    } catch (riskErr: any) {
      console.warn(`[LoyaltyService] Referral reward blocked by risk controls: ${riskErr.message}`);
      throw riskErr;
    }
    // ──────────────────────────────────────────────────────────────────────
    try {
      const referrals = await this.getReferrals(userId);
      const referral = referrals.find(r => r.id === referralId);
      
      if (referral && referral.status === 'pending') {
        referral.status = 'completed';
        referral.earnedAmount = REFERRAL_REWARD_AMOUNT;
        referral.completedAt = new Date().toISOString();
        await AsyncStorage.setItem(`referrals_${userId}`, JSON.stringify(referrals));

        const info = await this.getReferralInfo(userId);
        info.successfulReferrals += 1;
        info.pendingReferrals -= 1;
        info.totalEarnings += REFERRAL_REWARD_AMOUNT;
        await AsyncStorage.setItem(`${this.REFERRAL_KEY}_${userId}`, JSON.stringify(info));

        await this.addPoints(userId, 100, 'Referral bonus');
      }
    } catch (error) {
      console.error('Failed to complete referral:', error);
    }
  }

  async getLoyaltyPoints(userId: number): Promise<LoyaltyPoints> {
    try {
      const stored = await AsyncStorage.getItem(`${this.POINTS_KEY}_${userId}`);
      if (stored) {
        const data = JSON.parse(stored);
        return this.calculateTierInfo(data);
      }

      const defaultPoints = {
        totalPoints: 0,
        availablePoints: 0,
        pendingPoints: 0,
      };
      await AsyncStorage.setItem(`${this.POINTS_KEY}_${userId}`, JSON.stringify(defaultPoints));
      return this.calculateTierInfo(defaultPoints);
    } catch (error) {
      console.error('Failed to get loyalty points:', error);
      throw error;
    }
  }

  private calculateTierInfo(data: { totalPoints: number; availablePoints: number; pendingPoints: number }): LoyaltyPoints {
    let currentTier = LOYALTY_TIERS[0];
    let nextTier: LoyaltyTier | null = LOYALTY_TIERS[1];

    for (let i = LOYALTY_TIERS.length - 1; i >= 0; i--) {
      if (data.totalPoints >= LOYALTY_TIERS[i].minPoints) {
        currentTier = LOYALTY_TIERS[i];
        nextTier = LOYALTY_TIERS[i + 1] || null;
        break;
      }
    }

    const pointsToNextTier = nextTier ? nextTier.minPoints - data.totalPoints : 0;

    return {
      ...data,
      currentTier,
      nextTier,
      pointsToNextTier,
    };
  }

  async addPoints(userId: number, points: number, description: string): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(`${this.POINTS_KEY}_${userId}`);
      const data = stored ? JSON.parse(stored) : { totalPoints: 0, availablePoints: 0, pendingPoints: 0 };
      
      data.totalPoints += points;
      data.availablePoints += points;
      await AsyncStorage.setItem(`${this.POINTS_KEY}_${userId}`, JSON.stringify(data));

      await this.addPointsTransaction(userId, {
        id: `pt_${Date.now()}`,
        type: 'earned',
        amount: points,
        description,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to add points:', error);
    }
  }

  async redeemPoints(userId: number, points: number, description: string): Promise<boolean> {
    try {
      const data = await this.getLoyaltyPoints(userId);
      if (data.availablePoints < points) {
        return false;
      }

      const stored = await AsyncStorage.getItem(`${this.POINTS_KEY}_${userId}`);
      const pointsData = stored ? JSON.parse(stored) : { totalPoints: 0, availablePoints: 0, pendingPoints: 0 };
      
      pointsData.availablePoints -= points;
      await AsyncStorage.setItem(`${this.POINTS_KEY}_${userId}`, JSON.stringify(pointsData));

      await this.addPointsTransaction(userId, {
        id: `pt_${Date.now()}`,
        type: 'redeemed',
        amount: -points,
        description,
        createdAt: new Date().toISOString(),
      });

      return true;
    } catch (error) {
      console.error('Failed to redeem points:', error);
      return false;
    }
  }

  private async addPointsTransaction(userId: number, transaction: PointsTransaction): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(`${this.HISTORY_KEY}_${userId}`);
      const history: PointsTransaction[] = stored ? JSON.parse(stored) : [];
      history.unshift(transaction);
      
      const limitedHistory = history.slice(0, 100);
      await AsyncStorage.setItem(`${this.HISTORY_KEY}_${userId}`, JSON.stringify(limitedHistory));
    } catch (error) {
      console.error('Failed to add points transaction:', error);
    }
  }

  async getPointsHistory(userId: number): Promise<PointsTransaction[]> {
    try {
      const stored = await AsyncStorage.getItem(`${this.HISTORY_KEY}_${userId}`);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to get points history:', error);
      return [];
    }
  }

  async getRepeatBonuses(userId: number): Promise<RepeatBonus[]> {
    const defaultBonuses: RepeatBonus[] = [
      {
        id: 'monthly_3',
        name: 'Monthly Sender',
        description: 'Send 3 transfers this month',
        requiredTransactions: 3,
        currentProgress: 0,
        bonusType: 'percentage',
        bonusValue: 5,
        expiresAt: this.getEndOfMonth(),
        isComplete: false,
      },
      {
        id: 'quarterly_10',
        name: 'Loyal Customer',
        description: 'Complete 10 transfers this quarter',
        requiredTransactions: 10,
        currentProgress: 0,
        bonusType: 'fixed',
        bonusValue: 15,
        currency: 'USD',
        expiresAt: this.getEndOfQuarter(),
        isComplete: false,
      },
      {
        id: 'streak_5',
        name: 'Streak Master',
        description: 'Send money 5 weeks in a row',
        requiredTransactions: 5,
        currentProgress: 0,
        bonusType: 'points',
        bonusValue: 500,
        isComplete: false,
      },
    ];

    try {
      const stored = await AsyncStorage.getItem(`${this.BONUSES_KEY}_${userId}`);
      return stored ? JSON.parse(stored) : defaultBonuses;
    } catch (error) {
      console.error('Failed to get repeat bonuses:', error);
      return defaultBonuses;
    }
  }

  async recordTransaction(userId: number, amount: number): Promise<void> {
    try {
      const pointsToAdd = Math.floor(amount * POINTS_PER_DOLLAR);
      if (pointsToAdd > 0) {
        await this.addPoints(userId, pointsToAdd, `Transaction reward: $${amount}`);
      }

      const bonuses = await this.getRepeatBonuses(userId);
      let updated = false;
      for (const bonus of bonuses) {
        if (!bonus.isComplete) {
          bonus.currentProgress += 1;
          if (bonus.currentProgress >= bonus.requiredTransactions) {
            bonus.isComplete = true;
            await this.processBonusCompletion(userId, bonus);
          }
          updated = true;
        }
      }
      if (updated) {
        await AsyncStorage.setItem(`${this.BONUSES_KEY}_${userId}`, JSON.stringify(bonuses));
      }
    } catch (error) {
      console.error('Failed to record transaction:', error);
    }
  }

  private async processBonusCompletion(userId: number, bonus: RepeatBonus): Promise<void> {
    if (bonus.bonusType === 'points') {
      await this.addPoints(userId, bonus.bonusValue, `Bonus: ${bonus.name}`);
    }
    console.log(`Bonus completed for user ${userId}:`, bonus.name);
  }

  private getEndOfMonth(): string {
    const date = new Date();
    date.setMonth(date.getMonth() + 1, 0);
    date.setHours(23, 59, 59, 999);
    return date.toISOString();
  }

  private getEndOfQuarter(): string {
    const date = new Date();
    const quarter = Math.floor(date.getMonth() / 3);
    date.setMonth((quarter + 1) * 3, 0);
    date.setHours(23, 59, 59, 999);
    return date.toISOString();
  }

  getLoyaltyTiers(): LoyaltyTier[] {
    return LOYALTY_TIERS;
  }
}

export const loyaltyService = new LoyaltyService();
export type { ReferralInfo, Referral, LoyaltyTier, LoyaltyPoints, RepeatBonus, PointsTransaction };

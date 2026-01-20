import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Transaction } from '../types';

interface SpendingSummary {
  totalSent: number;
  totalReceived: number;
  totalFees: number;
  netFlow: number;
  currency: string;
  period: string;
}

interface CategoryBreakdown {
  category: string;
  amount: number;
  percentage: number;
  count: number;
  color: string;
}

interface RecipientStats {
  name: string;
  country: string;
  totalSent: number;
  currency: string;
  transactionCount: number;
}

interface MonthlyTrend {
  month: string;
  year: number;
  sent: number;
  received: number;
  currency: string;
}

interface InsightCard {
  id: string;
  type: 'achievement' | 'tip' | 'stat' | 'milestone';
  title: string;
  description: string;
  value?: string;
  icon: string;
  color: string;
}

interface UserInsights {
  summary: SpendingSummary;
  categoryBreakdown: CategoryBreakdown[];
  topRecipients: RecipientStats[];
  monthlyTrends: MonthlyTrend[];
  insights: InsightCard[];
  lastUpdated: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  remittance: '#00A651',
  bill_payment: '#3B82F6',
  transfer: '#8B5CF6',
  deposit: '#10B981',
  withdrawal: '#F59E0B',
  other: '#6B7280',
};

class InsightsService {
  private readonly CACHE_KEY = 'insights_cache';

  async calculateInsights(transactions: Transaction[], userId: number): Promise<UserInsights> {
    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth();

    const yearTransactions = transactions.filter(t => {
      const date = new Date(t.createdAt);
      return date.getFullYear() === thisYear && t.status === 'completed';
    });

    const summary = this.calculateSpendingSummary(yearTransactions, 'USD', `${thisYear}`);
    const categoryBreakdown = this.calculateCategoryBreakdown(yearTransactions);
    const topRecipients = this.calculateTopRecipients(yearTransactions);
    const monthlyTrends = this.calculateMonthlyTrends(yearTransactions, thisYear);
    const insights = this.generateInsightCards(summary, categoryBreakdown, yearTransactions, topRecipients);

    const result: UserInsights = {
      summary,
      categoryBreakdown,
      topRecipients,
      monthlyTrends,
      insights,
      lastUpdated: now.toISOString(),
    };

    await this.cacheInsights(userId, result);
    return result;
  }

  private calculateSpendingSummary(transactions: Transaction[], currency: string, period: string): SpendingSummary {
    let totalSent = 0;
    let totalReceived = 0;
    let totalFees = 0;

    for (const t of transactions) {
      const amount = parseFloat(t.amount);
      if (t.type === 'deposit') {
        totalReceived += amount;
      } else if (['withdrawal', 'transfer', 'remittance', 'payment'].includes(t.type)) {
        totalSent += amount;
        totalFees += amount * 0.02;
      }
    }

    return {
      totalSent,
      totalReceived,
      totalFees: Math.round(totalFees * 100) / 100,
      netFlow: totalReceived - totalSent,
      currency,
      period,
    };
  }

  private calculateCategoryBreakdown(transactions: Transaction[]): CategoryBreakdown[] {
    const categories: Record<string, { amount: number; count: number }> = {};
    let total = 0;

    for (const t of transactions) {
      const amount = parseFloat(t.amount);
      const category = t.type || 'other';
      
      if (!categories[category]) {
        categories[category] = { amount: 0, count: 0 };
      }
      categories[category].amount += amount;
      categories[category].count += 1;
      total += amount;
    }

    return Object.entries(categories)
      .map(([category, data]) => ({
        category: this.formatCategoryName(category),
        amount: Math.round(data.amount * 100) / 100,
        percentage: total > 0 ? Math.round((data.amount / total) * 100) : 0,
        count: data.count,
        color: CATEGORY_COLORS[category] || CATEGORY_COLORS.other,
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  private formatCategoryName(category: string): string {
    const names: Record<string, string> = {
      remittance: 'Remittances',
      bill_payment: 'Bill Payments',
      transfer: 'Transfers',
      deposit: 'Deposits',
      withdrawal: 'Withdrawals',
    };
    return names[category] || category.charAt(0).toUpperCase() + category.slice(1);
  }

  private calculateTopRecipients(transactions: Transaction[]): RecipientStats[] {
    const recipients: Record<string, RecipientStats> = {};

    const remittances = transactions.filter(t => 
      t.type === 'remittance' && t.recipientName
    );

    for (const t of remittances) {
      const key = t.recipientName!;
      if (!recipients[key]) {
        recipients[key] = {
          name: t.recipientName!,
          country: t.recipientCountry || 'Ethiopia',
          totalSent: 0,
          currency: t.currency,
          transactionCount: 0,
        };
      }
      recipients[key].totalSent += parseFloat(t.amount);
      recipients[key].transactionCount += 1;
    }

    return Object.values(recipients)
      .sort((a, b) => b.totalSent - a.totalSent)
      .slice(0, 5);
  }

  private calculateMonthlyTrends(transactions: Transaction[], year: number): MonthlyTrend[] {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: new Date(year, i).toLocaleString('default', { month: 'short' }),
      year,
      sent: 0,
      received: 0,
      currency: 'USD',
    }));

    for (const t of transactions) {
      const date = new Date(t.createdAt);
      const monthIndex = date.getMonth();
      const amount = parseFloat(t.amount);

      if (t.type === 'deposit') {
        months[monthIndex].received += amount;
      } else {
        months[monthIndex].sent += amount;
      }
    }

    return months.map(m => ({
      ...m,
      sent: Math.round(m.sent * 100) / 100,
      received: Math.round(m.received * 100) / 100,
    }));
  }

  private generateInsightCards(
    summary: SpendingSummary,
    categories: CategoryBreakdown[],
    transactions: Transaction[],
    recipients: RecipientStats[]
  ): InsightCard[] {
    const insights: InsightCard[] = [];

    if (summary.totalSent > 0) {
      insights.push({
        id: 'yearly_total',
        type: 'stat',
        title: `You've sent $${summary.totalSent.toLocaleString()} this year`,
        description: 'Keep supporting your loved ones!',
        value: `$${summary.totalSent.toLocaleString()}`,
        icon: 'trending-up',
        color: '#00A651',
      });
    }

    if (transactions.length >= 10) {
      insights.push({
        id: 'active_user',
        type: 'achievement',
        title: 'Active User',
        description: `You've completed ${transactions.length} transactions this year!`,
        icon: 'star',
        color: '#FFD700',
      });
    }

    if (summary.totalSent >= 1000) {
      insights.push({
        id: 'milestone_1k',
        type: 'milestone',
        title: 'Milestone Reached!',
        description: "You've sent over $1,000 to Ethiopia",
        icon: 'trophy',
        color: '#8B5CF6',
      });
    }

    if (recipients.length > 0) {
      const topRecipient = recipients[0];
      insights.push({
        id: 'top_recipient',
        type: 'stat',
        title: `Top recipient: ${topRecipient.name}`,
        description: `You've sent $${topRecipient.totalSent.toLocaleString()} to ${topRecipient.name}`,
        icon: 'heart',
        color: '#EF4444',
      });
    }

    const remittanceCategory = categories.find(c => c.category === 'Remittances');
    if (remittanceCategory && remittanceCategory.percentage > 50) {
      insights.push({
        id: 'remittance_tip',
        type: 'tip',
        title: 'Remittance Pro Tip',
        description: 'Schedule recurring transfers to save time and never miss a payment!',
        icon: 'bulb',
        color: '#3B82F6',
      });
    }

    if (summary.totalFees > 0) {
      insights.push({
        id: 'fees_saved',
        type: 'tip',
        title: 'Save on Fees',
        description: 'Upgrade to Gold tier to get 25% off on transfer fees!',
        icon: 'cash',
        color: '#10B981',
      });
    }

    return insights;
  }

  private async cacheInsights(userId: number, insights: UserInsights): Promise<void> {
    try {
      await AsyncStorage.setItem(`${this.CACHE_KEY}_${userId}`, JSON.stringify(insights));
    } catch (error) {
      console.error('Failed to cache insights:', error);
    }
  }

  async getCachedInsights(userId: number): Promise<UserInsights | null> {
    try {
      const stored = await AsyncStorage.getItem(`${this.CACHE_KEY}_${userId}`);
      if (stored) {
        const insights = JSON.parse(stored);
        const lastUpdated = new Date(insights.lastUpdated);
        const hoursSinceUpdate = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceUpdate < 24) {
          return insights;
        }
      }
      return null;
    } catch (error) {
      console.error('Failed to get cached insights:', error);
      return null;
    }
  }

  formatCurrency(amount: number, currency: string = 'USD'): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  }
}

export const insightsService = new InsightsService();
export type { 
  SpendingSummary, 
  CategoryBreakdown, 
  RecipientStats, 
  MonthlyTrend, 
  InsightCard, 
  UserInsights 
};

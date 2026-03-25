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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clientRiskService } from './riskControls/clientRiskService';
import type { SupportCampaign, CampaignContribution, CampaignCategory } from '../types';

const LOCAL_CAMPAIGNS_KEY = 'support_campaigns_local';
const LOCAL_CONTRIBUTIONS_KEY = 'campaign_contributions_local';
const IS_DEV = __DEV__;

type AuditAction =
  | 'campaign_created'
  | 'campaign_updated'
  | 'campaign_cancelled'
  | 'campaign_completed'
  | 'contribution_recorded'
  | 'contribution_sent'
  | 'contribution_failed';

function campaignsRef() {
  return collection(db, 'support_campaigns');
}

function campaignDoc(campaignId: string) {
  return doc(db, 'support_campaigns', campaignId);
}

function contributionsRef() {
  return collection(db, 'campaign_contributions');
}

function auditCollection(campaignId: string) {
  return collection(db, 'support_campaigns', campaignId, 'campaign_audit_log');
}

async function addAuditLog(
  campaignId: string,
  action: AuditAction,
  details: Record<string, any>
): Promise<void> {
  try {
    await addDoc(auditCollection(campaignId), {
      action,
      campaignId,
      details,
      timestamp: serverTimestamp(),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('Failed to write campaign audit log:', error);
  }
}

async function getLocalCampaigns(): Promise<SupportCampaign[]> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_CAMPAIGNS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

async function saveLocalCampaigns(campaigns: SupportCampaign[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_CAMPAIGNS_KEY, JSON.stringify(campaigns));
}

async function getLocalContributions(): Promise<CampaignContribution[]> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_CONTRIBUTIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

async function saveLocalContributions(contributions: CampaignContribution[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_CONTRIBUTIONS_KEY, JSON.stringify(contributions));
}

class CampaignService {
  private useLocalFallback = false;
  private offlineMode = false;

  private enableFallback(): void {
    if (IS_DEV) {
      if (!this.useLocalFallback) {
        console.warn('Firestore unavailable for campaigns — using local fallback (dev mode)');
        this.useLocalFallback = true;
      }
    } else {
      this.offlineMode = true;
    }
  }

  isOffline(): boolean {
    return this.offlineMode && !IS_DEV;
  }

  async createCampaign(
    data: Omit<SupportCampaign, 'id' | 'createdAt' | 'updatedAt' | 'raisedAmount' | 'contributorCount' | 'status'>
  ): Promise<SupportCampaign> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    const now = new Date().toISOString();
    const campaignData = {
      ...data,
      raisedAmount: 0,
      contributorCount: 0,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    };

    if (this.useLocalFallback || !data.creatorId) {
      const localCampaigns = await getLocalCampaigns();
      const newCampaign: SupportCampaign = {
        ...campaignData,
        id: `campaign_${Date.now()}`,
      };
      localCampaigns.unshift(newCampaign);
      await saveLocalCampaigns(localCampaigns);
      return newCampaign;
    }

    try {
      const docRef = await addDoc(campaignsRef(), campaignData);
      const newCampaign: SupportCampaign = { ...campaignData, id: docRef.id };

      await addAuditLog(docRef.id, 'campaign_created', {
        title: data.title,
        category: data.category,
        beneficiary: data.beneficiary,
        goalAmount: data.goalAmount,
        currency: data.currency,
        creatorId: data.creatorId,
      });

      return newCampaign;
    } catch (error) {
      console.error('Firestore createCampaign failed:', error);
      this.enableFallback();
      if (!IS_DEV) throw new Error('OFFLINE');
      const localCampaigns = await getLocalCampaigns();
      const newCampaign: SupportCampaign = {
        ...campaignData,
        id: `campaign_${Date.now()}`,
      };
      localCampaigns.unshift(newCampaign);
      await saveLocalCampaigns(localCampaigns);
      return newCampaign;
    }
  }

  async getCampaigns(): Promise<SupportCampaign[]> {
    if (this.useLocalFallback) {
      if (!IS_DEV && this.offlineMode) return [];
      const all = await getLocalCampaigns();
      return all.filter((c) => c.status === 'active');
    }

    try {
      const q = query(
        campaignsRef(),
        where('status', '==', 'active'),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as SupportCampaign));
    } catch (error) {
      console.error('Firestore getCampaigns failed:', error);
      this.enableFallback();
      if (!IS_DEV) return [];
      const all = await getLocalCampaigns();
      return all.filter((c) => c.status === 'active');
    }
  }

  async getUserCampaigns(creatorId: string): Promise<SupportCampaign[]> {
    if (this.useLocalFallback || !creatorId) {
      if (!IS_DEV && this.offlineMode) return [];
      const all = await getLocalCampaigns();
      return all.filter((c) => c.creatorId === creatorId);
    }

    try {
      const q = query(
        campaignsRef(),
        where('creatorId', '==', creatorId),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as SupportCampaign));
    } catch (error) {
      console.error('Firestore getUserCampaigns failed:', error);
      this.enableFallback();
      if (!IS_DEV) return [];
      const all = await getLocalCampaigns();
      return all.filter((c) => c.creatorId === creatorId);
    }
  }

  async getCampaignById(campaignId: string): Promise<SupportCampaign | null> {
    if (this.useLocalFallback) {
      const all = await getLocalCampaigns();
      return all.find((c) => c.id === campaignId) || null;
    }

    try {
      const ref = campaignDoc(campaignId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return { ...snap.data(), id: snap.id } as SupportCampaign;
    } catch (error) {
      console.error('Firestore getCampaignById failed:', error);
      this.enableFallback();
      if (!IS_DEV) return null;
      const all = await getLocalCampaigns();
      return all.find((c) => c.id === campaignId) || null;
    }
  }

  async contribute(
    data: Omit<CampaignContribution, 'id' | 'createdAt' | 'status' | 'transactionId'>
  ): Promise<CampaignContribution> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    // ── Risk Controls Layer ───────────────────────────────────────────────
    if (data.userId && !this.useLocalFallback) {
      await clientRiskService.runCampaignChecks(data.userId, data.amount, data.currency);
    }
    // ─────────────────────────────────────────────────────────────────────

    const now = new Date().toISOString();
    const contributionData = {
      ...data,
      status: 'pending' as const,
      createdAt: now,
    };

    let contribution: CampaignContribution;

    if (this.useLocalFallback || !data.userId) {
      contribution = {
        ...contributionData,
        id: `contrib_${Date.now()}`,
      };
    } else {
      try {
        const docRef = await addDoc(contributionsRef(), contributionData);
        contribution = { ...contributionData, id: docRef.id };
      } catch (error) {
        console.error('Firestore contribute record failed:', error);
        this.enableFallback();
        if (!IS_DEV) throw new Error('OFFLINE');
        contribution = {
          ...contributionData,
          id: `contrib_${Date.now()}`,
        };
      }
    }

    try {
      await remittanceApi.initiateTransfer({
        amount: data.amount,
        fromCurrency: data.currency,
        toCurrency: 'ETB',
        beneficiaryId: 0,
        description: `Support Campaign Contribution: ${data.campaignId}`,
        payoutMethod: 'mobile_wallet',
      });

      contribution.status = 'sent';
      contribution.transactionId = `txn_${Date.now()}`;

      await addAuditLog(data.campaignId, 'contribution_sent', {
        contributionId: contribution.id,
        userName: data.userName,
        amount: data.amount,
        currency: data.currency,
        transactionId: contribution.transactionId,
      });
    } catch (error) {
      contribution.status = 'failed';

      await addAuditLog(data.campaignId, 'contribution_failed', {
        contributionId: contribution.id,
        userName: data.userName,
        amount: data.amount,
        currency: data.currency,
        error: error instanceof Error ? error.message : 'Transfer failed',
      });
    }

    if (this.useLocalFallback) {
      const localContributions = await getLocalContributions();
      localContributions.unshift(contribution);
      await saveLocalContributions(localContributions);

      if (contribution.status === 'sent') {
        const localCampaigns = await getLocalCampaigns();
        const idx = localCampaigns.findIndex((c) => c.id === data.campaignId);
        if (idx !== -1) {
          localCampaigns[idx].raisedAmount += data.amount;
          localCampaigns[idx].contributorCount += 1;
          localCampaigns[idx].updatedAt = now;
          if (localCampaigns[idx].raisedAmount >= localCampaigns[idx].goalAmount) {
            localCampaigns[idx].status = 'completed';
          }
          await saveLocalCampaigns(localCampaigns);
        }
      }
    } else if (contribution.status === 'sent') {
      try {
        const ref = campaignDoc(data.campaignId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const campaign = snap.data() as SupportCampaign;
          const newRaised = (campaign.raisedAmount || 0) + data.amount;
          const newCount = (campaign.contributorCount || 0) + 1;
          const updates: Record<string, any> = {
            raisedAmount: newRaised,
            contributorCount: newCount,
            updatedAt: now,
          };
          if (newRaised >= campaign.goalAmount) {
            updates.status = 'completed';
          }
          await updateDoc(ref, updates);

          if (newRaised >= campaign.goalAmount) {
            await addAuditLog(data.campaignId, 'campaign_completed', {
              raisedAmount: newRaised,
              goalAmount: campaign.goalAmount,
              contributorCount: newCount,
            });
          }
        }
      } catch (updateError) {
        console.error('Failed to update campaign after contribution:', updateError);
      }

      try {
        const contribRef = doc(db, 'campaign_contributions', contribution.id);
        await updateDoc(contribRef, {
          status: contribution.status,
          transactionId: contribution.transactionId || null,
        });
      } catch (updateError) {
        console.error('Failed to update contribution status:', updateError);
      }
    }

    return contribution;
  }

  async getContributions(campaignId: string): Promise<CampaignContribution[]> {
    if (this.useLocalFallback) {
      if (!IS_DEV && this.offlineMode) return [];
      const all = await getLocalContributions();
      return all.filter((c) => c.campaignId === campaignId);
    }

    try {
      const q = query(
        contributionsRef(),
        where('campaignId', '==', campaignId),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as CampaignContribution));
    } catch (error) {
      console.error('Firestore getContributions failed:', error);
      this.enableFallback();
      if (!IS_DEV) return [];
      const all = await getLocalContributions();
      return all.filter((c) => c.campaignId === campaignId);
    }
  }

  async cancelCampaign(campaignId: string): Promise<SupportCampaign> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    const now = new Date().toISOString();

    if (this.useLocalFallback) {
      const localCampaigns = await getLocalCampaigns();
      const idx = localCampaigns.findIndex((c) => c.id === campaignId);
      if (idx === -1) throw new Error('Campaign not found');
      localCampaigns[idx].status = 'cancelled';
      localCampaigns[idx].updatedAt = now;
      await saveLocalCampaigns(localCampaigns);
      return localCampaigns[idx];
    }

    try {
      const ref = campaignDoc(campaignId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Campaign not found');

      await updateDoc(ref, {
        status: 'cancelled',
        updatedAt: now,
      });

      await addAuditLog(campaignId, 'campaign_cancelled', {
        cancelledAt: now,
      });

      return { ...snap.data(), id: campaignId, status: 'cancelled', updatedAt: now } as SupportCampaign;
    } catch (error: any) {
      if (error?.message === 'Campaign not found') throw error;
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore cancelCampaign failed:', error);
        this.enableFallback();
        if (!IS_DEV) throw new Error('OFFLINE');
        return this.cancelCampaign(campaignId);
      }
      throw error;
    }
  }

  async completeCampaign(campaignId: string): Promise<SupportCampaign> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    const now = new Date().toISOString();

    if (this.useLocalFallback) {
      const localCampaigns = await getLocalCampaigns();
      const idx = localCampaigns.findIndex((c) => c.id === campaignId);
      if (idx === -1) throw new Error('Campaign not found');
      localCampaigns[idx].status = 'completed';
      localCampaigns[idx].updatedAt = now;
      await saveLocalCampaigns(localCampaigns);
      return localCampaigns[idx];
    }

    try {
      const ref = campaignDoc(campaignId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Campaign not found');

      await updateDoc(ref, {
        status: 'completed',
        updatedAt: now,
      });

      await addAuditLog(campaignId, 'campaign_completed', {
        completedAt: now,
      });

      return { ...snap.data(), id: campaignId, status: 'completed', updatedAt: now } as SupportCampaign;
    } catch (error: any) {
      if (error?.message === 'Campaign not found') throw error;
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore completeCampaign failed:', error);
        this.enableFallback();
        if (!IS_DEV) throw new Error('OFFLINE');
        return this.completeCampaign(campaignId);
      }
      throw error;
    }
  }
}

export const campaignService = new CampaignService();

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
import type { RecurringSchedule, ScheduleExecution, ScheduleFrequency } from '../types';

const LOCAL_SCHEDULES_KEY = 'recurring_schedules_local';
const LOCAL_EXECUTIONS_KEY = 'schedule_executions_local';
const IS_DEV = __DEV__;

type AuditAction =
  | 'schedule_created'
  | 'schedule_updated'
  | 'schedule_paused'
  | 'schedule_resumed'
  | 'schedule_cancelled'
  | 'execution_queued'
  | 'execution_sent'
  | 'execution_failed';

const PAYOUT_METHOD_MAP: Record<RecurringSchedule['payoutMethod'], string> = {
  telebirr: 'mobile_wallet',
  direct_transfer: 'bank_account',
  cash_pickup: 'cash_pickup',
};

function schedulesCollection(userId: string) {
  return collection(db, 'users', userId, 'recurring_schedules');
}

function executionsCollection(userId: string) {
  return collection(db, 'users', userId, 'schedule_executions');
}

function scheduleDoc(userId: string, scheduleId: string) {
  return doc(db, 'users', userId, 'recurring_schedules', scheduleId);
}

function auditCollection(userId: string) {
  return collection(db, 'users', userId, 'recurring_audit_log');
}

async function addAuditLog(
  userId: string,
  action: AuditAction,
  scheduleId: string | undefined,
  details: Record<string, any>
): Promise<void> {
  try {
    await addDoc(auditCollection(userId), {
      action,
      scheduleId: scheduleId || null,
      details,
      timestamp: serverTimestamp(),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('Failed to write recurring support audit log:', error);
  }
}

export function calculateNextPayoutDate(frequency: ScheduleFrequency, fromDate: string): string {
  const date = new Date(fromDate);
  switch (frequency) {
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'biweekly':
      date.setDate(date.getDate() + 14);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'quarterly':
      date.setMonth(date.getMonth() + 3);
      break;
    case 'semester':
      date.setMonth(date.getMonth() + 6);
      break;
  }
  return date.toISOString();
}

async function getLocalSchedules(): Promise<RecurringSchedule[]> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_SCHEDULES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

async function saveLocalSchedules(schedules: RecurringSchedule[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_SCHEDULES_KEY, JSON.stringify(schedules));
}

async function getLocalExecutions(): Promise<ScheduleExecution[]> {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_EXECUTIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

async function saveLocalExecutions(executions: ScheduleExecution[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_EXECUTIONS_KEY, JSON.stringify(executions));
}

class RecurringSupportService {
  private useLocalFallback = false;
  private offlineMode = false;

  private enableFallback(): void {
    if (IS_DEV) {
      if (!this.useLocalFallback) {
        console.warn('Firestore unavailable for recurring support — using local fallback (dev mode)');
        this.useLocalFallback = true;
      }
    } else {
      this.offlineMode = true;
    }
  }

  isOffline(): boolean {
    return this.offlineMode && !IS_DEV;
  }

  async createSchedule(
    userId: string,
    data: Omit<RecurringSchedule, 'id' | 'createdAt' | 'updatedAt' | 'totalSent' | 'totalPayouts'>
  ): Promise<RecurringSchedule> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    const now = new Date().toISOString();
    const scheduleData = {
      ...data,
      userId,
      totalSent: 0,
      totalPayouts: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (this.useLocalFallback || !userId) {
      const localSchedules = await getLocalSchedules();
      const newSchedule: RecurringSchedule = {
        ...scheduleData,
        id: `sched_${Date.now()}`,
      };
      localSchedules.unshift(newSchedule);
      await saveLocalSchedules(localSchedules);
      return newSchedule;
    }

    try {
      const docRef = await addDoc(schedulesCollection(userId), scheduleData);
      const newSchedule: RecurringSchedule = { ...scheduleData, id: docRef.id };

      await addAuditLog(userId, 'schedule_created', docRef.id, {
        memberName: data.memberName,
        amount: data.amount,
        currency: data.currency,
        frequency: data.frequency,
        payoutMethod: data.payoutMethod,
      });

      return newSchedule;
    } catch (error) {
      console.error('Firestore createSchedule failed:', error);
      this.enableFallback();
      if (!IS_DEV) throw new Error('OFFLINE');
      const localSchedules = await getLocalSchedules();
      const newSchedule: RecurringSchedule = {
        ...scheduleData,
        id: `sched_${Date.now()}`,
      };
      localSchedules.unshift(newSchedule);
      await saveLocalSchedules(localSchedules);
      return newSchedule;
    }
  }

  async getSchedules(userId: string): Promise<RecurringSchedule[]> {
    if (this.useLocalFallback || !userId) {
      if (!IS_DEV && this.offlineMode) return [];
      return getLocalSchedules();
    }

    try {
      const q = query(schedulesCollection(userId), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as RecurringSchedule));
    } catch (error) {
      console.error('Firestore getSchedules failed:', error);
      this.enableFallback();
      if (!IS_DEV) return [];
      return getLocalSchedules();
    }
  }

  async updateSchedule(
    userId: string,
    scheduleId: string,
    data: Partial<RecurringSchedule>
  ): Promise<RecurringSchedule> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    if (this.useLocalFallback) {
      const localSchedules = await getLocalSchedules();
      const idx = localSchedules.findIndex((s) => s.id === scheduleId);
      if (idx === -1) throw new Error('Schedule not found');
      localSchedules[idx] = {
        ...localSchedules[idx],
        ...data,
        updatedAt: new Date().toISOString(),
      };
      await saveLocalSchedules(localSchedules);
      return localSchedules[idx];
    }

    try {
      const ref = scheduleDoc(userId, scheduleId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Schedule not found');

      const updates = {
        ...data,
        updatedAt: new Date().toISOString(),
      };
      delete (updates as any).id;
      await updateDoc(ref, updates);

      const updated = { ...snap.data(), ...updates, id: scheduleId } as RecurringSchedule;

      await addAuditLog(userId, 'schedule_updated', scheduleId, {
        updatedFields: Object.keys(data),
      });

      return updated;
    } catch (error: any) {
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore updateSchedule failed:', error);
        this.enableFallback();
        if (!IS_DEV) throw new Error('OFFLINE');
        return this.updateSchedule(userId, scheduleId, data);
      }
      throw error;
    }
  }

  async pauseSchedule(userId: string, scheduleId: string): Promise<RecurringSchedule> {
    const updated = await this.updateSchedule(userId, scheduleId, { status: 'paused' });

    if (!this.useLocalFallback) {
      await addAuditLog(userId, 'schedule_paused', scheduleId, {
        memberName: updated.memberName,
      });
    }

    return updated;
  }

  async resumeSchedule(userId: string, scheduleId: string): Promise<RecurringSchedule> {
    const updated = await this.updateSchedule(userId, scheduleId, { status: 'active' });

    if (!this.useLocalFallback) {
      await addAuditLog(userId, 'schedule_resumed', scheduleId, {
        memberName: updated.memberName,
      });
    }

    return updated;
  }

  async cancelSchedule(userId: string, scheduleId: string): Promise<RecurringSchedule> {
    const updated = await this.updateSchedule(userId, scheduleId, { status: 'cancelled' });

    if (!this.useLocalFallback) {
      await addAuditLog(userId, 'schedule_cancelled', scheduleId, {
        memberName: updated.memberName,
      });
    }

    return updated;
  }

  async processDueSchedules(userId: string): Promise<ScheduleExecution[]> {
    if (this.offlineMode && !IS_DEV) {
      throw new Error('OFFLINE');
    }

    const schedules = await this.getSchedules(userId);
    const now = new Date();
    const dueSchedules = schedules.filter(
      (s) => s.status === 'active' && new Date(s.nextPayoutDate) <= now
    );

    const results: ScheduleExecution[] = [];

    for (const schedule of dueSchedules) {
      const executedAt = new Date().toISOString();
      const execution: ScheduleExecution = {
        id: '',
        scheduleId: schedule.id,
        memberId: schedule.memberId,
        memberName: schedule.memberName,
        amount: schedule.amount,
        currency: schedule.currency,
        status: 'queued',
        executedAt,
      };

      if (this.useLocalFallback) {
        execution.id = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      } else {
        try {
          const execRef = await addDoc(executionsCollection(userId), {
            ...execution,
            createdAt: serverTimestamp(),
          });
          execution.id = execRef.id;
        } catch (error) {
          console.error('Failed to create execution record:', error);
          execution.id = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }
      }

      await addAuditLog(userId, 'execution_queued', schedule.id, {
        executionId: execution.id,
        memberName: schedule.memberName,
        amount: schedule.amount,
        currency: schedule.currency,
      });

      try {
        await remittanceApi.initiateTransfer({
          amount: schedule.amount,
          fromCurrency: schedule.currency,
          toCurrency: 'ETB',
          beneficiaryId: 0,
          description: `Recurring Support: ${schedule.memberName}${schedule.note ? ' - ' + schedule.note : ''}`,
          payoutMethod: PAYOUT_METHOD_MAP[schedule.payoutMethod],
        });

        execution.status = 'sent';
        execution.transactionId = `txn_${Date.now()}`;

        await addAuditLog(userId, 'execution_sent', schedule.id, {
          executionId: execution.id,
          transactionId: execution.transactionId,
        });
      } catch (error) {
        execution.status = 'failed';
        execution.error = error instanceof Error ? error.message : 'Transfer failed';

        await addAuditLog(userId, 'execution_failed', schedule.id, {
          executionId: execution.id,
          error: execution.error,
        });
      }

      const nextPayoutDate = calculateNextPayoutDate(schedule.frequency, schedule.nextPayoutDate);
      const scheduleUpdates: Partial<RecurringSchedule> = {
        nextPayoutDate,
        lastPayoutDate: executedAt,
        lastPayoutStatus: execution.status === 'sent' ? 'sent' : 'failed',
        totalSent: schedule.totalSent + (execution.status === 'sent' ? 1 : 0),
        totalPayouts: schedule.totalPayouts + 1,
      };

      try {
        await this.updateSchedule(userId, schedule.id, scheduleUpdates);
      } catch (updateError) {
        console.error('Failed to update schedule after execution:', updateError);
      }

      if (!this.useLocalFallback && execution.id.startsWith('exec_') === false) {
        try {
          const execRef = doc(db, 'users', userId, 'schedule_executions', execution.id);
          await updateDoc(execRef, {
            status: execution.status,
            transactionId: execution.transactionId || null,
            error: execution.error || null,
          });
        } catch (error) {
          console.error('Failed to update execution record:', error);
        }
      }

      if (this.useLocalFallback) {
        const localExecs = await getLocalExecutions();
        localExecs.unshift(execution);
        await saveLocalExecutions(localExecs);
      }

      results.push(execution);
    }

    return results;
  }

  async getExecutionHistory(userId: string, scheduleId?: string): Promise<ScheduleExecution[]> {
    if (this.useLocalFallback || !userId) {
      if (!IS_DEV && this.offlineMode) return [];
      const all = await getLocalExecutions();
      if (scheduleId) {
        return all.filter((e) => e.scheduleId === scheduleId);
      }
      return all;
    }

    try {
      let q;
      if (scheduleId) {
        q = query(
          executionsCollection(userId),
          where('scheduleId', '==', scheduleId),
          orderBy('executedAt', 'desc')
        );
      } else {
        q = query(executionsCollection(userId), orderBy('executedAt', 'desc'));
      }
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as ScheduleExecution));
    } catch (error) {
      console.error('Firestore getExecutionHistory failed:', error);
      this.enableFallback();
      if (!IS_DEV) return [];
      const all = await getLocalExecutions();
      if (scheduleId) {
        return all.filter((e) => e.scheduleId === scheduleId);
      }
      return all;
    }
  }
}

export const recurringSupportService = new RecurringSupportService();

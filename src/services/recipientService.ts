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
  orderBy,
  serverTimestamp,
} from './firebase';

export interface Recipient {
  id: string;
  name: string;
  bank: string;
  accountNumber: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}

const SEED_RECIPIENTS: Omit<Recipient, 'id'>[] = [
  {
    name: 'Almaz Bekele',
    bank: 'CBE',
    accountNumber: '1000123456789',
    phone: '+251911234567',
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    name: 'Dawit Tadesse',
    bank: 'Awash',
    accountNumber: '2000987654321',
    phone: '+251922345678',
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    name: 'Meron Hailu',
    bank: 'Telebirr',
    accountNumber: '0933456789',
    createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
  },
];

function recipientsCollection(userId: string) {
  return collection(db, 'users', userId, 'recipients');
}

function recipientDoc(userId: string, recipientId: string) {
  return doc(db, 'users', userId, 'recipients', recipientId);
}

const localRecipients = new Map<string, Recipient[]>();

async function seedDevData(userId: string): Promise<Recipient[]> {
  const seeded: Recipient[] = [];
  for (const seed of SEED_RECIPIENTS) {
    const docRef = await addDoc(recipientsCollection(userId), seed);
    seeded.push({ ...seed, id: docRef.id });
  }
  return seeded;
}

class RecipientService {
  private useLocalFallback = false;

  private shouldFallback(userId: string | undefined): boolean {
    return this.useLocalFallback || !userId;
  }

  private enableFallback(): void {
    if (!this.useLocalFallback) {
      console.warn('Firestore unavailable — using local recipient fallback');
      this.useLocalFallback = true;
    }
  }

  private getLocalRecipients(userId: string): Recipient[] {
    if (!localRecipients.has(userId)) {
      const seeded = SEED_RECIPIENTS.map((r, i) => ({
        ...r,
        id: `local_${i + 1}`,
      }));
      localRecipients.set(userId, seeded);
    }
    return localRecipients.get(userId)!;
  }

  async getRecipients(userId: string): Promise<Recipient[]> {
    if (this.shouldFallback(userId)) {
      return this.getLocalRecipients(userId);
    }

    try {
      const q = query(recipientsCollection(userId), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      if (snapshot.empty && __DEV__) {
        return seedDevData(userId);
      }

      return snapshot.docs.map((d) => ({
        ...d.data(),
        id: d.id,
      })) as Recipient[];
    } catch (error) {
      console.error('Firestore getRecipients failed, using fallback:', error);
      this.enableFallback();
      return this.getLocalRecipients(userId);
    }
  }

  async addRecipient(
    userId: string,
    data: { name: string; bank: string; accountNumber: string; phone?: string }
  ): Promise<Recipient> {
    const now = new Date().toISOString();
    const recipientData = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    if (this.shouldFallback(userId)) {
      const locals = this.getLocalRecipients(userId);
      const newRecipient: Recipient = {
        ...recipientData,
        id: `local_${Date.now()}`,
      };
      locals.unshift(newRecipient);
      return newRecipient;
    }

    try {
      const docRef = await addDoc(recipientsCollection(userId), recipientData);
      return { ...recipientData, id: docRef.id };
    } catch (error) {
      console.error('Firestore addRecipient failed, using fallback:', error);
      this.enableFallback();
      const locals = this.getLocalRecipients(userId);
      const newRecipient: Recipient = {
        ...recipientData,
        id: `local_${Date.now()}`,
      };
      locals.unshift(newRecipient);
      return newRecipient;
    }
  }

  async updateRecipient(
    userId: string,
    recipientId: string,
    data: Partial<Pick<Recipient, 'name' | 'bank' | 'accountNumber' | 'phone'>>
  ): Promise<Recipient> {
    const updates = {
      ...data,
      updatedAt: new Date().toISOString(),
    };

    if (this.shouldFallback(userId)) {
      const locals = this.getLocalRecipients(userId);
      const idx = locals.findIndex((r) => r.id === recipientId);
      if (idx === -1) throw new Error('Recipient not found');
      locals[idx] = { ...locals[idx], ...updates };
      return locals[idx];
    }

    try {
      const ref = recipientDoc(userId, recipientId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Recipient not found');

      await updateDoc(ref, updates);
      return { ...snap.data(), ...updates, id: recipientId } as Recipient;
    } catch (error: any) {
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore updateRecipient failed, using fallback:', error);
        this.enableFallback();
        const locals = this.getLocalRecipients(userId);
        const idx = locals.findIndex((r) => r.id === recipientId);
        if (idx === -1) throw new Error('Recipient not found');
        locals[idx] = { ...locals[idx], ...updates };
        return locals[idx];
      }
      throw error;
    }
  }

  async deleteRecipient(userId: string, recipientId: string): Promise<void> {
    if (this.shouldFallback(userId)) {
      const locals = this.getLocalRecipients(userId);
      const idx = locals.findIndex((r) => r.id === recipientId);
      if (idx === -1) throw new Error('Recipient not found');
      locals.splice(idx, 1);
      return;
    }

    try {
      const ref = recipientDoc(userId, recipientId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Recipient not found');
      await deleteDoc(ref);
    } catch (error: any) {
      if (error?.code === 'permission-denied' || error?.code === 'unavailable') {
        console.error('Firestore deleteRecipient failed, using fallback:', error);
        this.enableFallback();
        const locals = this.getLocalRecipients(userId);
        const idx = locals.findIndex((r) => r.id === recipientId);
        if (idx === -1) throw new Error('Recipient not found');
        locals.splice(idx, 1);
        return;
      }
      throw error;
    }
  }
}

export const recipientService = new RecipientService();

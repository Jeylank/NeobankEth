/**
 * server/services/adminUsersService.ts
 * ──────────────────────────────────────
 * Backs the Admin Users screen: search users, view full detail (KYC status,
 * wallet balance, transfer counts, sent/received totals, account status,
 * risk score, verification history). All data is read live from Firebase
 * Auth + Firestore — nothing hardcoded.
 */

import { adminAuth, adminDb } from '../firebaseAdmin';
import { AGENT_COL } from './agentPayoutService';
import { FRAUD_COL } from './fraudEngine';
import { safetyGuardsService } from './riskControls/safetyGuardsService';

const TXN_COL   = AGENT_COL.txns; // 'sim_transactions'
const KYC_COL   = 'kyc_documents';
const WALLET_COL = 'wallets';
const FLAGS_COL  = 'risk_flags';
const AUDIT_COL  = 'admin_action_logs';

function toIso(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val;
  const anyVal = val as { toDate?: () => Date };
  if (typeof anyVal.toDate === 'function') return anyVal.toDate().toISOString();
  return null;
}

export interface UserSummary {
  uid:          string;
  email:        string | null;
  displayName:  string | null;
  phoneNumber:  string | null;
  disabled:     boolean;
  createdAt:    string | null;
  lastSignIn:   string | null;
  kycStatus:    string;
  accountStatus: 'ACTIVE' | 'SUSPENDED' | 'REVIEW';
  riskScore:    number | null;
}

async function attachUserRiskContext(uid: string): Promise<{
  kycStatus: string;
  accountStatus: 'ACTIVE' | 'SUSPENDED' | 'REVIEW';
  riskScore: number | null;
}> {
  const [kycStatus, flag, fraudSnap] = await Promise.all([
    safetyGuardsService.getKycStatus(uid),
    safetyGuardsService.getRiskFlag(uid),
    adminDb.collection(FRAUD_COL.decisions)
      .where('userId', '==', uid)
      .get()
      .catch(() => null),
  ]);

  let riskScore: number | null = null;
  if (fraudSnap && !fraudSnap.empty) {
    const sorted = [...fraudSnap.docs].sort((a, b) => {
      const aTime = toIso(a.data().createdAt ?? a.data().timestamp) ?? '';
      const bTime = toIso(b.data().createdAt ?? b.data().timestamp) ?? '';
      return bTime.localeCompare(aTime);
    });
    const d = sorted[0].data();
    riskScore = typeof d.score === 'number' ? d.score : null;
  }

  let accountStatus: 'ACTIVE' | 'SUSPENDED' | 'REVIEW' = 'ACTIVE';
  if (flag.isFrozen || flag.isBlocked) accountStatus = 'SUSPENDED';
  else if (flag.reviewRequired) accountStatus = 'REVIEW';

  return { kycStatus, accountStatus, riskScore };
}

function toUserSummary(record: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  phoneNumber?: string | null;
  disabled?: boolean;
  metadata: { creationTime?: string; lastSignInTime?: string };
}): Pick<UserSummary, 'uid' | 'email' | 'displayName' | 'phoneNumber' | 'disabled' | 'createdAt' | 'lastSignIn'> {
  return {
    uid:         record.uid,
    email:       record.email ?? null,
    displayName: record.displayName ?? null,
    phoneNumber: record.phoneNumber ?? null,
    disabled:    record.disabled ?? false,
    createdAt:   record.metadata.creationTime ?? null,
    lastSignIn:  record.metadata.lastSignInTime ?? null,
  };
}

/**
 * searchUsers — search Firebase Auth users by uid, email, phone, or display
 * name. Firebase Admin SDK has no substring search, so:
 *   - exact uid / email lookups go straight to Firebase Auth (fast path)
 *   - free-text queries page through listUsers (bounded) and filter in memory
 */
export async function searchUsers(params: {
  query?: string;
  limit?: number;
}): Promise<{ results: UserSummary[]; totalScanned: number }> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const needle = (params.query ?? '').trim();

  if (!needle) {
    const page = await adminAuth.listUsers(limit);
    const results = await Promise.all(
      page.users.map(async (u) => {
        const summary = toUserSummary(u);
        const risk = await attachUserRiskContext(u.uid);
        return { ...summary, ...risk };
      }),
    );
    return { results, totalScanned: page.users.length };
  }

  // Fast path: exact uid
  const byUid = await adminAuth.getUser(needle).catch(() => null);
  if (byUid) {
    const summary = toUserSummary(byUid);
    const risk = await attachUserRiskContext(byUid.uid);
    return { results: [{ ...summary, ...risk }], totalScanned: 1 };
  }

  // Fast path: exact email
  if (needle.includes('@')) {
    const byEmail = await adminAuth.getUserByEmail(needle).catch(() => null);
    if (byEmail) {
      const summary = toUserSummary(byEmail);
      const risk = await attachUserRiskContext(byEmail.uid);
      return { results: [{ ...summary, ...risk }], totalScanned: 1 };
    }
  }

  // Slow path: scan a bounded window of recent users, filter in memory.
  const lowerNeedle = needle.toLowerCase();
  const scanned: import('firebase-admin/auth').UserRecord[] = [];
  let pageToken: string | undefined;
  const MAX_SCAN = 2000;

  do {
    const page = await adminAuth.listUsers(1000, pageToken);
    scanned.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken && scanned.length < MAX_SCAN);

  const matches = scanned.filter((u) => {
    const haystack = [u.uid, u.email, u.displayName, u.phoneNumber]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());
    return haystack.some((v) => v.includes(lowerNeedle));
  });

  const page = matches.slice(0, limit);
  const results = await Promise.all(
    page.map(async (u) => {
      const summary = toUserSummary(u);
      const risk = await attachUserRiskContext(u.uid);
      return { ...summary, ...risk };
    }),
  );

  return { results, totalScanned: scanned.length };
}

export interface VerificationEvent {
  action:    string;
  reason:    string | null;
  adminId:   string | null;
  timestamp: string | null;
}

export interface UserDetail extends UserSummary {
  kyc: {
    status:        string;
    documentType:  string | null;
    fullName:      string | null;
    submittedAt:   string | null;
  };
  wallet: {
    balances: Record<string, number>;
  };
  riskFlag: {
    isFrozen:       boolean;
    isBlocked:      boolean;
    reviewRequired: boolean;
    reason:         string | null;
  };
  transfers: {
    sentCount:      number;
    receivedCount:  number;
    totalSent:      Record<string, number>;
    totalReceived:  Record<string, number>;
  };
  verificationHistory: VerificationEvent[];
}

/**
 * getUserDetail — full profile for the Admin Users detail view.
 */
export async function getUserDetail(uid: string): Promise<UserDetail | null> {
  const authUser = await adminAuth.getUser(uid).catch(() => null);
  if (!authUser) return null;

  const [kycSnap, walletSnap, flag, sentSnap, receivedSnap, auditSnap, risk] = await Promise.all([
    adminDb.collection(KYC_COL).doc(uid).get(),
    adminDb.collection(WALLET_COL).doc(uid).get(),
    safetyGuardsService.getRiskFlag(uid),
    adminDb.collection(TXN_COL).where('userId', '==', uid).get().catch(() => ({ docs: [] } as any)),
    adminDb.collection(TXN_COL).where('recipientId', '==', uid).get().catch(() => ({ docs: [] } as any)),
    // Avoid a composite index (entityId + timestamp): filter only, sort in memory.
    adminDb.collection(AUDIT_COL).where('entityId', '==', uid).get().catch(() => null),
    attachUserRiskContext(uid),
  ]);

  const kycData = kycSnap.exists ? kycSnap.data()! : {};
  const walletData = walletSnap.exists ? walletSnap.data()! : {};

  const totalSent: Record<string, number> = {};
  for (const d of sentSnap.docs) {
    const data = d.data();
    const currency = data.currency ?? 'UNKNOWN';
    const amount = typeof data.amount === 'number' ? data.amount : 0;
    totalSent[currency] = (totalSent[currency] ?? 0) + amount;
  }

  const totalReceived: Record<string, number> = {};
  for (const d of receivedSnap.docs) {
    const data = d.data();
    const currency = data.destinationCurrency ?? data.currency ?? 'UNKNOWN';
    const amount = typeof data.destinationAmount === 'number' ? data.destinationAmount : 0;
    totalReceived[currency] = (totalReceived[currency] ?? 0) + amount;
  }

  const verificationHistory: VerificationEvent[] = (auditSnap?.docs ?? [])
    .filter((d: FirebaseFirestore.QueryDocumentSnapshot) => d.data().entityType === 'user')
    .map((d: FirebaseFirestore.QueryDocumentSnapshot) => {
      const data = d.data();
      return {
        action:    data.action ?? 'UNKNOWN',
        reason:    (data.payload?.reason as string) ?? null,
        adminId:   data.adminId ?? null,
        timestamp: toIso(data.timestamp) ?? (typeof data.timestamp === 'string' ? data.timestamp : null),
      };
    })
    .sort((a: VerificationEvent, b: VerificationEvent) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''));

  if (kycData.submittedAt) {
    verificationHistory.push({
      action:    'KYC_SUBMITTED',
      reason:    null,
      adminId:   null,
      timestamp: toIso(kycData.submittedAt),
    });
    verificationHistory.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''));
  }

  return {
    ...toUserSummary(authUser),
    kycStatus:     risk.kycStatus,
    accountStatus: risk.accountStatus,
    riskScore:     risk.riskScore,
    kyc: {
      status:       risk.kycStatus,
      documentType: kycData.documentType ?? null,
      fullName:     kycData.fullName ?? null,
      submittedAt:  toIso(kycData.submittedAt),
    },
    wallet: {
      balances: (walletData.balances as Record<string, number>) ?? {},
    },
    riskFlag: {
      isFrozen:       flag.isFrozen,
      isBlocked:      flag.isBlocked,
      reviewRequired: flag.reviewRequired,
      reason:         flag.reason,
    },
    transfers: {
      sentCount:     sentSnap.docs.length,
      receivedCount: receivedSnap.docs.length,
      totalSent,
      totalReceived,
    },
    verificationHistory,
  };
}

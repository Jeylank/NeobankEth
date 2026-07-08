/**
 * firebaseAdmin.ts
 * ────────────────
 * Initializes the Firebase Admin SDK for the server.
 * Uses FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_SERVICE_ACCOUNT / base64 JSON
 * secrets in production. Falls back to application default credentials for
 * local dev.
 */

import * as admin from 'firebase-admin';

// The Firebase project ID is used for token audience verification (verifyIdToken).
// It is read from the same env var used by the client SDK so there is a single
// source of truth and no mismatch between client and server.
const FIREBASE_PROJECT_ID = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '';

type ServiceAccountEnv = Readonly<{
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  FIREBASE_SERVICE_ACCOUNT?: string;
  FIREBASE_SERVICE_ACCOUNT_BASE64?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?: string;
}>;

interface FirebaseServiceAccount {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

interface FirebaseServiceAccountConfig {
  source: keyof ServiceAccountEnv;
  serviceAccount: FirebaseServiceAccount;
}

function hasEnvValue(env: ServiceAccountEnv, key: keyof ServiceAccountEnv): boolean {
  return Object.prototype.hasOwnProperty.call(env, key);
}

function normalizePrivateKey(serviceAccount: FirebaseServiceAccount): FirebaseServiceAccount {
  return {
    ...serviceAccount,
    private_key: serviceAccount.private_key?.replace(/\\n/g, '\n'),
  };
}

function toAdminServiceAccount(serviceAccount: FirebaseServiceAccount): admin.ServiceAccount {
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error(
      'Firebase service account JSON must include project_id, client_email, and private_key.',
    );
  }
  return {
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key,
  };
}

function parseServiceAccountJson(raw: string, source: string): FirebaseServiceAccount {
  try {
    const parsed = JSON.parse(raw) as FirebaseServiceAccount;
    return normalizePrivateKey(parsed);
  } catch (error) {
    if (source === 'FIREBASE_SERVICE_ACCOUNT') {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT');
    } else {
      console.error(`Failed to parse ${source}`);
    }
    throw new Error(`Invalid ${source} Firebase service account JSON.`);
  }
}

function decodeBase64Json(raw: string, source: string): FirebaseServiceAccount {
  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  return parseServiceAccountJson(decoded, source);
}

function getServiceAccountFromEnv(
  env: ServiceAccountEnv = process.env as ServiceAccountEnv,
): FirebaseServiceAccountConfig | null {
  if (hasEnvValue(env, 'FIREBASE_SERVICE_ACCOUNT_JSON')) {
    return {
      source: 'FIREBASE_SERVICE_ACCOUNT_JSON',
      serviceAccount: parseServiceAccountJson(env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '', 'FIREBASE_SERVICE_ACCOUNT_JSON'),
    };
  }
  if (hasEnvValue(env, 'FIREBASE_SERVICE_ACCOUNT')) {
    return {
      source: 'FIREBASE_SERVICE_ACCOUNT',
      serviceAccount: parseServiceAccountJson(env.FIREBASE_SERVICE_ACCOUNT ?? '', 'FIREBASE_SERVICE_ACCOUNT'),
    };
  }
  if (hasEnvValue(env, 'FIREBASE_SERVICE_ACCOUNT_BASE64')) {
    return {
      source: 'FIREBASE_SERVICE_ACCOUNT_BASE64',
      serviceAccount: decodeBase64Json(env.FIREBASE_SERVICE_ACCOUNT_BASE64 ?? '', 'FIREBASE_SERVICE_ACCOUNT_BASE64'),
    };
  }
  if (hasEnvValue(env, 'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64')) {
    return {
      source: 'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64',
      serviceAccount: decodeBase64Json(env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 ?? '', 'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64'),
    };
  }
  return null;
}

function initApp(): admin.app.App {
  if (admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  // Option 1: service account JSON in Replit Secrets.
  const serviceAccountConfig = getServiceAccountFromEnv();
  if (serviceAccountConfig) {
    const { source, serviceAccount } = serviceAccountConfig;
    console.info(`[FirebaseAdmin] Initializing with ${source}.`);
    return admin.initializeApp({
      credential: admin.credential.cert(toAdminServiceAccount(serviceAccount)),
      projectId: serviceAccount.project_id ?? FIREBASE_PROJECT_ID,
    });
  }

  // Option 2 / 3: Application default credentials (Cloud Run, GCE, gcloud auth).
  // verifyIdToken() fetches Google's public JWKS without needing an access token,
  // but it MUST have the projectId to validate the token's audience claim.
  // Providing projectId here makes token verification work in all environments,
  // including Replit where application-default credentials are not available.
  try {
    return admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId:  FIREBASE_PROJECT_ID,
    });
  } catch {
    // Fallback: initialize with project ID only — verifyIdToken still works via
    // Google's public key endpoint; Firestore admin ops are unavailable.
    return admin.initializeApp({ projectId: FIREBASE_PROJECT_ID });
  }
}

export const firebaseApp = initApp();
export const adminAuth = admin.auth(firebaseApp);
export const adminDb  = admin.firestore(firebaseApp);

// Firestore settings: timestamps as JS Date objects
adminDb.settings({ ignoreUndefinedProperties: true });

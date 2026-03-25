/**
 * firebaseAdmin.ts
 * ────────────────
 * Initializes the Firebase Admin SDK for the server.
 * Uses GOOGLE_APPLICATION_CREDENTIALS env var (service account JSON path)
 * or FIREBASE_SERVICE_ACCOUNT env var (JSON string) in production.
 * Falls back to application default credentials for local dev.
 */

import * as admin from 'firebase-admin';

// The Firebase project ID is used for token audience verification (verifyIdToken).
// It is read from the same env var used by the client SDK so there is a single
// source of truth and no mismatch between client and server.
const FIREBASE_PROJECT_ID = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '';

function initApp(): admin.app.App {
  if (admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  // Option 1: JSON string in env var (recommended for Replit secrets)
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
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

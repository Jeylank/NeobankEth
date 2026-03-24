/**
 * firebaseAdmin.ts
 * ────────────────
 * Initializes the Firebase Admin SDK for the server.
 * Uses GOOGLE_APPLICATION_CREDENTIALS env var (service account JSON path)
 * or FIREBASE_SERVICE_ACCOUNT env var (JSON string) in production.
 * Falls back to application default credentials for local dev.
 */

import * as admin from 'firebase-admin';

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
    });
  }

  // Option 2: Path to service account file
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    return admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }

  // Option 3: Application default (gcloud auth, Cloud Run, etc.)
  return admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

export const firebaseApp = initApp();
export const adminAuth = admin.auth(firebaseApp);
export const adminDb  = admin.firestore(firebaseApp);

// Firestore settings: timestamps as JS Date objects
adminDb.settings({ ignoreUndefinedProperties: true });

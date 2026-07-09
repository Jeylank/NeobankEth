import { adminDb, adminAuth } from '../firebaseAdmin';

async function main() {
  const uid = '0bluPVLbzyTt31nMb4PmVzyfbXt2';
  const snap = await adminDb.collection('users').doc(uid).get();
  console.log('firestore exists:', snap.exists);
  console.log('firestore data:', JSON.stringify(snap.data()));
  const user = await adminAuth.getUser(uid);
  console.log('customClaims:', JSON.stringify(user.customClaims));
  console.log('email:', user.email);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

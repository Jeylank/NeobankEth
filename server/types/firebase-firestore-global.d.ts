// Backward-compatibility shim.
//
// Older code in this codebase references the ambient `FirebaseFirestore.*`
// namespace types (e.g. `FirebaseFirestore.Query`, `FirebaseFirestore.Timestamp`)
// that were implicitly global in older firebase-admin type packages. Current
// firebase-admin (13.x) no longer declares that global namespace — it exports
// named types from `firebase-admin/firestore` instead.
//
// Rather than rewrite every call site (risking behavior changes in financial
// code paths), this declares the same namespace globally as thin aliases to
// the real modern types, so existing annotations keep type-checking correctly.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace FirebaseFirestore {
    type Firestore = import('firebase-admin/firestore').Firestore;
    type Query = import('firebase-admin/firestore').Query;
    type QueryDocumentSnapshot = import('firebase-admin/firestore').QueryDocumentSnapshot;
    type DocumentData = import('firebase-admin/firestore').DocumentData;
    type Timestamp = import('firebase-admin/firestore').Timestamp;
    type DocumentSnapshot = import('firebase-admin/firestore').DocumentSnapshot;
    type CollectionReference = import('firebase-admin/firestore').CollectionReference;
    type DocumentReference = import('firebase-admin/firestore').DocumentReference;
    type Transaction = import('firebase-admin/firestore').Transaction;
    type WriteBatch = import('firebase-admin/firestore').WriteBatch;
    type QuerySnapshot = import('firebase-admin/firestore').QuerySnapshot;
    type FieldValue = import('firebase-admin/firestore').FieldValue;
  }
}

export {};

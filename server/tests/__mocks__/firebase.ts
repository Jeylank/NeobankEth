/**
 * server/tests/__mocks__/firebase.ts
 *
 * Mapped to by jest.config.js for import paths like '../firebase'.
 * Re-exports from 'firebase/firestore' so the test's jest.mock('firebase/firestore')
 * and clientRiskService's imports share exactly the same jest.fn() instances.
 */
export * from 'firebase/firestore';
export const db = {};
export const auth = {};
export const storage = {};

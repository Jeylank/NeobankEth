/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/server/tests'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      // Transpile-only: skip full type-checking during test transform. The
      // repo's own `npm run typecheck` (tsc --noEmit) is the source of truth
      // for type errors — running full type-check here as well causes false
      // failures because ts-jest's isolated module resolution (forced to
      // "node" below, for CommonJS Jest compatibility) doesn't understand
      // some packages' "exports" map the same way the app's own bundler
      // resolution does (e.g. firebase/auth). This mirrors production,
      // which already runs the server via `ts-node --transpile-only`.
      tsconfig: {
        module: 'CommonJS',
        moduleResolution: 'node',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        skipLibCheck: true,
        strict: false,
        isolatedModules: true,
      },
    }],
  },
  moduleNameMapper: {
    // Stub out React Native & AsyncStorage
    '^react-native$': '<rootDir>/server/tests/__mocks__/reactNative.ts',
    '^@react-native-async-storage/async-storage$': '<rootDir>/server/tests/__mocks__/asyncStorage.ts',
    // Map firebase/firestore (the real SDK) to our controllable mock.
    // clientRiskService imports Timestamp from 'firebase/firestore' AND
    // src/services/firebase.ts re-exports from 'firebase/firestore'.
    // Both resolve to the same mock instance here.
    '^firebase/firestore$': '<rootDir>/server/tests/__mocks__/firestore.ts',
    // Stub the other Firebase SDK packages (not used by clientRiskService,
    // but src/services/firebase.ts imports them — must not crash in Node.js)
    '^firebase/app$':     '<rootDir>/server/tests/__mocks__/firebaseApp.ts',
    '^firebase/auth$':    '<rootDir>/server/tests/__mocks__/auth.ts',
    '^firebase/storage$': '<rootDir>/server/tests/__mocks__/firebaseStorage.ts',
    // Map the ../firebase import in clientRiskService to our own stub that
    // re-exports everything from the already-mocked 'firebase/firestore'.
    // This avoids loading src/services/firebase.ts (which calls initializeApp).
    '^\\.\\./firebase$': '<rootDir>/server/tests/__mocks__/firebase.ts',
    '^\\.\/firebase$':   '<rootDir>/server/tests/__mocks__/firebase.ts',
  },
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/services/riskControls/**/*.ts'],
};

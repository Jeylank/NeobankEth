export const getAuth = jest.fn(() => ({
  currentUser: {
    uid: 'test-user-001',
    getIdToken: jest.fn(async () => 'firebase-current-user-token'),
  },
}));

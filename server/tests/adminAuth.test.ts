import express from 'express';
import request from 'supertest';

const verifyIdToken = jest.fn();
const getUserDoc = jest.fn();

jest.mock('../firebaseAdmin', () => ({
  adminAuth: { verifyIdToken },
  adminDb: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ get: getUserDoc })),
    })),
  },
}));

import { verifyAdmin } from '../middleware/auth';

function app() {
  const instance = express();
  instance.get('/api/admin/probe', verifyAdmin, (req, res) => {
    res.json({ ok: true, adminId: (req as any).adminId });
  });
  return instance;
}

describe('admin authentication and authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401, not 500, when the bearer token is missing', async () => {
    const response = await request(app()).get('/api/admin/probe');
    expect(response.status).toBe(401);
    expect(response.body.error).toBeDefined();
  });

  it('returns 401 without a stack trace for an invalid token', async () => {
    verifyIdToken.mockRejectedValueOnce(new Error('token rejected'));
    const response = await request(app()).get('/api/admin/probe').set('Authorization', 'Bearer bad');
    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toContain('at ');
  });

  it('returns 403 for a valid non-admin user', async () => {
    verifyIdToken.mockResolvedValueOnce({ uid: 'user-1', email: 'user@example.com' });
    getUserDoc.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'user' }) });
    const response = await request(app()).get('/api/admin/probe').set('Authorization', 'Bearer user-token');
    expect(response.status).toBe(403);
  });

  it('allows an admin custom claim', async () => {
    verifyIdToken.mockResolvedValueOnce({ uid: 'admin-1', email: 'admin@example.com', isAdmin: true });
    const response = await request(app()).get('/api/admin/probe').set('Authorization', 'Bearer admin-token');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, adminId: 'admin-1' });
  });

  it('allows the existing Firestore admin-role fallback', async () => {
    verifyIdToken.mockResolvedValueOnce({ uid: 'admin-2', email: 'admin2@example.com' });
    getUserDoc.mockResolvedValueOnce({ exists: true, data: () => ({ role: 'admin' }) });
    const response = await request(app()).get('/api/admin/probe').set('Authorization', 'Bearer admin-token');
    expect(response.status).toBe(200);
  });
});

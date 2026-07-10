import express from 'express';
import request from 'supertest';

const docs: any[] = [];
const docGet = jest.fn();
const docUpdate = jest.fn();
const batchUpdate = jest.fn();
const batchCommit = jest.fn();

jest.mock('../middleware/verifyUser', () => ({
  verifyUser: (req: any, res: any, next: any) => {
    if (req.headers.authorization !== 'Bearer user') return res.status(401).json({ error: 'UNAUTHORIZED' });
    req.userId = 'user-1'; next();
  },
}));
jest.mock('../firebaseAdmin', () => ({
  adminDb: {
    collection: jest.fn(() => {
      const query: any = {
        where: () => query, limit: () => query, get: jest.fn(async () => ({ docs })),
        doc: () => ({ get: docGet, update: docUpdate }), add: jest.fn(),
      };
      return query;
    }),
    batch: () => ({ update: batchUpdate, commit: batchCommit }),
  },
}));
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'SERVER_TIME' } }));

import notificationsRouter from '../routes/notifications';

function app() { const instance = express(); instance.use(express.json()); instance.use('/api/notifications', notificationsRouter); return instance; }

describe('in-app notification read API', () => {
  beforeEach(() => { jest.clearAllMocks(); docs.splice(0); batchCommit.mockResolvedValue(undefined); docUpdate.mockResolvedValue(undefined); });

  it('requires authentication', async () => {
    expect((await request(app()).patch('/api/notifications/n1/read')).status).toBe(401);
  });

  it('marks only the current user notification read and is idempotent', async () => {
    docGet.mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-1', read: false }) });
    const first = await request(app()).patch('/api/notifications/n1/read').set('Authorization', 'Bearer user');
    expect(first.status).toBe(200); expect(docUpdate).toHaveBeenCalledTimes(1);
    docGet.mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'user-1', read: true }) });
    const duplicate = await request(app()).patch('/api/notifications/n1/read').set('Authorization', 'Bearer user');
    expect(duplicate.status).toBe(200); expect(docUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not allow reading another user notification', async () => {
    docGet.mockResolvedValueOnce({ exists: true, data: () => ({ userId: 'other-user', read: false }) });
    expect((await request(app()).patch('/api/notifications/n1/read').set('Authorization', 'Bearer user')).status).toBe(404);
  });

  it('marks all unread notifications and returns a cleared unread count', async () => {
    docs.push(
      { ref: { id: 'n1' }, data: () => ({ read: false }) },
      { ref: { id: 'n2' }, data: () => ({ read: true }) },
    );
    const response = await request(app()).post('/api/notifications/read-all').set('Authorization', 'Bearer user');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, markedRead: 1, unreadCount: 0 });
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(batchCommit).toHaveBeenCalledTimes(1);
  });

  it('returns generic structured errors without internal messages', async () => {
    docGet.mockRejectedValueOnce(new Error('service-account secret path'));
    const response = await request(app()).patch('/api/notifications/n1/read').set('Authorization', 'Bearer user');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'INTERNAL_ERROR', message: 'Failed to update notification.' });
    expect(JSON.stringify(response.body)).not.toContain('service-account');
  });
});

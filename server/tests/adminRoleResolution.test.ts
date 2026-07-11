import fs from 'fs';
import path from 'path';
import { applyAdminRoleResult, resolveAdminRole } from '../../src/hooks/adminRole';

const createUser = () => ({ getIdToken: jest.fn().mockResolvedValueOnce('initial-token').mockResolvedValueOnce('refreshed-token') });
const storeToken = jest.fn().mockResolvedValue(undefined);

describe('native admin-role resolution', () => {
  beforeEach(() => storeToken.mockClear());

  it('resolves an admin profile as admin', async () => {
    const result = await resolveAdminRole(createUser(), {
      storeToken,
      getProfile: jest.fn().mockResolvedValue({ role: 'admin' }),
    });
    expect(result).toBe(true);
  });

  it('resolves a confirmed normal user as non-admin', async () => {
    const result = await resolveAdminRole(createUser(), {
      storeToken,
      getProfile: jest.fn().mockResolvedValue({ role: 'user' }),
    });
    expect(result).toBe(false);
  });

  it('refreshes the ID token and retries once after a transient failure', async () => {
    const user = createUser();
    const getProfile = jest.fn()
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ role: 'admin' });
    await expect(resolveAdminRole(user, { storeToken, getProfile })).resolves.toBe(true);
    expect(user.getIdToken).toHaveBeenNthCalledWith(1);
    expect(user.getIdToken).toHaveBeenNthCalledWith(2, true);
    expect(getProfile).toHaveBeenCalledTimes(2);
  });

  it('does not permanently hide the admin menu after transient failures', async () => {
    const result = await resolveAdminRole(createUser(), {
      storeToken,
      getProfile: jest.fn().mockRejectedValue({ code: 'ERR_NETWORK' }),
    });
    expect(result).toBeUndefined();
    expect(applyAdminRoleResult(true, result)).toBe(true);
  });

  it('resets isAdmin on sign-out', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/hooks/useAuth.tsx'), 'utf8');
    const signOut = source.slice(source.indexOf('const signOut = async'), source.indexOf('const signInWithPhone'));
    expect(signOut).toContain('setIsAdmin(false)');
  });
});

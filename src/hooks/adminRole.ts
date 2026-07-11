export interface AdminRoleUser {
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

interface AdminRoleDependencies {
  storeToken: (token: string) => Promise<void>;
  getProfile: () => Promise<{ role?: string }>;
}

const shouldRetry = (error: any): boolean => {
  const status = error?.response?.status;
  return status === 401 || status === 403 || !error?.response || error?.code === 'ERR_NETWORK';
};

// `undefined` means the role could not be confirmed. Callers must preserve the
// last confirmed role in that case; a request failure is not a non-admin role.
export async function resolveAdminRole(
  user: AdminRoleUser,
  dependencies: AdminRoleDependencies,
): Promise<boolean | undefined> {
  try {
    const token = await user.getIdToken();
    await dependencies.storeToken(token);

    try {
      const profile = await dependencies.getProfile();
      return profile.role === 'admin';
    } catch (error) {
      if (!shouldRetry(error)) return undefined;
    }

    const refreshedToken = await user.getIdToken(true);
    await dependencies.storeToken(refreshedToken);
    const profile = await dependencies.getProfile();
    return profile.role === 'admin';
  } catch {
    return undefined;
  }
}

export function applyAdminRoleResult(current: boolean, resolved: boolean | undefined): boolean {
  return resolved === undefined ? current : resolved;
}

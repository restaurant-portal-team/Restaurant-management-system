import { ApiError, apiGet, apiPost } from '../../lib/api-client';

/** Authenticated staff roles. Customers are unauthenticated guests (decision A2). */
export type StaffRole = 'OWNER' | 'KITCHEN_STAFF' | 'WAITER';

/** Contract of GET /api/v1/auth/me and the `user` of POST /api/v1/auth/login. */
export interface StaffProfile {
  id: string;
  fullName: string;
  email: string;
  role: StaffRole;
}

const STAFF_ROLES: readonly string[] = ['OWNER', 'KITCHEN_STAFF', 'WAITER'];

/** Never trust response shapes blindly: anything that is not a valid profile is an error. */
function parseProfile(value: unknown): StaffProfile {
  if (typeof value === 'object' && value !== null) {
    const { id, fullName, email, role } = value as Record<string, unknown>;
    if (
      typeof id === 'string' &&
      typeof fullName === 'string' &&
      typeof email === 'string' &&
      typeof role === 'string' &&
      STAFF_ROLES.includes(role)
    ) {
      return { id, fullName, email, role: role as StaffRole };
    }
  }
  throw new ApiError('Unexpected response from the server.', null);
}

/** Returns the signed-in staff member, or null when there is no valid session (401). */
export async function fetchCurrentStaff(signal?: AbortSignal): Promise<StaffProfile | null> {
  try {
    return parseProfile(await apiGet<unknown>('/auth/me', { signal }));
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function login(email: string, password: string): Promise<StaffProfile> {
  const body = await apiPost<{ user?: unknown }>('/auth/login', { email, password });
  return parseProfile(body.user);
}

export function logout(): Promise<void> {
  return apiPost<undefined>('/auth/logout');
}

const ROLE_HOME: Record<StaffRole, string> = {
  OWNER: '/owner',
  KITCHEN_STAFF: '/kitchen',
  WAITER: '/waiter',
};

const ROLE_LABEL: Record<StaffRole, string> = {
  OWNER: 'Owner',
  KITCHEN_STAFF: 'Kitchen staff',
  WAITER: 'Waiter',
};

export function roleHome(role: StaffRole): string {
  return ROLE_HOME[role];
}

export function roleLabel(role: StaffRole): string {
  return ROLE_LABEL[role];
}

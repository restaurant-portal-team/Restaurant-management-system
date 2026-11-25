import { ApiError, apiGet, apiPatch, apiPost } from '../../lib/api-client';
import type { StaffRole } from '../auth/auth-api';

/** Roles the owner can assign (decision S3: never OWNER). */
export type ManagedRole = Exclude<StaffRole, 'OWNER'>;
export const MANAGED_ROLES: readonly ManagedRole[] = ['KITCHEN_STAFF', 'WAITER'];

export type StaffStatus = 'PENDING' | 'ACTIVE' | 'DEACTIVATED';

/** Contract of the staff objects returned by /api/v1/staff (no hashes, tokens or internal flags). */
export interface StaffMember {
  id: string;
  fullName: string;
  email: string;
  role: ManagedRole;
  status: StaffStatus;
  createdAt: string;
  activatedAt: string | null;
  deactivatedAt: string | null;
}

/** One-time setup link. Shown to the owner once; never stored by the frontend. */
export interface SetupLink {
  url: string;
  expiresAt: string;
}

const STATUSES: readonly string[] = ['PENDING', 'ACTIVE', 'DEACTIVATED'];
const unexpected = () => new ApiError('Unexpected response from the server.', null);

const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

function parseStaff(value: unknown): StaffMember {
  if (typeof value !== 'object' || value === null) throw unexpected();
  const { id, fullName, email, role, status, createdAt, activatedAt, deactivatedAt } = value as Record<string, unknown>;
  if (
    typeof id !== 'string' ||
    typeof fullName !== 'string' ||
    typeof email !== 'string' ||
    typeof role !== 'string' ||
    !(MANAGED_ROLES as readonly string[]).includes(role) ||
    typeof status !== 'string' ||
    !STATUSES.includes(status) ||
    typeof createdAt !== 'string' ||
    !isNullableString(activatedAt) ||
    !isNullableString(deactivatedAt)
  ) {
    throw unexpected();
  }
  return {
    id,
    fullName,
    email,
    role: role as ManagedRole,
    status: status as StaffStatus,
    createdAt,
    activatedAt,
    deactivatedAt,
  };
}

/** Accepts only a setup URL on this app's own origin (defence in depth against a tampered response). */
function parseSetupLink(value: unknown): SetupLink {
  if (typeof value !== 'object' || value === null) throw unexpected();
  const { url, expiresAt } = value as Record<string, unknown>;
  if (typeof url !== 'string' || typeof expiresAt !== 'string') throw unexpected();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw unexpected();
  }
  if (parsed.pathname !== '/setup-password' || !/^#token=[A-Za-z0-9_-]{43}$/.test(parsed.hash)) throw unexpected();
  return { url, expiresAt };
}

function staffOf(body: { staff?: unknown }): StaffMember {
  return parseStaff(body.staff);
}

export async function fetchStaff(signal?: AbortSignal): Promise<StaffMember[]> {
  const body = await apiGet<{ staff?: unknown }>('/staff', { signal });
  if (!Array.isArray(body.staff)) throw unexpected();
  return body.staff.map(parseStaff);
}

export interface StaffInput {
  fullName: string;
  email: string;
  role: ManagedRole;
}

export async function createStaff(input: StaffInput): Promise<{ staff: StaffMember; setup: SetupLink }> {
  const body = await apiPost<{ staff?: unknown; setup?: unknown }>('/staff', input);
  return { staff: staffOf(body), setup: parseSetupLink(body.setup) };
}

export async function updateStaff(id: string, changes: Partial<StaffInput>): Promise<StaffMember> {
  return staffOf(await apiPatch<{ staff?: unknown }>(`/staff/${encodeURIComponent(id)}`, changes));
}

export async function deactivateStaff(id: string): Promise<StaffMember> {
  return staffOf(await apiPost<{ staff?: unknown }>(`/staff/${encodeURIComponent(id)}/deactivate`));
}

export async function activateStaff(id: string): Promise<StaffMember> {
  return staffOf(await apiPost<{ staff?: unknown }>(`/staff/${encodeURIComponent(id)}/activate`));
}

export async function regenerateSetupLink(id: string): Promise<SetupLink> {
  const body = await apiPost<{ setup?: unknown }>(`/staff/${encodeURIComponent(id)}/setup-link`);
  return parseSetupLink(body.setup);
}

/** Public: completes the one-time account setup. */
export function completeSetup(token: string, password: string): Promise<void> {
  return apiPost<undefined>('/staff/setup-password', { token, password });
}

export const STATUS_LABEL: Record<StaffStatus, string> = {
  PENDING: 'Pending setup',
  ACTIVE: 'Active',
  DEACTIVATED: 'Deactivated',
};

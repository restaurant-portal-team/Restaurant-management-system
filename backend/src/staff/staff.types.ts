import type { Prisma } from '../generated/prisma/client.js';
import type { StaffRole } from '../generated/prisma/enums.js';

/**
 * F05 staff management types and the account lifecycle (decisions S3/S4, human approval 2026-11-26).
 *
 * Lifecycle (derived from existing columns; no migration):
 *   PENDING      is_active = false, deactivated_at IS NULL (and never activated: activated_at IS NULL,
 *                password_hash IS NULL). Only these accounts accept setup links and email changes.
 *   ACTIVE       is_active = true (DB CHECK: requires password_hash and activated_at).
 *   DEACTIVATED  is_active = false, deactivated_at IS NOT NULL. activated_at tells whether the account
 *                was ever activated; only previously activated accounts can be reactivated.
 *
 * Transitions: create -> PENDING; setup-password: PENDING -> ACTIVE; deactivate: PENDING|ACTIVE -> DEACTIVATED;
 * activate: DEACTIVATED (previously activated, password set) -> ACTIVE. Nothing else.
 */

/** Roles that Staff Management may create or assign. OWNER is never managed here (S3). */
export const MANAGED_ROLES = ['KITCHEN_STAFF', 'WAITER'] as const satisfies readonly StaffRole[];
export type ManagedRole = (typeof MANAGED_ROLES)[number];

export const STAFF_STATUSES = ['PENDING', 'ACTIVE', 'DEACTIVATED'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

/** Public shape of a staff account. Never includes password hashes, token hashes or session data. */
export interface StaffView {
  id: string;
  fullName: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  createdAt: string;
  activatedAt: string | null;
  deactivatedAt: string | null;
}

/** One-time setup link (returned only by create and setup-link regeneration). */
export interface SetupLink {
  url: string;
  expiresAt: string;
}

export const STAFF_VIEW_SELECT = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  isActive: true,
  activatedAt: true,
  deactivatedAt: true,
  createdAt: true,
} as const;

export interface StaffRow {
  id: string;
  fullName: string;
  email: string;
  role: StaffRole;
  isActive: boolean;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
}

export function staffStatus(row: Pick<StaffRow, 'isActive' | 'deactivatedAt'>): StaffStatus {
  if (row.isActive) return 'ACTIVE';
  return row.deactivatedAt === null ? 'PENDING' : 'DEACTIVATED';
}

export function toStaffView(row: StaffRow): StaffView {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    status: staffStatus(row),
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
  };
}

/** Only staff accounts (never OWNER) are visible to or changeable by Staff Management. */
export const MANAGED_ROLE_WHERE: Prisma.EnumStaffRoleFilter = {
  in: [...MANAGED_ROLES],
};

/** Pending AND never activated: the only state that accepts setup links, email changes and password setup. */
export const ELIGIBLE_PENDING_WHERE: Prisma.UserWhereInput = {
  role: MANAGED_ROLE_WHERE,
  isActive: false,
  activatedAt: null,
  deactivatedAt: null,
  passwordHash: null,
};

export function statusWhere(status: StaffStatus | undefined): Prisma.UserWhereInput {
  switch (status) {
    case 'ACTIVE':
      return { isActive: true };
    case 'PENDING':
      return { isActive: false, deactivatedAt: null };
    case 'DEACTIVATED':
      return { isActive: false, deactivatedAt: { not: null } };
    default:
      return {};
  }
}

import type { Request } from 'express';
import type { StaffRole } from '../generated/prisma/enums.js';

/** The authenticated staff member attached to a request by SessionAuthGuard. Role always comes from the DB. */
export interface AuthenticatedStaff {
  id: string;
  fullName: string;
  email: string;
  role: StaffRole;
  sessionId: string;
}

/** Public shape returned by /auth/login and /auth/me (no hashes, tokens or session ids). */
export interface StaffProfile {
  id: string;
  fullName: string;
  email: string;
  role: StaffRole;
}

const authenticated = new WeakMap<Request, AuthenticatedStaff>();

export function setAuthenticatedStaff(request: Request, staff: AuthenticatedStaff): void {
  authenticated.set(request, staff);
}

export function getAuthenticatedStaff(request: Request): AuthenticatedStaff | undefined {
  return authenticated.get(request);
}

export function toProfile(staff: AuthenticatedStaff | StaffProfile): StaffProfile {
  return { id: staff.id, fullName: staff.fullName, email: staff.email, role: staff.role };
}

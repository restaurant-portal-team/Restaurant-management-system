import { createParamDecorator, type ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { StaffRole } from '../generated/prisma/enums.js';
import { AUTH_REQUIRED_MESSAGE, IS_PUBLIC_KEY, ROLES_KEY } from './auth.constants.js';
import { type AuthenticatedStaff, getAuthenticatedStaff } from './auth.types.js';

/** Opts a route out of the global deny-by-default authentication guard. Use sparingly. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route (or controller) to the listed staff roles. Checked server-side by RolesGuard. */
export const Roles = (...roles: StaffRole[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

/** Injects the authenticated staff member (only on non-public routes). */
export const CurrentStaff = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedStaff => {
  const staff = getAuthenticatedStaff(context.switchToHttp().getRequest<Request>());
  if (!staff) throw new UnauthorizedException(AUTH_REQUIRED_MESSAGE);
  return staff;
});

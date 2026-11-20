import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { getRequestId } from '../common/request-id.middleware.js';
import type { AppConfig } from '../config/env.validation.js';
import type { StaffRole } from '../generated/prisma/enums.js';
import {
  AUTH_REQUIRED_MESSAGE,
  FORBIDDEN_MESSAGE,
  IS_PUBLIC_KEY,
  ORIGIN_REJECTED_MESSAGE,
  ROLES_KEY,
  SESSION_COOKIE,
} from './auth.constants.js';
import { getAuthenticatedStaff, setAuthenticatedStaff } from './auth.types.js';
import { SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function readSessionCookie(request: Request): string | undefined {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[SESSION_COOKIE];
  return typeof value === 'string' ? value : undefined;
}

/**
 * CSRF defence for cookie-authenticated mutations (together with SameSite=Strict):
 * every state-changing request must carry an Origin header from the CORS allowlist.
 * Applies to public routes too (login, logout).
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: ReadonlySet<string>;
  private readonly logger = new Logger('Security');

  constructor(config: ConfigService<AppConfig, true>) {
    this.allowed = new Set(config.get('CORS_ORIGINS', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    const origin = request.headers.origin;
    if (typeof origin === 'string' && this.allowed.has(origin)) return true;
    this.logger.warn(`origin_rejected ${request.method} ${request.path} [${getRequestId(request) ?? '-'}]`);
    throw new ForbiddenException(ORIGIN_REJECTED_MESSAGE);
  }
}

/** Global, deny-by-default authentication. Only routes marked @Public() skip it. */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const staff = await this.sessions.validate(readSessionCookie(request));
    if (!staff) throw new UnauthorizedException(AUTH_REQUIRED_MESSAGE);
    setAuthenticatedStaff(request, staff);
    return true;
  }
}

/** Role-based access control. Routes without @Roles() only require authentication. */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger('Security');

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles === undefined || roles.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const staff = getAuthenticatedStaff(request);
    if (!staff) throw new UnauthorizedException(AUTH_REQUIRED_MESSAGE);
    if (roles.includes(staff.role)) return true;

    this.logger.warn(
      `forbidden_role user=${staff.id} role=${staff.role} ${request.method} ${request.path} [${getRequestId(request) ?? '-'}]`,
    );
    throw new ForbiddenException(FORBIDDEN_MESSAGE);
  }
}

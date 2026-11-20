import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { INVALID_CREDENTIALS_MESSAGE } from './auth.constants.js';
import type { StaffProfile } from './auth.types.js';
import { normalizeEmail, verifyAgainstDummy, verifyPassword } from './password.js';
import { type CreatedSession, SessionService } from './session.service.js';

export interface LoginResult {
  profile: StaffProfile;
  session: CreatedSession;
}

/**
 * Staff login (F03). Every failure path returns the same generic 401 and costs the same Argon2
 * verification time, so callers cannot tell unknown, inactive or not-yet-activated accounts apart.
 * Logs contain a reason code and the user id when known, never emails, passwords or tokens.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async login(emailInput: string, password: string, requestId: string | undefined): Promise<LoginResult> {
    const email = normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, fullName: true, email: true, role: true, isActive: true, passwordHash: true },
    });

    if (!user?.passwordHash || !user.isActive) {
      await verifyAgainstDummy(password);
      this.logFailure(user ? (user.isActive ? 'no_password' : 'inactive') : 'unknown_account', requestId, user?.id);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      this.logFailure('bad_password', requestId, user.id);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const session = await this.sessions.create(user.id);
    this.logger.log(`login_succeeded user=${user.id} [${requestId ?? '-'}]`);
    return {
      profile: { id: user.id, fullName: user.fullName, email: user.email, role: user.role },
      session,
    };
  }

  private logFailure(reason: string, requestId: string | undefined, userId?: string): void {
    this.logger.warn(`login_failed reason=${reason} user=${userId ?? '-'} [${requestId ?? '-'}]`);
  }
}

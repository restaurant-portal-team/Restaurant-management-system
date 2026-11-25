import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedStaff } from '../auth/auth.types.js';
import { hashPassword, newPasswordProblem } from '../auth/password.js';
import { InvalidNameError, normalizeName } from '../common/name-normalization.js';
import type { AppConfig } from '../config/env.validation.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto.js';
import {
  buildSetupUrl,
  generateSetupToken,
  hashSetupToken,
  INVALID_SETUP_LINK_MESSAGE,
  SETUP_TOKEN_PATTERN,
  SETUP_TOKEN_TTL_MS,
} from './setup-token.js';
import {
  ELIGIBLE_PENDING_WHERE,
  MANAGED_ROLE_WHERE,
  type SetupLink,
  STAFF_VIEW_SELECT,
  type StaffStatus,
  type StaffView,
  staffStatus,
  statusWhere,
  toStaffView,
} from './staff.types.js';

type Tx = Prisma.TransactionClient;

const FULL_NAME_MAX = 120;
const LIST_LIMIT = 200;

export const STAFF_NOT_FOUND_MESSAGE = 'Staff member not found.';
export const DUPLICATE_EMAIL_MESSAGE = 'A staff member with this email already exists.';

export interface CreatedStaff {
  staff: StaffView;
  setup: SetupLink;
}

/** Thrown inside a transaction to roll it back; mapped to the generic invalid-link 400 outside. */
class SetupRejected extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/**
 * F05 Owner staff management (human-approved 2026-11-26, decisions S1-S6).
 *
 * Concurrency: every state change is a conditional UPDATE whose WHERE clause re-states the required
 * lifecycle state, so PostgreSQL row locks plus READ COMMITTED re-evaluation make concurrent requests
 * serialize safely (the loser updates 0 rows and is rejected). Lock order is always
 * users -> staff_setup_tokens -> staff_sessions to avoid deadlocks.
 *
 * Logging (S5): action, actor id, target id, request id. Never emails, names, passwords, tokens or hashes.
 */
@Injectable()
export class StaffService {
  private readonly logger = new Logger('Staff');
  private readonly webOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    // Trusted configuration: the first allowed CORS origin is the web application (never a Host header).
    const origin = config.get('CORS_ORIGINS', { infer: true })[0];
    if (origin === undefined) throw new Error('CORS_ORIGIN must list the web application origin.');
    this.webOrigin = origin;
  }

  async list(status: StaffStatus | undefined): Promise<StaffView[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: MANAGED_ROLE_WHERE, ...statusWhere(status) },
      select: STAFF_VIEW_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: LIST_LIMIT,
    });
    return rows.map(toStaffView);
  }

  async create(dto: CreateStaffDto, actor: AuthenticatedStaff, requestId?: string): Promise<CreatedStaff> {
    const fullName = this.normalizeFullName(dto.fullName);
    const now = new Date();
    const { token, tokenHash } = generateSetupToken();
    const expiresAt = new Date(now.getTime() + SETUP_TOKEN_TTL_MS);

    let row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            fullName,
            email: dto.email,
            role: dto.role,
            isActive: false,
            createdById: actor.id,
            createdAt: now,
          },
          select: STAFF_VIEW_SELECT,
        });
        await tx.staffSetupToken.create({
          data: { userId: created.id, tokenHash, createdAt: now, expiresAt },
          select: { id: true },
        });
        return created;
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE_EMAIL_MESSAGE);
      throw error;
    }

    this.audit('staff_created', actor, row.id, requestId, `role=${row.role}`);
    return {
      staff: toStaffView(row),
      setup: {
        url: buildSetupUrl(this.webOrigin, token),
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  async update(id: string, dto: UpdateStaffDto, actor: AuthenticatedStaff, requestId?: string): Promise<StaffView> {
    if (dto.fullName === undefined && dto.email === undefined && dto.role === undefined) {
      throw new BadRequestException('Provide at least one of fullName, email or role.');
    }
    const fullName = dto.fullName === undefined ? undefined : this.normalizeFullName(dto.fullName);
    const now = new Date();
    const changes: string[] = [];

    let row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const current = await this.findManaged(tx, id);

        if (dto.email !== undefined && dto.email !== current.email) {
          // S4: only accounts that are pending and were never activated; old setup links die atomically.
          const updated = await tx.user.updateMany({
            where: { id, ...ELIGIBLE_PENDING_WHERE },
            data: { email: dto.email },
          });
          if (updated.count !== 1) {
            throw new ConflictException('Email can only be changed before the staff member completes account setup.');
          }
          await this.expireOutstandingTokens(tx, id, now);
          changes.push('email');
        }

        if (dto.role !== undefined && dto.role !== current.role) {
          const updated = await tx.user.updateMany({
            where: {
              id,
              role: { in: MANAGED_ROLE_WHERE.in ?? [], not: dto.role },
            },
            data: { role: dto.role },
          });
          if (updated.count === 1) {
            // S3: a role change revokes every existing session of that account.
            await this.revokeSessions(tx, id, now);
            changes.push('role');
          }
        }

        if (fullName !== undefined && fullName !== current.fullName) {
          await tx.user.updateMany({
            where: { id, role: MANAGED_ROLE_WHERE },
            data: { fullName },
          });
          changes.push('fullName');
        }

        return this.findManaged(tx, id);
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE_EMAIL_MESSAGE);
      throw error;
    }

    if (changes.length > 0) this.audit('staff_updated', actor, id, requestId, `fields=${changes.join(',')}`);
    return toStaffView(row);
  }

  async deactivate(id: string, actor: AuthenticatedStaff, requestId?: string): Promise<StaffView> {
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id, role: MANAGED_ROLE_WHERE, deactivatedAt: null },
        data: { isActive: false, deactivatedAt: now },
      });
      if (updated.count !== 1) {
        await this.findManaged(tx, id); // 404 for unknown or OWNER accounts
        throw new ConflictException('This staff member is already deactivated.');
      }
      await this.expireOutstandingTokens(tx, id, now);
      await this.revokeSessions(tx, id, now);
      return this.findManaged(tx, id);
    });
    this.audit('staff_deactivated', actor, id, requestId);
    return toStaffView(row);
  }

  async activate(id: string, actor: AuthenticatedStaff, requestId?: string): Promise<StaffView> {
    const row = await this.prisma.$transaction(async (tx) => {
      // Only previously activated accounts that still have a password (DB CHECK users_active_requires_setup_chk).
      const updated = await tx.user.updateMany({
        where: {
          id,
          role: MANAGED_ROLE_WHERE,
          isActive: false,
          deactivatedAt: { not: null },
          activatedAt: { not: null },
          passwordHash: { not: null },
        },
        data: { isActive: true, deactivatedAt: null },
      });
      if (updated.count !== 1) {
        const current = await this.findManaged(tx, id);
        const status = staffStatus(current);
        if (status === 'ACTIVE') throw new ConflictException('This staff member is already active.');
        if (status === 'PENDING') {
          throw new ConflictException('This staff member has not completed account setup yet. Share their setup link.');
        }
        throw new ConflictException('This account never completed setup and cannot be reactivated.');
      }
      return this.findManaged(tx, id);
    });
    this.audit('staff_activated', actor, id, requestId);
    return toStaffView(row);
  }

  /** Issues a new one-time setup link for an eligible pending account; all older links stop working. */
  async regenerateSetupLink(id: string, actor: AuthenticatedStaff, requestId?: string): Promise<SetupLink> {
    const now = new Date();
    const { token, tokenHash } = generateSetupToken();
    const expiresAt = new Date(now.getTime() + SETUP_TOKEN_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      // Locks the user row and re-checks eligibility (never a password reset for activated accounts).
      const locked = await tx.user.updateMany({
        where: { id, ...ELIGIBLE_PENDING_WHERE },
        data: { updatedAt: now },
      });
      if (locked.count !== 1) {
        await this.findManaged(tx, id);
        throw new ConflictException('Setup links are only available for staff who have not completed account setup.');
      }
      await this.expireOutstandingTokens(tx, id, now);
      await tx.staffSetupToken.create({
        data: { userId: id, tokenHash, createdAt: now, expiresAt },
        select: { id: true },
      });
    });

    this.audit('staff_setup_link_issued', actor, id, requestId);
    return {
      url: buildSetupUrl(this.webOrigin, token),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Public: consumes a setup token exactly once and activates the pending account.
   * Every unusable link gets the same generic 400; the transaction rolls back on any failure.
   */
  async completeSetup(rawToken: string, password: string, requestId?: string): Promise<void> {
    if (!SETUP_TOKEN_PATTERN.test(rawToken)) throw new BadRequestException(INVALID_SETUP_LINK_MESSAGE);
    const tokenHash = hashSetupToken(rawToken);

    const token = await this.prisma.staffSetupToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { email: true } },
      },
    });
    if (token?.usedAt !== null || token.expiresAt.getTime() <= Date.now()) {
      this.logger.warn(
        `setup_rejected reason=${token ? 'used_or_expired' : 'unknown_token'} user=${token?.userId ?? '-'} [${requestId ?? '-'}]`,
      );
      throw new BadRequestException(INVALID_SETUP_LINK_MESSAGE);
    }

    const problem = newPasswordProblem(password, token.user.email);
    if (problem !== null) throw new BadRequestException(problem);
    const passwordHash = await hashPassword(password);
    const now = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        // 1. Lock the user row; it must still be pending and never activated (not deactivated meanwhile).
        const activated = await tx.user.updateMany({
          where: { id: token.userId, ...ELIGIBLE_PENDING_WHERE },
          data: { passwordHash, isActive: true, activatedAt: now },
        });
        if (activated.count !== 1) throw new SetupRejected('account_not_pending');

        // 2. Claim the token exactly once (re-evaluated after any concurrent replacement or expiry).
        const claimed = await tx.staffSetupToken.updateMany({
          where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (claimed.count !== 1) throw new SetupRejected('token_already_used_or_replaced');

        // 3. No other link of this account may remain usable.
        await this.expireOutstandingTokens(tx, token.userId, now);
      });
    } catch (error: unknown) {
      if (error instanceof SetupRejected) {
        this.logger.warn(`setup_rejected reason=${error.message} user=${token.userId} [${requestId ?? '-'}]`);
        throw new BadRequestException(INVALID_SETUP_LINK_MESSAGE);
      }
      throw error;
    }

    this.logger.log(`staff_setup_completed user=${token.userId} [${requestId ?? '-'}]`);
  }

  // ─── helpers ────────────────────────────────────────────────────────────────

  /** Reads a managed (non-OWNER) account; OWNER and unknown ids are indistinguishable (404). */
  private async findManaged(tx: Tx, id: string) {
    const row = await tx.user.findFirst({
      where: { id, role: MANAGED_ROLE_WHERE },
      select: STAFF_VIEW_SELECT,
    });
    if (!row) throw new NotFoundException(STAFF_NOT_FOUND_MESSAGE);
    return row;
  }

  private async expireOutstandingTokens(tx: Tx, userId: string, now: Date): Promise<void> {
    await tx.staffSetupToken.updateMany({
      where: { userId, usedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
  }

  private async revokeSessions(tx: Tx, userId: string, now: Date): Promise<void> {
    await tx.staffSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  private normalizeFullName(raw: string): string {
    try {
      return normalizeName(raw, FULL_NAME_MAX).name;
    } catch (error: unknown) {
      if (error instanceof InvalidNameError) throw new BadRequestException(`fullName: ${error.message}`);
      throw error;
    }
  }

  private audit(action: string, actor: AuthenticatedStaff, targetId: string, requestId?: string, detail = ''): void {
    this.logger.log(
      `${action} actor=${actor.id} target=${targetId}${detail ? ` ${detail}` : ''} [${requestId ?? '-'}]`,
    );
  }
}

import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/env.validation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SESSION_TOUCH_INTERVAL_MS } from './auth.constants.js';
import type { AuthenticatedStaff } from './auth.types.js';

/** 32 random bytes, base64url without padding = 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

/**
 * Server-side staff sessions (decision D1).
 * - The plain token exists only in the cookie; the database stores its SHA-256 hash.
 * - Validation re-checks revocation, absolute expiry, idle timeout and users.is_active on EVERY request,
 *   so deactivated staff lose access immediately (requirements section 4).
 * - Sessions are revoked (revoked_at), never deleted (decision D5).
 */
@Injectable()
export class SessionService {
  private readonly absoluteTtlMs: number;
  private readonly idleTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.absoluteTtlMs = config.get('SESSION_ABSOLUTE_TTL_MINUTES', { infer: true }) * 60_000;
    this.idleTimeoutMs = config.get('SESSION_IDLE_TIMEOUT_MINUTES', { infer: true }) * 60_000;
  }

  async create(userId: string, now = new Date()): Promise<CreatedSession> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.absoluteTtlMs);
    await this.prisma.staffSession.create({
      data: { userId, tokenHash: hashSessionToken(token), createdAt: now, lastSeenAt: now, expiresAt },
      select: { id: true },
    });
    return { token, expiresAt };
  }

  /** Returns the authenticated staff member, or null if the token is unknown, expired, idle, revoked or the user is inactive. */
  async validate(token: string | undefined, now = new Date()): Promise<AuthenticatedStaff | null> {
    if (token === undefined || !TOKEN_PATTERN.test(token)) return null;

    const session = await this.prisma.staffSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: {
        id: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { id: true, fullName: true, email: true, role: true, isActive: true } },
      },
    });
    // Unknown token, or a session that was already revoked.
    if (session?.revokedAt !== null) return null;

    const expired = session.expiresAt.getTime() <= now.getTime();
    const idle = now.getTime() - session.lastSeenAt.getTime() >= this.idleTimeoutMs;
    if (expired || idle || !session.user.isActive) {
      await this.revoke(session.id, now);
      return null;
    }

    if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
      await this.prisma.staffSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { lastSeenAt: now },
      });
    }

    const { user } = session;
    return { id: user.id, fullName: user.fullName, email: user.email, role: user.role, sessionId: session.id };
  }

  /** Idempotent: revoking an already revoked session changes nothing. */
  async revoke(sessionId: string, now = new Date()): Promise<void> {
    await this.prisma.staffSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  /** Revokes the session behind a raw cookie token, if any (used by logout and re-login). */
  async revokeByToken(token: string | undefined, now = new Date()): Promise<void> {
    if (token === undefined || !TOKEN_PATTERN.test(token)) return;
    await this.prisma.staffSession.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null },
      data: { revokedAt: now },
    });
  }
}

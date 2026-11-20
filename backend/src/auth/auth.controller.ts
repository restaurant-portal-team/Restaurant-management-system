import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { getRequestId } from '../common/request-id.middleware.js';
import type { AppConfig } from '../config/env.validation.js';
import { LOGIN_THROTTLE, SESSION_COOKIE, SESSION_COOKIE_PATH } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import { type AuthenticatedStaff, type StaffProfile, toProfile } from './auth.types.js';
import { CurrentStaff, Public } from './decorators.js';
import { LoginDto } from './dto/login.dto.js';
import { readSessionCookie } from './guards.js';
import { SessionService } from './session.service.js';

@Controller('auth')
export class AuthController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.secureCookie = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  /** Creates a NEW session on every login (no session fixation); any previous session cookie is revoked. */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: LOGIN_THROTTLE })
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: StaffProfile }> {
    const { profile, session } = await this.auth.login(body.email, body.password, getRequestId(request));
    await this.sessions.revokeByToken(readSessionCookie(request));
    response.cookie(SESSION_COOKIE, session.token, { ...this.cookieOptions(), expires: session.expiresAt });
    return { user: profile };
  }

  /** Idempotent and public, so a stale or expired cookie can always be cleared. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.sessions.revokeByToken(readSessionCookie(request));
    response.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@CurrentStaff() staff: AuthenticatedStaff): StaffProfile {
    return toProfile(staff);
  }

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.secureCookie, sameSite: 'strict', path: SESSION_COOKIE_PATH };
  }
}

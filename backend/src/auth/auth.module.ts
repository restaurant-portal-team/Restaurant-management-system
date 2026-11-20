import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OriginGuard, RolesGuard, SessionAuthGuard } from './guards.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, OriginGuard, SessionAuthGuard, RolesGuard],
  exports: [SessionService, OriginGuard, SessionAuthGuard, RolesGuard],
})
export class AuthModule {}

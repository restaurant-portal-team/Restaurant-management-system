import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthenticatedStaff } from '../auth/auth.types.js';
import { CurrentStaff, Public, Roles } from '../auth/decorators.js';
import { getRequestId } from '../common/request-id.middleware.js';
import { CreateStaffDto, ListStaffQuery, SetupPasswordDto, UpdateStaffDto } from './dto/staff.dto.js';
import { SETUP_PASSWORD_THROTTLE } from './setup-token.js';
import { type CreatedStaff, StaffService } from './staff.service.js';
import type { SetupLink, StaffView } from './staff.types.js';

const uuid = new ParseUUIDPipe({ version: undefined });

/** Owner-only staff management (F05). Every route is OWNER-only on the server (RolesGuard). */
@Controller('staff')
@Roles('OWNER')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Query() query: ListStaffQuery): Promise<{ staff: StaffView[] }> {
    return { staff: await this.staff.list(query.status) };
  }

  /** The raw setup link is returned exactly once (here or from setup-link) and must not be cached. */
  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @Body() body: CreateStaffDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @Req() req: Request,
  ): Promise<CreatedStaff> {
    return this.staff.create(body, actor, getRequestId(req));
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  async update(
    @Param('id', uuid) id: string,
    @Body() body: UpdateStaffDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @Req() req: Request,
  ): Promise<{ staff: StaffView }> {
    return {
      staff: await this.staff.update(id, body, actor, getRequestId(req)),
    };
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async deactivate(
    @Param('id', uuid) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
    @Req() req: Request,
  ): Promise<{ staff: StaffView }> {
    return { staff: await this.staff.deactivate(id, actor, getRequestId(req)) };
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async activate(
    @Param('id', uuid) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
    @Req() req: Request,
  ): Promise<{ staff: StaffView }> {
    return { staff: await this.staff.activate(id, actor, getRequestId(req)) };
  }

  @Post(':id/setup-link')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async regenerateSetupLink(
    @Param('id', uuid) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
    @Req() req: Request,
  ): Promise<{ setup: SetupLink }> {
    return {
      setup: await this.staff.regenerateSetupLink(id, actor, getRequestId(req)),
    };
  }
}

/** Public one-time account setup (requirements section 9). Origin check and a strict rate limit still apply. */
@Controller('staff')
export class StaffSetupController {
  constructor(private readonly staff: StaffService) {}

  @Public()
  @Post('setup-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: SETUP_PASSWORD_THROTTLE })
  @Header('Cache-Control', 'no-store')
  async setupPassword(@Body() body: SetupPasswordDto, @Req() req: Request): Promise<void> {
    await this.staff.completeSetup(body.token, body.password, getRequestId(req));
  }
}

import { Module } from '@nestjs/common';
import { StaffController, StaffSetupController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

@Module({
  // StaffSetupController is registered first so POST /staff/setup-password is never shadowed.
  controllers: [StaffSetupController, StaffController],
  providers: [StaffService],
})
export class StaffModule {}

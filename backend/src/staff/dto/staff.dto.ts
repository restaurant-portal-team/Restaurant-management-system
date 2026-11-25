import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../auth/password.js';
import { INVALID_SETUP_LINK_MESSAGE, SETUP_TOKEN_PATTERN } from '../setup-token.js';
import { MANAGED_ROLES, type ManagedRole, STAFF_STATUSES, type StaffStatus } from '../staff.types.js';

/*
 * Unknown fields (e.g. isActive, passwordHash, createdById, role: OWNER) are rejected by the global
 * ValidationPipe (whitelist + forbidNonWhitelisted). The service re-validates names and business rules.
 */

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);
const trimLower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Full name: normalised in the service (trim, collapse spaces, no control characters, max 120). */
const FULL_NAME_MAX = 120;

export class CreateStaffDto {
  @IsString()
  @Length(1, FULL_NAME_MAX * 2)
  fullName!: string;

  @Transform(trimLower)
  @IsString()
  @MaxLength(254)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @IsIn(MANAGED_ROLES, { message: 'role must be KITCHEN_STAFF or WAITER' })
  role!: ManagedRole;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @Length(1, FULL_NAME_MAX * 2)
  fullName?: string;

  @IsOptional()
  @Transform(trimLower)
  @IsString()
  @MaxLength(254)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email?: string;

  @IsOptional()
  @IsIn(MANAGED_ROLES, { message: 'role must be KITCHEN_STAFF or WAITER' })
  role?: ManagedRole;
}

export class ListStaffQuery {
  @IsOptional()
  @IsIn(STAFF_STATUSES, {
    message: 'status must be PENDING, ACTIVE or DEACTIVATED',
  })
  status?: StaffStatus;
}

export class SetupPasswordDto {
  @Transform(trim)
  @IsString()
  @Matches(SETUP_TOKEN_PATTERN, { message: INVALID_SETUP_LINK_MESSAGE })
  token!: string;

  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password!: string;
}

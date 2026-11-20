import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../password.js';

/** Unknown fields are rejected by the global ValidationPipe (whitelist + forbidNonWhitelisted). */
export class LoginDto {
  /** Surrounding spaces are trimmed before validation; the service also lower-cases. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(254)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password!: string;
}

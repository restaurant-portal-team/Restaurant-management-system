import { EnvValidationError, validateEnv } from './env.validation.js';

const SECRET = 'Sup3r-Secret-Pw';
const validRaw = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: `postgresql://restaurant_app:${SECRET}@127.0.0.1:5432/restaurant_dev?schema=public`,
  CORS_ORIGIN: 'http://localhost:5173',
};

function errorMessage(raw: Record<string, unknown>): string {
  try {
    validateEnv(raw);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return (error as Error).message;
  }
  throw new Error('expected validation to fail');
}

describe('validateEnv', () => {
  it('accepts a valid development configuration with safe defaults', () => {
    const config = validateEnv(validRaw);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      CORS_ORIGINS: ['http://localhost:5173'],
      THROTTLE_TTL_MS: 60_000,
      THROTTLE_LIMIT: 100,
    });
  });

  it('requires DATABASE_URL and never echoes values in errors', () => {
    expect(errorMessage({ ...validRaw, DATABASE_URL: undefined })).toContain(
      'DATABASE_URL is required',
    );
    const message = errorMessage({ ...validRaw, DATABASE_URL: `mysql://x:${SECRET}@h/db` });
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain(SECRET);
  });

  it('refuses to start when migration credentials leak into the runtime environment', () => {
    for (const key of ['MIGRATION_DATABASE_URL', 'SHADOW_DATABASE_URL']) {
      const message = errorMessage({ ...validRaw, [key]: `postgresql://m:${SECRET}@h/db` });
      expect(message).toContain(`${key} must not be loaded into the runtime API`);
      expect(message).not.toContain(SECRET);
    }
  });

  it('rejects wildcard or malformed CORS origins', () => {
    expect(errorMessage({ ...validRaw, CORS_ORIGIN: '*' })).toContain('"*" is not allowed');
    expect(errorMessage({ ...validRaw, CORS_ORIGIN: 'http://localhost:5173/path' })).toContain(
      'bare http(s) origins',
    );
    expect(errorMessage({ ...validRaw, CORS_ORIGIN: 'ftp://x' })).toContain('CORS_ORIGIN');
  });

  it('supports multiple explicit origins', () => {
    const config = validateEnv({
      ...validRaw,
      CORS_ORIGIN: 'http://localhost:5173, https://portal.example.test',
    });
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://portal.example.test']);
  });

  it('requires CORS_ORIGIN in production', () => {
    expect(errorMessage({ ...validRaw, NODE_ENV: 'production', CORS_ORIGIN: undefined })).toContain(
      'CORS_ORIGIN is required in production',
    );
  });

  it('validates NODE_ENV and numeric settings', () => {
    expect(errorMessage({ ...validRaw, NODE_ENV: 'staging' })).toContain('NODE_ENV');
    expect(errorMessage({ ...validRaw, PORT: '70000' })).toContain('PORT');
    expect(errorMessage({ ...validRaw, PORT: '30a' })).toContain('PORT');
  });

  it('defaults session lifetimes to 12 h absolute / 2 h idle (F03 decision D2)', () => {
    expect(validateEnv(validRaw)).toMatchObject({
      SESSION_ABSOLUTE_TTL_MINUTES: 720,
      SESSION_IDLE_TIMEOUT_MINUTES: 120,
    });
  });

  it('rejects out-of-range session settings and an idle timeout longer than the lifetime', () => {
    expect(errorMessage({ ...validRaw, SESSION_ABSOLUTE_TTL_MINUTES: '2' })).toContain(
      'SESSION_ABSOLUTE_TTL_MINUTES',
    );
    expect(
      errorMessage({ ...validRaw, SESSION_ABSOLUTE_TTL_MINUTES: '60', SESSION_IDLE_TIMEOUT_MINUTES: '90' }),
    ).toContain('must not exceed');
  });
});

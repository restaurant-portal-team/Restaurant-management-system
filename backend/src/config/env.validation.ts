/**
 * Runtime environment validation for the NestJS API.
 *
 * SECURITY:
 * - Error messages name the offending variable only; values are never echoed.
 * - Migration credentials (MIGRATION_DATABASE_URL / SHADOW_DATABASE_URL) must never be present in
 *   the runtime process. Their presence aborts startup (least privilege between runtime and DDL).
 */

export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  NODE_ENV: NodeEnv;
  HOST: string;
  PORT: number;
  DATABASE_URL: string;
  CORS_ORIGINS: string[];
  THROTTLE_TTL_MS: number;
  THROTTLE_LIMIT: number;
  /** F03 decision D2: absolute session lifetime (default 12 h). */
  SESSION_ABSOLUTE_TTL_MINUTES: number;
  /** F03 decision D2: idle timeout (default 2 h); must not exceed the absolute lifetime. */
  SESSION_IDLE_TIMEOUT_MINUTES: number;
}

export class EnvValidationError extends Error {
  constructor(problems: string[]) {
    super(`Invalid environment configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'EnvValidationError';
  }
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production'];
const FORBIDDEN_RUNTIME_VARIABLES = ['MIGRATION_DATABASE_URL', 'SHADOW_DATABASE_URL'] as const;
const DEFAULT_DEV_ORIGIN = 'http://localhost:5173';

function text(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function integer(
  raw: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
  problems: string[],
): number {
  const value = text(raw, key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || parsed < min || parsed > max) {
    problems.push(`${key} must be an integer between ${min} and ${max}.`);
    return fallback;
  }
  return parsed;
}

function validateDatabaseUrl(value: string | undefined, problems: string[]): string {
  if (value === undefined) {
    problems.push('DATABASE_URL is required.');
    return '';
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    problems.push('DATABASE_URL is not a valid URL.');
    return '';
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    problems.push('DATABASE_URL must use the postgresql:// scheme.');
  }
  if (!parsed.username || !parsed.hostname || parsed.pathname.length <= 1) {
    problems.push('DATABASE_URL must include a user, host and database name.');
  }
  return value;
}

function validateOrigins(value: string | undefined, nodeEnv: NodeEnv, problems: string[]): string[] {
  if (value === undefined) {
    if (nodeEnv === 'production') {
      problems.push('CORS_ORIGIN is required in production.');
      return [];
    }
    return [DEFAULT_DEV_ORIGIN];
  }

  const origins: string[] = [];
  for (const entry of value.split(',')) {
    const candidate = entry.trim();
    if (candidate === '*') {
      problems.push('CORS_ORIGIN must list explicit origins; "*" is not allowed.');
      continue;
    }
    try {
      const url = new URL(candidate);
      const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
      if (!isHttp || url.origin !== candidate.replace(/\/$/, '')) {
        problems.push('CORS_ORIGIN entries must be bare http(s) origins (scheme://host[:port]).');
        continue;
      }
      origins.push(url.origin);
    } catch {
      problems.push('CORS_ORIGIN contains an invalid origin.');
    }
  }
  return origins;
}

export function validateEnv(raw: Record<string, unknown>): AppConfig {
  const problems: string[] = [];

  for (const key of FORBIDDEN_RUNTIME_VARIABLES) {
    if (raw[key] !== undefined) {
      problems.push(
        `${key} must not be loaded into the runtime API. Keep migration credentials in backend/.env.migrate (Prisma CLI only).`,
      );
    }
  }

  const nodeEnvRaw = text(raw, 'NODE_ENV') ?? 'development';
  let nodeEnv: NodeEnv = 'development';
  if ((NODE_ENVS as readonly string[]).includes(nodeEnvRaw)) {
    nodeEnv = nodeEnvRaw as NodeEnv;
  } else {
    problems.push(`NODE_ENV must be one of: ${NODE_ENVS.join(', ')}.`);
  }

  const config: AppConfig = {
    NODE_ENV: nodeEnv,
    HOST: text(raw, 'HOST') ?? '127.0.0.1',
    PORT: integer(raw, 'PORT', 3000, 1, 65535, problems),
    DATABASE_URL: validateDatabaseUrl(text(raw, 'DATABASE_URL'), problems),
    CORS_ORIGINS: validateOrigins(text(raw, 'CORS_ORIGIN'), nodeEnv, problems),
    THROTTLE_TTL_MS: integer(raw, 'THROTTLE_TTL_MS', 60_000, 1_000, 3_600_000, problems),
    THROTTLE_LIMIT: integer(raw, 'THROTTLE_LIMIT', 100, 1, 100_000, problems),
    SESSION_ABSOLUTE_TTL_MINUTES: integer(raw, 'SESSION_ABSOLUTE_TTL_MINUTES', 720, 5, 1_440, problems),
    SESSION_IDLE_TIMEOUT_MINUTES: integer(raw, 'SESSION_IDLE_TIMEOUT_MINUTES', 120, 5, 1_440, problems),
  };

  if (config.SESSION_IDLE_TIMEOUT_MINUTES > config.SESSION_ABSOLUTE_TTL_MINUTES) {
    problems.push('SESSION_IDLE_TIMEOUT_MINUTES must not exceed SESSION_ABSOLUTE_TTL_MINUTES.');
  }

  if (problems.length > 0) {
    throw new EnvValidationError(problems);
  }
  return config;
}

/**
 * Loads Prisma MIGRATION credentials only.
 *
 * - Reads backend/.env.migrate with node:util.parseEnv into a private object. Values are NOT
 *   copied into process.env, and the runtime file backend/.env (DATABASE_URL) is never read.
 * - If backend/.env.migrate exists it is authoritative (shell variables are ignored, so a stray
 *   exported variable cannot silently redirect migrations).
 * - If it does not exist, MIGRATION_DATABASE_URL / SHADOW_DATABASE_URL are taken from the process
 *   environment (for environments that inject variables instead of files).
 * - DATABASE_URL is never consulted here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MIGRATION_ENV_FILE = resolve(BACKEND_ROOT, '.env.migrate');

export interface MigrationEnv {
  migrationUrl: string | undefined;
  shadowUrl: string | undefined;
  source: 'file' | 'process-env';
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

export function loadMigrationEnv(
  filePath: string = MIGRATION_ENV_FILE,
  processEnv: NodeJS.ProcessEnv = process.env,
): MigrationEnv {
  if (existsSync(filePath)) {
    const parsed = parseEnv(readFileSync(filePath, 'utf8'));
    return {
      migrationUrl: clean(parsed.MIGRATION_DATABASE_URL),
      shadowUrl: clean(parsed.SHADOW_DATABASE_URL),
      source: 'file',
    };
  }

  return {
    migrationUrl: clean(processEnv.MIGRATION_DATABASE_URL),
    shadowUrl: clean(processEnv.SHADOW_DATABASE_URL),
    source: 'process-env',
  };
}

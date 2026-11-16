import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMigrationEnv } from './migration-env.ts';

describe('loadMigrationEnv', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'f01-migration-env-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads only migration variables from the file and ignores DATABASE_URL', () => {
    const file = join(dir, '.env.migrate');
    writeFileSync(
      file,
      [
        'MIGRATION_DATABASE_URL="postgresql://m:x@localhost:5432/main"',
        'SHADOW_DATABASE_URL="postgresql://m:x@localhost:5432/shadow"',
        'DATABASE_URL="postgresql://runtime:y@localhost:5432/main"',
      ].join('\n'),
    );

    const result = loadMigrationEnv(file, {});

    expect(result).toEqual({
      migrationUrl: 'postgresql://m:x@localhost:5432/main',
      shadowUrl: 'postgresql://m:x@localhost:5432/shadow',
      source: 'file',
    });
    expect(Object.values(result)).not.toContain('postgresql://runtime:y@localhost:5432/main');
  });

  it('does not copy file values into process.env', () => {
    const file = join(dir, '.env.migrate');
    writeFileSync(file, 'MIGRATION_DATABASE_URL="postgresql://m:x@localhost/f01_probe_db"\n');
    const before = process.env.MIGRATION_DATABASE_URL;

    loadMigrationEnv(file, {});

    expect(process.env.MIGRATION_DATABASE_URL).toBe(before);
  });

  it('makes the file authoritative over stray shell variables', () => {
    const file = join(dir, '.env.migrate');
    writeFileSync(file, 'MIGRATION_DATABASE_URL="postgresql://m:x@localhost/from_file"\n');

    const result = loadMigrationEnv(file, {
      MIGRATION_DATABASE_URL: 'postgresql://m:x@localhost/from_shell',
      SHADOW_DATABASE_URL: 'postgresql://m:x@localhost/shell_shadow',
    });

    expect(result.migrationUrl).toBe('postgresql://m:x@localhost/from_file');
    expect(result.shadowUrl).toBeUndefined();
  });

  it('falls back to process variables when the file is absent, never using DATABASE_URL', () => {
    const result = loadMigrationEnv(join(dir, 'missing.env'), {
      DATABASE_URL: 'postgresql://runtime:y@localhost/main',
    });
    expect(result).toEqual({ migrationUrl: undefined, shadowUrl: undefined, source: 'process-env' });
  });
});

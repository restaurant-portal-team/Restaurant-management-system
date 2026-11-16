/**
 * OFFLINE static checks for prisma.shadow-check.config.ts (no database connection, config not executed).
 * Ensures the dry-run configuration can never hand a main-database URL to Prisma.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_ROOT } from './migration-env.ts';

const source = readFileSync(join(BACKEND_ROOT, 'prisma.shadow-check.config.ts'), 'utf8');
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

describe('prisma.shadow-check.config.ts (static)', () => {
  it('passes only shadowDatabaseUrl to the Prisma datasource', () => {
    const datasource = /datasource:\s*\{([\s\S]*?)\}/.exec(code)?.[1] ?? '';
    expect(datasource.replace(/\s+/g, '')).toBe('shadowDatabaseUrl:shadowUrl,');
    expect(code).not.toMatch(/\burl\s*:/);
  });

  it('never reads DATABASE_URL or the runtime .env file', () => {
    expect(code).not.toMatch(/\bDATABASE_URL\b/);
    expect(code).not.toMatch(/['"]\.env['"]/);
    expect(code).not.toMatch(/loadEnvFile|dotenv/);
  });

  it('applies the static isolation guard and fails closed without a shadow URL', () => {
    expect(code).toMatch(/assertShadowIsolatedStatic\(migrationUrl, shadowUrl\)/);
    expect(code).toMatch(/if \(shadowUrl === undefined\)\s*\{\s*throw/);
  });

  it('declares no url/env() in schema.prisma (no fallback datasource)', () => {
    const schema = readFileSync(join(BACKEND_ROOT, 'prisma', 'schema.prisma'), 'utf8')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    const datasourceBlock = /datasource db \{([\s\S]*?)\}/.exec(schema)?.[1] ?? '';
    expect(datasourceBlock).not.toMatch(/\burl\b|env\(/);
  });
});

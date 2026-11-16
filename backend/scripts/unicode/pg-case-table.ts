/**
 * Reads PostgreSQL's builtin-provider Unicode simple case table (unicode_case_table.h, shipped with the
 * server development headers). This is the exact data used by lower(... COLLATE "pg_c_utf8") in PostgreSQL 17.
 * Offline only: no database connection.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_PG_COMMON_INCLUDE_DIR = 'C:/Program Files/PostgreSQL/17/include/server/common';

export function pgCommonIncludeDir(): string {
  return process.env.PG_COMMON_INCLUDE_DIR ?? DEFAULT_PG_COMMON_INCLUDE_DIR;
}

export function pgCaseTableAvailable(dir: string = pgCommonIncludeDir()): boolean {
  return existsSync(join(dir, 'unicode_case_table.h')) && existsSync(join(dir, 'unicode_version.h'));
}

export interface PgCaseTable {
  unicodeVersion: string;
  /** Every case_map entry (codepoint -> simple lowercase), including identity mappings. */
  entries: Map<number, number>;
  /** Only entries whose lowercase differs from the codepoint, sorted by codepoint. */
  changing: [number, number][];
}

export function readPgCaseTable(dir: string = pgCommonIncludeDir()): PgCaseTable {
  const header = readFileSync(join(dir, 'unicode_case_table.h'), 'utf8');
  const versionHeader = readFileSync(join(dir, 'unicode_version.h'), 'utf8');

  const version = /#define\s+PG_UNICODE_VERSION\s+"([^"]+)"/.exec(versionHeader)?.[1];
  if (!version) throw new Error('PG_UNICODE_VERSION not found');

  const entries = new Map<number, number>();
  for (const match of header.matchAll(/\{0x([0-9a-f]+), \{\[CaseLower\] = 0x([0-9a-f]+),/g)) {
    entries.set(Number.parseInt(match[1] ?? '', 16), Number.parseInt(match[2] ?? '', 16));
  }
  const declared = /case_map\[(\d+)\]/.exec(header)?.[1];
  if (!declared || Number(declared) !== entries.size) {
    throw new Error(`case_map size mismatch (declared ${declared ?? '?'}, parsed ${entries.size})`);
  }

  const changing = [...entries]
    .filter(([codepoint, lower]) => codepoint !== lower)
    .sort((a, b) => a[0] - b[0]);
  return { unicodeVersion: version, entries, changing };
}

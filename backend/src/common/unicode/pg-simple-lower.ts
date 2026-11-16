import { PG_SIMPLE_LOWER_COUNT, PG_SIMPLE_LOWER_PAIRS } from './pg-simple-lower.generated.js';

/**
 * Deterministic Unicode SIMPLE lowercase identical to PostgreSQL 17 lower(text COLLATE "pg_c_utf8").
 *
 * - Per code point, context-free (no special casing): "İ" (U+0130) -> "i", final "Σ" -> "σ" (not "ς").
 * - Code points absent from PostgreSQL's table (including characters added after its Unicode version)
 *   map to themselves, exactly like PostgreSQL.
 * - Independent of the Node.js/ICU Unicode version and of the database OS locale (libc/Windows).
 */
const LOWER = new Map<number, number>();
for (let i = 0; i < PG_SIMPLE_LOWER_PAIRS.length; i += 2) {
  const codepoint = PG_SIMPLE_LOWER_PAIRS[i];
  const lower = PG_SIMPLE_LOWER_PAIRS[i + 1];
  if (codepoint === undefined || lower === undefined) throw new Error('Corrupt Unicode lowercase table');
  LOWER.set(codepoint, lower);
}
if (LOWER.size !== PG_SIMPLE_LOWER_COUNT) {
  throw new Error('Unicode lowercase table size mismatch');
}

export function pgSimpleLowerCodepoint(codepoint: number): number {
  return LOWER.get(codepoint) ?? codepoint;
}

export function pgSimpleLower(value: string): string {
  let result = '';
  for (const char of value) {
    const codepoint = char.codePointAt(0) ?? 0;
    result += String.fromCodePoint(pgSimpleLowerCodepoint(codepoint));
  }
  return result;
}

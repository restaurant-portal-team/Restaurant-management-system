/**
 * Mandatory name normalisation for menu categories, menu items and ingredients (F02 decisions Q1a/Q1b).
 *
 * Display name:  trim, collapse every internal whitespace run to ONE space, reject control characters
 *                (tabs, newlines, etc.). Unicode letters (including Urdu) are preserved unchanged.
 * Name key:      pgSimpleLower(displayName) — Unicode SIMPLE lowercase using PostgreSQL 17's own builtin
 *                case table (generated into src/common/unicode/), i.e. exactly
 *                lower(name COLLATE "pg_c_utf8").
 *
 * Database contract (migration 20261116..._name_key_builtin_lower):
 *   CHECK (name_key = lower(btrim(name) COLLATE "pg_c_utf8"))
 * A normalised display name has no leading/trailing spaces, so btrim(name) = name.
 *
 * Why not String.prototype.toLowerCase(): it applies full/contextual Unicode mappings
 * ("İ" -> "i̇", final sigma -> "ς") and follows the Node.js Unicode version (17.0), which differs from
 * PostgreSQL 17's table (Unicode 15.1) for 55 newer code points. See docs/implementation-plan.txt (Q1b).
 */
import { pgSimpleLower } from './unicode/pg-simple-lower.js';

export class InvalidNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNameError';
  }
}

export interface NormalizedName {
  name: string;
  nameKey: string;
}

/** Unicode "Cc" control characters: includes \t, \n, \r, \0 and C1 controls. */
const CONTROL_CHARACTERS = /\p{Cc}/u;
const WHITESPACE_RUN = /\s+/gu;

/**
 * @param raw        untrusted input
 * @param maxLength  maximum length in Unicode code points (matches PostgreSQL VARCHAR(n) semantics)
 */
export function normalizeName(raw: string, maxLength: number): NormalizedName {
  if (CONTROL_CHARACTERS.test(raw)) {
    throw new InvalidNameError('Name must not contain control characters (tabs, line breaks).');
  }

  const name = raw.trim().replace(WHITESPACE_RUN, ' ');

  if (name.length === 0) {
    throw new InvalidNameError('Name must not be empty.');
  }
  // Array.from iterates Unicode code points (PostgreSQL VARCHAR(n) counts characters, not UTF-16 units).
  if (Array.from(name).length > maxLength) {
    throw new InvalidNameError(`Name must be at most ${maxLength} characters.`);
  }

  return { name, nameKey: pgSimpleLower(name) };
}

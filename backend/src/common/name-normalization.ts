/**
 * Mandatory name normalisation for menu categories, menu items and ingredients (F02 decision Q1a).
 *
 * Display name:  trim, collapse every internal whitespace run to ONE space, reject control characters
 *                (tabs, newlines, etc.). Unicode letters (including Urdu) are preserved.
 * Name key:      displayName.toLowerCase()  (locale-independent JS lower-casing)
 *
 * Database contract: CHECK (name_key = lower(btrim(name))). A normalised display name has no leading or
 * trailing spaces, so btrim(name) = name and the key must equal PostgreSQL lower(name).
 * KNOWN RISK (Q1b): PostgreSQL lower() depends on the database LC_CTYPE, JS toLowerCase() on Unicode
 * case mappings. They can differ for some non-ASCII characters; a mismatch makes the DB CHECK reject the
 * write (fails safe). Compatibility is verified at Gate C; never weaken the CHECK to hide a mismatch.
 */

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

  return { name, nameKey: name.toLowerCase() };
}

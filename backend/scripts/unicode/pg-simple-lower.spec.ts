/**
 * Q1b Unicode compatibility — OFFLINE, FULL-RANGE evidence (no database connection).
 *
 * Compares the application's pgSimpleLower() with PostgreSQL 17's own builtin-provider case table
 * (unicode_case_table.h shipped with the installed server headers) for EVERY Unicode code point
 * U+0000..U+10FFFF (surrogates excluded). PostgreSQL 17 lower(text COLLATE "pg_c_utf8") maps each code
 * point through exactly this table (simple, context-free), so 0 differences = identical behaviour.
 * The live database comparison is repeated read-only at the Gate C re-run.
 */
import { pgSimpleLower, pgSimpleLowerCodepoint } from '../../src/common/unicode/pg-simple-lower.js';
import {
  PG_SIMPLE_LOWER_COUNT,
  PG_SIMPLE_LOWER_PAIRS,
  PG_UNICODE_VERSION,
} from '../../src/common/unicode/pg-simple-lower.generated.js';
import { pgCaseTableAvailable, readPgCaseTable } from './pg-case-table.ts';

const headersAvailable = pgCaseTableAvailable();

describe('PostgreSQL 17 simple lowercase table (embedded)', () => {
  it('has the expected size and Unicode version', () => {
    expect(PG_UNICODE_VERSION).toBe('15.1');
    expect(PG_SIMPLE_LOWER_COUNT).toBe(1433);
    expect(PG_SIMPLE_LOWER_PAIRS).toHaveLength(1433 * 2);
  });

  it('maps known edge cases exactly like PostgreSQL pg_c_utf8', () => {
    const cases: [string, string][] = [
      ['A', 'a'],
      ['İ', 'i'], // U+0130 Turkish dotted capital I -> plain i (simple mapping)
      ['ı', 'ı'], // U+0131 dotless i has no lowercase change
      ['I', 'i'],
      ['Σ', 'σ'], // never final sigma (context-free)
      ['ς', 'ς'], // existing final sigma stays
      ['ß', 'ß'],
      ['ẞ', 'ß'], // U+1E9E capital sharp s
      ['ǅ', 'ǆ'], // U+01C5 title-case digraph
      ['Ǆ', 'ǆ'],
      ['Ꭰ', 'ꭰ'], // U+13A0 Cherokee
      ['Ა', 'ა'], // U+1C90 Georgian Mtavruli
      ['Ω', 'ω'], // U+2126 Ohm sign
      ['K', 'k'], // U+212A Kelvin sign
      ['Å', 'å'], // U+212B Angstrom sign
      ['Ⅻ', 'ⅻ'], // U+216B Roman numeral
      ['Ⓐ', 'ⓐ'], // U+24B6 circled letter
      ['Ａ', 'ａ'], // U+FF21 fullwidth
      ['𐐀', '𐐨'], // U+10400 Deseret (astral plane)
      ['Ɤ', 'Ɤ'], // U+A7CB added after Unicode 15.1: unchanged, exactly like PostgreSQL 17
    ];
    for (const [input, expected] of cases) {
      expect(pgSimpleLower(input), `U+${(input.codePointAt(0) ?? 0).toString(16)}`).toBe(expected);
    }
  });

  it('handles approved name samples (ASCII, Urdu, accented Latin, German, Turkish, Greek)', () => {
    expect(pgSimpleLower('Chicken Pizza')).toBe('chicken pizza');
    expect(pgSimpleLower('چکن کڑاہی')).toBe('چکن کڑاہی');
    expect(pgSimpleLower('دال')).toBe('دال');
    expect(pgSimpleLower('Crème Brûlée')).toBe('crème brûlée');
    expect(pgSimpleLower('STRASSE')).toBe('strasse');
    expect(pgSimpleLower('Straße')).toBe('straße');
    expect(pgSimpleLower('İskender')).toBe('iskender');
    expect(pgSimpleLower('ılık')).toBe('ılık');
    expect(pgSimpleLower('ΣΟΥΒΛΑΚΙ')).toBe('σουβλακι');
    expect(pgSimpleLower('ΟΔΥΣΣΕΥΣ')).toBe('οδυσσευσ');
  });

  it('always returns exactly one code point per input code point (length-preserving)', () => {
    for (const sample of ['İİİ', 'ΟΔΥΣΣΕΥΣ', '𐐀𐐁', 'ﬀ', 'ŉ']) {
      expect(Array.from(pgSimpleLower(sample))).toHaveLength(Array.from(sample).length);
    }
  });
});

describe.skipIf(!headersAvailable)('full-range equality with installed PostgreSQL 17 headers', () => {
  it('generated file is up to date with the installed PostgreSQL case table', () => {
    const table = readPgCaseTable();
    expect(table.unicodeVersion).toBe(PG_UNICODE_VERSION);
    const embedded: [number, number][] = [];
    for (let i = 0; i < PG_SIMPLE_LOWER_PAIRS.length; i += 2) {
      embedded.push([PG_SIMPLE_LOWER_PAIRS[i] ?? -1, PG_SIMPLE_LOWER_PAIRS[i + 1] ?? -1]);
    }
    expect(embedded).toEqual(table.changing);
  });

  it('pgSimpleLower equals PostgreSQL simple lowercase for every code point U+0000..U+10FFFF', () => {
    const table = readPgCaseTable();
    const differences: string[] = [];
    let checked = 0;
    for (let cp = 0; cp <= 0x10ffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      checked += 1;
      const expected = table.entries.get(cp) ?? cp;
      if (pgSimpleLowerCodepoint(cp) !== expected) differences.push(cp.toString(16));
    }
    expect(checked).toBe(0x110000 - 0x800);
    expect(differences).toEqual([]);
  });

  it('documents why toLowerCase() is NOT used: it differs from PostgreSQL for some code points', () => {
    const table = readPgCaseTable();
    let differ = 0;
    for (let cp = 0; cp <= 0x10ffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const js = String.fromCodePoint(cp).toLowerCase();
      if (js !== String.fromCodePoint(table.entries.get(cp) ?? cp)) differ += 1;
    }
    expect(differ).toBeGreaterThan(0);
  });
});

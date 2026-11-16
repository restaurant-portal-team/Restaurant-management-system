import { InvalidNameError, normalizeName } from './name-normalization.js';

describe('normalizeName', () => {
  it('trims and collapses internal whitespace runs to one space', () => {
    expect(normalizeName('  Chicken    Pizza  ', 120)).toEqual({
      name: 'Chicken Pizza',
      nameKey: 'chicken pizza',
    });
  });

  it('treats Unicode spaces (e.g. NBSP) as whitespace', () => {
    expect(normalizeName('Garlic  Naan', 120).name).toBe('Garlic Naan');
  });

  it('produces the same key for case variants (case-insensitive uniqueness)', () => {
    expect(normalizeName('PIZZA', 80).nameKey).toBe(normalizeName('pizza', 80).nameKey);
    expect(normalizeName('Pizza', 80).nameKey).toBe('pizza');
  });

  it('preserves Unicode names including Urdu', () => {
    const result = normalizeName('  چکن   کڑاہی ', 120);
    expect(result.name).toBe('چکن کڑاہی');
    expect(result.nameKey).toBe('چکن کڑاہی');
  });

  it('preserves zero-width non-joiner used in Urdu/Persian text', () => {
    expect(normalizeName('می‌خواهم', 120).name).toBe('می‌خواهم');
  });

  it('rejects control characters including tabs and newlines', () => {
    for (const bad of ['Chicken\tPizza', 'Chicken\nPizza', 'Chicken\r\nPizza', 'Bad\u0000Name', 'C1\u0085x']) {
      expect(() => normalizeName(bad, 120)).toThrow(InvalidNameError);
    }
  });

  it('rejects empty or whitespace-only names', () => {
    expect(() => normalizeName('', 80)).toThrow('must not be empty');
    expect(() => normalizeName('   ', 80)).toThrow('must not be empty');
  });

  it('enforces maximum length in Unicode code points', () => {
    expect(normalizeName('a'.repeat(80), 80).name).toHaveLength(80);
    expect(() => normalizeName('a'.repeat(81), 80)).toThrow('at most 80');
    // 3 emoji = 3 code points (6 UTF-16 units) -> allowed with maxLength 3
    expect(() => normalizeName('🍕🍕🍕', 3)).not.toThrow();
  });

  it('produces a display name compatible with btrim(): no leading/trailing spaces', () => {
    const { name } = normalizeName('  Biryani  ', 120);
    expect(name).toBe(name.replace(/^ +| +$/g, ''));
  });
});

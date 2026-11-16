import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from './env';

describe('resolveApiBaseUrl', () => {
  it('falls back to the local backend when unset', () => {
    expect(resolveApiBaseUrl(undefined)).toBe('http://localhost:3000/api/v1');
    expect(resolveApiBaseUrl('   ')).toBe('http://localhost:3000/api/v1');
  });

  it('strips trailing slashes', () => {
    expect(resolveApiBaseUrl('https://api.example.test/api/v1/')).toBe(
      'https://api.example.test/api/v1',
    );
  });

  it('rejects non-http protocols, relative URLs and embedded credentials', () => {
    expect(() => resolveApiBaseUrl('javascript:alert(1)')).toThrow();
    expect(() => resolveApiBaseUrl('/api/v1')).toThrow();
    expect(() => resolveApiBaseUrl('https://user:pass@api.example.test')).toThrow(
      'must not contain credentials',
    );
  });
});

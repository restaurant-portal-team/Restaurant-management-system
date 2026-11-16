import { resolveRequestId } from './request-id.middleware.js';

describe('resolveRequestId', () => {
  it('keeps a safe caller-supplied request id', () => {
    expect(resolveRequestId('abc-12345-XYZ')).toBe('abc-12345-XYZ');
  });

  it('replaces unsafe or missing ids with a generated UUID (log-injection protection)', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const value of [undefined, '', 'short', 'bad\nINFO forged log line', 'x'.repeat(65), ['a']]) {
      expect(resolveRequestId(value)).toMatch(uuid);
    }
  });
});

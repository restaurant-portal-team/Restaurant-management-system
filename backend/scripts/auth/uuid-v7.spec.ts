import { uuidV7 } from './uuid-v7.ts';

describe('uuidV7', () => {
  it('produces RFC 9562 version-7 UUIDs with the timestamp in the first 48 bits', () => {
    const now = Date.UTC(2026, 10, 20, 10, 0, 0);
    const id = uuidV7(now);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now);
  });

  it('is unique and time-ordered across milliseconds', () => {
    const a = uuidV7(1_000);
    const b = uuidV7(2_000);
    expect(a).not.toBe(b);
    expect(a < b).toBe(true);
  });
});

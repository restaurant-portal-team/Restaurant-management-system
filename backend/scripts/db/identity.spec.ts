import { type DatabaseIdentity, isSameCluster, isSameDatabase } from './identity.ts';
import { safeErrorCode } from './safe-error.ts';

const base: DatabaseIdentity = {
  database: 'restaurant_dev',
  databaseOid: '16400',
  startedAt: '2026-11-16 09:00:00.123456+05',
  serverPort: 5432,
  role: 'restaurant_migrator',
};

describe('database identity comparison', () => {
  it('detects the same database on the same cluster', () => {
    expect(isSameDatabase(base, { ...base, role: 'other' })).toBe(true);
  });

  it('distinguishes databases with different OIDs on the same cluster', () => {
    const shadow = { ...base, database: 'restaurant-dev-shadow', databaseOid: '16401' };
    expect(isSameCluster(base, shadow)).toBe(true);
    expect(isSameDatabase(base, shadow)).toBe(false);
  });

  it('treats equal OIDs on different clusters as different databases', () => {
    expect(isSameDatabase(base, { ...base, serverPort: 5433 })).toBe(false);
    expect(isSameDatabase(base, { ...base, startedAt: '2026-11-16 10:00:00+05' })).toBe(false);
  });
});

describe('safeErrorCode', () => {
  it('returns only SQLSTATE / network codes, never messages', () => {
    const error = Object.assign(new Error('password authentication failed: secret'), {
      code: '28P01',
    });
    expect(safeErrorCode(error)).toBe('28P01');
    expect(safeErrorCode(new TypeError('Invalid URL postgresql://u:secret@x'))).toBe('TypeError');
    expect(safeErrorCode({ code: 'bad code with spaces' })).toBe('UNKNOWN_ERROR');
  });
});

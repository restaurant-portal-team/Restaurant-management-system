import {
  assertShadowIsolatedStatic,
  isSameDestination,
  parsePgDestination,
  UnsafeDatabaseConfigError,
} from './destination.ts';

const SECRET = 'S3cr3t-Pa55';
const main = `postgresql://restaurant_migrator:${SECRET}@127.0.0.1:5432/restaurant_dev?schema=public`;
const shadow = `postgresql://restaurant_migrator:${SECRET}@127.0.0.1:5432/restaurant-dev-shadow?schema=public`;

describe('parsePgDestination', () => {
  it('parses host, default port and a hyphenated database name', () => {
    expect(parsePgDestination(shadow, 'X')).toEqual({
      host: 'loopback',
      port: 5432,
      database: 'restaurant-dev-shadow',
    });
    expect(parsePgDestination('postgresql://u:p@db.internal/app', 'X')).toEqual({
      host: 'db.internal',
      port: 5432,
      database: 'app',
    });
  });

  it('treats localhost, 127.x and ::1 as the same loopback host', () => {
    const hosts = ['localhost', '127.0.0.1', '127.1.2.3', '[::1]', 'LOCALHOST'];
    const results = hosts.map((h) => parsePgDestination(`postgresql://u:p@${h}:5432/db`, 'X'));
    for (const result of results) expect(result.host).toBe('loopback');
  });

  it('honours ?host= and ?port= overrides', () => {
    const parsed = parsePgDestination('postgresql://u:p@ignored:1111/db?host=localhost&port=5432', 'X');
    expect(parsed).toEqual({ host: 'loopback', port: 5432, database: 'db' });
  });

  it('defaults the database name to the user name like PostgreSQL', () => {
    expect(parsePgDestination('postgresql://someuser:p@localhost', 'X').database).toBe('someuser');
  });

  it('decodes percent-encoded database names', () => {
    expect(parsePgDestination('postgresql://u:p@localhost/restaurant%5Fdev', 'X').database).toBe(
      'restaurant_dev',
    );
  });

  it('rejects invalid URLs and wrong schemes without echoing secrets', () => {
    for (const bad of [`not a url ${SECRET}`, `mysql://u:${SECRET}@localhost/db`]) {
      let message = '';
      try {
        parsePgDestination(bad, 'MIGRATION_DATABASE_URL');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(UnsafeDatabaseConfigError);
        message = (error as Error).message;
      }
      expect(message).toContain('MIGRATION_DATABASE_URL');
      expect(message).not.toContain(SECRET);
    }
  });

  it('rejects invalid ports', () => {
    expect(() => parsePgDestination('postgresql://u:p@localhost/db?port=99999', 'X')).toThrow(
      UnsafeDatabaseConfigError,
    );
  });
});

describe('isSameDestination', () => {
  it('compares normalised host, port and database', () => {
    const a = parsePgDestination('postgresql://a:1@localhost/db', 'A');
    const b = parsePgDestination('postgresql://b:2@127.0.0.1:5432/db?schema=other', 'B');
    expect(isSameDestination(a, b)).toBe(true);
    const c = parsePgDestination('postgresql://a:1@localhost:5433/db', 'C');
    expect(isSameDestination(a, c)).toBe(false);
  });
});

describe('assertShadowIsolatedStatic', () => {
  it('accepts the approved main + shadow configuration', () => {
    expect(() => {
      assertShadowIsolatedStatic(main, shadow);
    }).not.toThrow();
  });

  it('allows a missing shadow URL (commands that do not need one)', () => {
    expect(() => {
      assertShadowIsolatedStatic(main, undefined);
    }).not.toThrow();
    expect(() => {
      assertShadowIsolatedStatic(undefined, undefined);
    }).not.toThrow();
  });

  it('refuses when the shadow points at the main database, even via different spellings', () => {
    const variants = [
      main,
      `postgresql://other:pw@localhost/restaurant_dev`,
      `postgresql://other:pw@[::1]:5432/restaurant_dev?schema=shadow`,
      `postgresql://other:pw@x:9/restaurant_dev?host=127.0.0.1&port=5432`,
    ];
    for (const variant of variants) {
      expect(() => {
        assertShadowIsolatedStatic(main, variant);
      }).toThrow(/same database/);
    }
  });

  it('fails safe on unparsable URLs instead of skipping the check', () => {
    expect(() => {
      assertShadowIsolatedStatic(main, 'garbage');
    }).toThrow(UnsafeDatabaseConfigError);
    expect(() => {
      assertShadowIsolatedStatic(undefined, shadow);
    }).toThrow(/MIGRATION_DATABASE_URL is missing/);
  });
});

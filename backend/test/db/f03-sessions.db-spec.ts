/**
 * F03 staff_sessions — rollback-only behavioural tests against restaurant_dev as restaurant_app.
 * Every write is rolled back; no COMMIT exists in this suite. Requires migration
 * 20261120100000_staff_sessions and the human-applied D5 hardening
 * (REVOKE DELETE ON TABLE public.staff_sessions FROM restaurant_app).
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { connectRuntime, failureOf, inRollback, tryQuery } from './db-helpers.ts';

const tokenHash = (): string => createHash('sha256').update(randomBytes(32)).digest('hex');

describe('F03 staff_sessions (restaurant_app @ restaurant_dev, rolled back)', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = await connectRuntime();
  });

  afterAll(async () => {
    await client.end();
  });

  async function seedUser(): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO users (id, full_name, email, password_hash, role, is_active, activated_at, updated_at)
       VALUES (gen_random_uuid(), 'F03 Owner', 'f03.owner@example.test', '$argon2id$placeholder', 'OWNER', true, now(), now())
       RETURNING id`,
    );
    return result.rows[0]?.id ?? '';
  }

  const insertSession = (userId: string, hash: string, extra = ''): string =>
    `INSERT INTO staff_sessions (id, user_id, token_hash, expires_at${extra ? ', revoked_at' : ''})
     VALUES (gen_random_uuid(), '${userId}', '${hash}', now() + interval '12 hours'${extra ? `, ${extra}` : ''})
     RETURNING id`;

  it('D5: runtime can SELECT, INSERT and UPDATE sessions but not DELETE them (exact ACL)', async () => {
    const result = await client.query<Record<string, boolean | string | null>>(
      `SELECT has_table_privilege('public.staff_sessions', 'SELECT') AS sel,
              has_table_privilege('public.staff_sessions', 'INSERT') AS ins,
              has_table_privilege('public.staff_sessions', 'UPDATE') AS upd,
              has_table_privilege('public.staff_sessions', 'DELETE') AS del,
              has_table_privilege('public.staff_sessions', 'TRUNCATE') AS trunc,
              (SELECT array_agg(entry::text ORDER BY entry::text)::text
                 FROM pg_class, unnest(relacl) AS entry
                WHERE oid = 'public.staff_sessions'::regclass) AS acl`,
    );
    expect(result.rows[0]).toEqual({
      sel: true,
      ins: true,
      upd: true,
      del: false,
      trunc: false,
      acl: '{restaurant_app=arw/restaurant_migrator,restaurant_migrator=arwdDxtm/restaurant_migrator}',
    });
  });

  it('accepts a valid session, allows revocation by UPDATE and rejects DELETE (42501)', async () => {
    await inRollback(client, async () => {
      const userId = await seedUser();
      const insert = await tryQuery(client, insertSession(userId, tokenHash()));
      expect(insert.ok).toBe(true);
      const id = insert.ok ? String(insert.rows[0]?.id) : '';

      const revoke = await tryQuery(client, `UPDATE staff_sessions SET revoked_at = now() WHERE id = '${id}'`);
      expect(revoke.ok && revoke.rowCount).toBe(1);

      expect(failureOf(await tryQuery(client, `DELETE FROM staff_sessions WHERE id = '${id}'`)).code).toBe('42501');
    });
  });

  it.each([
    ['plain (non-hex) token', 'not-a-sha256-hash', 'staff_sessions_token_hash_format_chk'],
    ['uppercase hex', 'A'.repeat(64), 'staff_sessions_token_hash_format_chk'],
  ])('rejects a %s as token_hash (CHECK)', async (_label, hash, constraint) => {
    await inRollback(client, async () => {
      const userId = await seedUser();
      expect(failureOf(await tryQuery(client, insertSession(userId, hash)))).toEqual({ code: '23514', constraint });
    });
  });

  it('rejects expiry before creation and revocation before creation (CHECK)', async () => {
    await inRollback(client, async () => {
      const userId = await seedUser();
      const expired = await tryQuery(
        client,
        `INSERT INTO staff_sessions (id, user_id, token_hash, expires_at)
         VALUES (gen_random_uuid(), '${userId}', '${tokenHash()}', now() - interval '1 second')`,
      );
      expect(failureOf(expired)).toEqual({ code: '23514', constraint: 'staff_sessions_expiry_after_creation_chk' });

      const revokedEarly = await tryQuery(
        client,
        insertSession(userId, tokenHash(), "now() - interval '1 hour'"),
      );
      expect(failureOf(revokedEarly)).toEqual({
        code: '23514',
        constraint: 'staff_sessions_revoked_after_creation_chk',
      });
    });
  });

  it('enforces unique token hashes and an existing user (FK)', async () => {
    await inRollback(client, async () => {
      const userId = await seedUser();
      const hash = tokenHash();
      expect((await tryQuery(client, insertSession(userId, hash))).ok).toBe(true);
      expect(failureOf(await tryQuery(client, insertSession(userId, hash)))).toEqual({
        code: '23505',
        constraint: 'staff_sessions_token_hash_key',
      });
      expect(failureOf(await tryQuery(client, insertSession('00000000-0000-7000-8000-000000000000', tokenHash())))).toEqual({
        code: '23503',
        constraint: 'staff_sessions_user_id_fkey',
      });
    });
  });

  it('a user with sessions cannot be deleted (ON DELETE RESTRICT keeps the audit trail)', async () => {
    await inRollback(client, async () => {
      const userId = await seedUser();
      await client.query(insertSession(userId, tokenHash()));
      expect(failureOf(await tryQuery(client, `DELETE FROM users WHERE id = '${userId}'`)).code).toBe('23503');
    });
  });
});

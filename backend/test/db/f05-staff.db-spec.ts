/**
 * F05 staff management — rollback-only checks against restaurant_dev as restaurant_app.
 * Every write is rolled back; no COMMIT exists in this suite. Requires the human-applied S6 hardening:
 *   REVOKE DELETE ON TABLE public.users, public.staff_setup_tokens FROM restaurant_app;
 * Concurrency is verified separately on the isolated test database (test/db-isolated/).
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { connectRuntime, failureOf, inRollback, tryQuery } from './db-helpers.ts';

const hash = (): string => createHash('sha256').update(randomBytes(32)).digest('hex');

describe('F05 staff accounts (restaurant_app @ restaurant_dev, rolled back)', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = await connectRuntime();
  });

  afterAll(async () => {
    await client.end();
  });

  async function seedPending(): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO users (id, full_name, email, role, updated_at)
       VALUES (gen_random_uuid(), 'F05 Pending', 'f05.pending.' || gen_random_uuid() || '@example.test', 'WAITER', now())
       RETURNING id`,
    );
    return result.rows[0]?.id ?? '';
  }

  it('S6: runtime has SELECT/INSERT/UPDATE but no DELETE on users and staff_setup_tokens (exact ACL)', async () => {
    const result = await client.query<Record<string, boolean | string | null>>(
      `SELECT has_table_privilege('public.users', 'SELECT') AS u_sel,
              has_table_privilege('public.users', 'INSERT') AS u_ins,
              has_table_privilege('public.users', 'UPDATE') AS u_upd,
              has_table_privilege('public.users', 'DELETE') AS u_del,
              has_table_privilege('public.users', 'TRUNCATE') AS u_trunc,
              has_table_privilege('public.staff_setup_tokens', 'SELECT') AS t_sel,
              has_table_privilege('public.staff_setup_tokens', 'INSERT') AS t_ins,
              has_table_privilege('public.staff_setup_tokens', 'UPDATE') AS t_upd,
              has_table_privilege('public.staff_setup_tokens', 'DELETE') AS t_del,
              has_table_privilege('public.staff_setup_tokens', 'TRUNCATE') AS t_trunc,
              (SELECT array_agg(entry::text ORDER BY entry::text)::text FROM pg_class, unnest(relacl) AS entry
                WHERE oid = 'public.users'::regclass) AS users_acl,
              (SELECT array_agg(entry::text ORDER BY entry::text)::text FROM pg_class, unnest(relacl) AS entry
                WHERE oid = 'public.staff_setup_tokens'::regclass) AS tokens_acl`,
    );
    const acl = '{restaurant_app=arw/restaurant_migrator,restaurant_migrator=arwdDxtm/restaurant_migrator}';
    expect(result.rows[0]).toEqual({
      u_sel: true,
      u_ins: true,
      u_upd: true,
      u_del: false,
      u_trunc: false,
      t_sel: true,
      t_ins: true,
      t_upd: true,
      t_del: false,
      t_trunc: false,
      users_acl: acl,
      tokens_acl: acl,
    });
  });

  it('S6: DELETE on users and staff_setup_tokens is rejected (42501); deactivation is an UPDATE', async () => {
    await inRollback(client, async () => {
      const userId = await seedPending();
      const token = await client.query<{ id: string }>(
        `INSERT INTO staff_setup_tokens (id, user_id, token_hash, expires_at)
         VALUES (gen_random_uuid(), $1, $2, now() + interval '24 hours') RETURNING id`,
        [userId, hash()],
      );
      const tokenId = token.rows[0]?.id ?? '';
      expect(failureOf(await tryQuery(client, 'DELETE FROM staff_setup_tokens WHERE id = $1', [tokenId])).code).toBe(
        '42501',
      );
      expect(failureOf(await tryQuery(client, 'DELETE FROM users WHERE id = $1', [userId])).code).toBe('42501');

      const deactivate = await tryQuery(client, 'UPDATE users SET deactivated_at = now() WHERE id = $1', [userId]);
      expect(deactivate.ok && deactivate.rowCount).toBe(1);
      const expire = await tryQuery(
        client,
        'UPDATE staff_setup_tokens SET expires_at = clock_timestamp() WHERE id = $1 AND used_at IS NULL',
        [tokenId],
      );
      expect(expire.ok && expire.rowCount).toBe(1);
    });
  });

  it('lifecycle invariant: a pending account cannot become active without a password and activation time', async () => {
    await inRollback(client, async () => {
      const userId = await seedPending();
      for (const sql of [
        'UPDATE users SET is_active = true WHERE id = $1',
        "UPDATE users SET is_active = true, password_hash = '$argon2id$x' WHERE id = $1",
        'UPDATE users SET is_active = true, activated_at = now() WHERE id = $1',
      ]) {
        expect(failureOf(await tryQuery(client, sql, [userId]))).toEqual({
          code: '23514',
          constraint: 'users_active_requires_setup_chk',
        });
      }
      const ok = await tryQuery(
        client,
        "UPDATE users SET is_active = true, password_hash = '$argon2id$x', activated_at = now() WHERE id = $1",
        [userId],
      );
      expect(ok.ok && ok.rowCount).toBe(1);
    });
  });

  it('setup tokens: hash is unique and a token cannot expire before it was created', async () => {
    await inRollback(client, async () => {
      const userId = await seedPending();
      const tokenHash = hash();
      const insert = `INSERT INTO staff_setup_tokens (id, user_id, token_hash, expires_at)
                      VALUES (gen_random_uuid(), $1, $2, now() + interval '24 hours') RETURNING id`;
      expect((await tryQuery(client, insert, [userId, tokenHash])).ok).toBe(true);
      expect(failureOf(await tryQuery(client, insert, [userId, tokenHash]))).toEqual({
        code: '23505',
        constraint: 'staff_setup_tokens_token_hash_key',
      });
      expect(
        failureOf(
          await tryQuery(
            client,
            "UPDATE staff_setup_tokens SET expires_at = created_at - interval '1 second' WHERE user_id = $1",
            [userId],
          ),
        ),
      ).toEqual({ code: '23514', constraint: 'staff_setup_tokens_expiry_chk' });
    });
  });
});
